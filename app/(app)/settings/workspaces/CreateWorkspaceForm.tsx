"use client";

import { useActionState } from "react";
import { createWorkspace, type CreateWorkspaceState } from "./actions";

// DESIGN.md: Level 1 card (white, 1px #E2E8F0, soft shadow, 24px radius),
// 12px-radius input, Primary CTA (#0F172A, hover #1E293B + 1px lift).
export function CreateWorkspaceForm({ first }: { first: boolean }) {
  const [state, action, pending] = useActionState<CreateWorkspaceState, FormData>(createWorkspace, {});

  return (
    <div className="w-full max-w-lg mx-auto bg-white rounded-[24px] border border-[#E2E8F0] shadow-[0_1px_3px_0_rgba(15,23,42,0.05),0_1px_2px_-1px_rgba(15,23,42,0.05)] p-6 md:p-10">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#eff4ff] mb-6">
        <span aria-hidden className="material-symbols-outlined text-[#2563EB] text-[24px]">
          domain_add
        </span>
      </div>

      <h1 className="font-headline-md text-[#0F172A]">
        {first ? "Create your workspace" : "Create a new workspace"}
      </h1>
      <p className="font-body-md text-[#64748B] mt-2">
        A workspace holds your clients, invoices and team. You can choose a plan right after.
      </p>

      <form action={action} className="flex flex-col gap-5 mt-8">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[#0F172A]">Workspace name</span>
          <input
            name="name"
            type="text"
            required
            maxLength={200}
            autoFocus
            placeholder="e.g. Acme Studio"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "workspace-error" : undefined}
            className="w-full rounded-[12px] border border-[#E2E8F0] bg-white px-4 py-3 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] outline-none transition-colors hover:border-[#CBD5E1] focus:border-[#2563EB] focus:ring-2 focus:ring-[#3B82F6]/30"
          />
        </label>

        {state.error && (
          <p
            id="workspace-error"
            role="alert"
            className="text-sm text-[#93000a] bg-[#ffdad6] border border-[#ffb4ab] rounded-[12px] px-4 py-3"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-[12px] bg-[#0F172A] px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#1E293B] hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B82F6] disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {pending ? "Creating…" : "Create workspace"}
        </button>
      </form>

      <p className="text-xs text-[#64748B] mt-6 flex items-center gap-1.5">
        <span aria-hidden className="material-symbols-outlined text-[#059669] text-[16px]">
          verified_user
        </span>
        You&apos;ll be the owner, with full control over billing and team members.
      </p>
    </div>
  );
}
