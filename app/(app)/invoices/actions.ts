"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CURRENCIES, toBasisPoints, toMinorUnits, type Currency } from "@/lib/invoices";
import { getActiveWorkspace, getSession } from "@/lib/workspace";

// The database decides everything: RLS and column grants for drafts, and the
// SECURITY DEFINER functions (issue_invoice, void_invoice, ...) for anything
// that touches numbers, totals, pay links or payment state. These actions
// only shape input and translate the answer.

export type InvoiceActionState = {
  ok?: boolean;
  error?: string;
  limitReached?: boolean;
  // A fresh pay-link token, returned once by issue / rotate.
  token?: string;
  done?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function explain(error: { code?: string; message: string }): InvoiceActionState {
  switch (error.code) {
    case "PT402":
      return { error: "You've reached your plan's invoice limit for this month.", limitReached: true };
    case "22023":
      return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." };
    case "55000":
      return { error: "This invoice can't be changed in its current state. Refresh the page." };
    case "P0002":
      return { error: "That invoice no longer exists or you can't change it." };
    case "42501":
      return { error: "You don't have permission to change invoices in this workspace." };
    case "23503":
      return { error: "Choose a client from this workspace." };
    case "23514":
      return { error: "Some details aren't valid. Check dates, quantities and amounts." };
    default:
      console.error("invoice action failed:", error);
      return { error: "Something went wrong. Please try again." };
  }
}

function refresh(id?: string) {
  revalidatePath("/invoices");
  if (id) revalidatePath(`/invoices/${id}`);
  revalidatePath("/settings/billing");
}

type ParsedItem = { description: string; quantity: number; unit_amount: number; tax_rate_bps: number };

function parseDraft(formData: FormData) {
  const clientId = String(formData.get("client_id") ?? "");
  const currency = String(formData.get("currency") ?? "usd") as Currency;
  const issueDate = String(formData.get("issue_date") ?? "");
  const dueDate = String(formData.get("due_date") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!UUID_RE.test(clientId)) return { error: "Choose a client." } as const;
  if (!CURRENCIES.includes(currency)) return { error: "Choose a currency." } as const;
  if ((issueDate && !DATE_RE.test(issueDate)) || (dueDate && !DATE_RE.test(dueDate))) {
    return { error: "Enter valid dates." } as const;
  }
  if (issueDate && dueDate && dueDate < issueDate) return { error: "The due date can't be before the issue date." } as const;
  if (notes.length > 2000) return { error: "Keep notes under 2,000 characters." } as const;

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Couldn't read the line items." } as const;
  }
  if (!Array.isArray(raw) || raw.length > 100) return { error: "Use at most 100 line items." } as const;

  const items: ParsedItem[] = [];
  for (const [index, row] of raw.entries()) {
    const description = String(row?.description ?? "").trim();
    const quantity = Number(String(row?.quantity ?? "").trim());
    const unitAmount = toMinorUnits(String(row?.unitPrice ?? ""));
    const tax = toBasisPoints(String(row?.taxPercent ?? ""));
    const line = `Line ${index + 1}`;
    if (!description && unitAmount === null) continue; // blank row
    if (!description || description.length > 500) return { error: `${line}: enter a description (max 500 characters).` } as const;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || Math.round(quantity * 100) !== quantity * 100) {
      return { error: `${line}: quantity must be a positive number with at most 2 decimals.` } as const;
    }
    if (unitAmount === null || unitAmount > 99_999_999) return { error: `${line}: enter a valid price.` } as const;
    if (tax === null) return { error: `${line}: tax must be between 0 and 100%.` } as const;
    items.push({ description, quantity, unit_amount: unitAmount, tax_rate_bps: tax });
  }

  return {
    draft: {
      p_client_id: clientId,
      p_currency: currency,
      p_issue_date: issueDate || null,
      p_due_date: dueDate || null,
      p_notes: notes || null,
      p_items: items,
    },
  } as const;
}

export async function saveDraft(prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const id = String(formData.get("id") ?? "");
  if (id && !UUID_RE.test(id)) return { error: "Unknown invoice.", done: prev.done };
  const parsed = parseDraft(formData);
  if ("error" in parsed) return { error: parsed.error, done: prev.done };

  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return { error: "Create a workspace first.", done: prev.done };

  const { data, error } = await supabase.rpc("save_invoice_draft", {
    p_invoice_id: id || null,
    p_tenant_id: active.id,
    ...parsed.draft,
  });
  if (error) return { ...explain(error), done: prev.done };

  refresh(data as string);
  if (!id) redirect(`/invoices/${data as string}`);
  return { ok: true, done: (prev.done ?? 0) + 1 };
}

// Shared shape for the one-click actions on an invoice.
async function invoiceRpc(
  prev: InvoiceActionState,
  formData: FormData,
  fn: "issue_invoice" | "rotate_pay_link" | "void_invoice" | "record_manual_payment",
): Promise<InvoiceActionState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Unknown invoice.", done: prev.done };

  const { supabase } = await getSession();
  const { data, error } = await supabase.rpc(fn, { p_invoice_id: id });
  if (error) return { ...explain(error), done: prev.done };

  refresh(id);
  const token =
    fn === "issue_invoice" ? (data as { token: string }).token : fn === "rotate_pay_link" ? (data as string) : undefined;
  return { ok: true, token, done: (prev.done ?? 0) + 1 };
}

export async function issueInvoice(prev: InvoiceActionState, formData: FormData) {
  return invoiceRpc(prev, formData, "issue_invoice");
}

export async function rotatePayLink(prev: InvoiceActionState, formData: FormData) {
  return invoiceRpc(prev, formData, "rotate_pay_link");
}

export async function voidInvoice(prev: InvoiceActionState, formData: FormData) {
  return invoiceRpc(prev, formData, "void_invoice");
}

export async function markPaid(prev: InvoiceActionState, formData: FormData) {
  return invoiceRpc(prev, formData, "record_manual_payment");
}

export async function deleteDraft(prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Unknown invoice.", done: prev.done };

  const { supabase } = await getSession();
  const { data, error } = await supabase.from("invoices").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return { ...explain(error), done: prev.done };
  if (!data?.length) return { error: "Only drafts can be deleted.", done: prev.done };

  refresh();
  redirect("/invoices");
}
