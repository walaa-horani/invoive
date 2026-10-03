"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import { addClient, editClient, type ClientActionState } from "./actions";

export type ClientFields = { id: string; name: string; email: string | null; company: string | null };

const inputClass =
  "w-full rounded-[12px] border border-[#E2E8F0] bg-white px-4 py-2.5 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] outline-none transition-colors hover:border-[#CBD5E1] focus:border-[#2563EB] focus:ring-2 focus:ring-[#3B82F6]/30";

export const primaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-[12px] bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#1E293B] hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B82F6] disabled:opacity-60 disabled:hover:translate-y-0";

export const secondaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2 text-sm font-medium text-[#0F172A] transition-colors hover:border-[#CBD5E1] hover:bg-[#F8FAFC] disabled:opacity-50";

// Add (no client) or edit (client given). Opens from its own trigger button.
export function ClientDialog({
  client,
  trigger,
  triggerClassName,
}: {
  client?: ClientFields;
  trigger: React.ReactNode;
  triggerClassName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        {trigger}
      </button>
      {/* Mounted only while open, so every opening starts with a clean form. */}
      {open && <ClientForm client={client} onClose={() => setOpen(false)} />}
    </>
  );
}

function ClientForm({ client, onClose }: { client?: ClientFields; onClose: () => void }) {
  const [state, action, pending] = useActionState<ClientActionState, FormData>(client ? editClient : addClient, {});
  const titleId = useId();

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, state.done, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/40 px-4"
          onClick={(e) => e.target === e.currentTarget && !pending && onClose()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-[24px] border border-[#E2E8F0] bg-white p-6 md:p-8 shadow-[0_20px_25px_-5px_rgba(15,23,42,0.15),0_8px_10px_-6px_rgba(15,23,42,0.1)]"
          >
            <h2 id={titleId} className="font-headline-sm text-[#0F172A]">
              {client ? "Edit client" : "Add a client"}
            </h2>

            <form action={action} className="mt-6 flex flex-col gap-4">
              {client && <input type="hidden" name="id" value={client.id} />}
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-[#0F172A]">Name</span>
                <input name="name" required maxLength={200} autoFocus defaultValue={client?.name} placeholder="Jane Cooper" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-[#0F172A]">
                  Email <span className="font-normal text-[#64748B]">(optional)</span>
                </span>
                <input name="email" type="email" maxLength={320} defaultValue={client?.email ?? ""} placeholder="jane@company.com" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-[#0F172A]">
                  Company <span className="font-normal text-[#64748B]">(optional)</span>
                </span>
                <input name="company" maxLength={200} defaultValue={client?.company ?? ""} placeholder="Company Inc." className={inputClass} />
              </label>

              {state.error && (
                <div role="alert" className="rounded-[12px] border border-[#ffb4ab] bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
                  {state.error}
                  {state.limitReached && (
                    <>
                      {" "}
                      <Link href="/settings/billing" className="font-semibold underline">
                        Upgrade your plan
                      </Link>{" "}
                      or archive a client to free a slot.
                    </>
                  )}
                </div>
              )}

              <div className="mt-2 flex justify-end gap-3">
                <button type="button" onClick={onClose} disabled={pending} className={secondaryButton}>
                  Cancel
                </button>
                <button type="submit" disabled={pending} className={primaryButton}>
                  {pending ? "Saving…" : client ? "Save changes" : "Add client"}
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
