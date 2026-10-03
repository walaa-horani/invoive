"use client";

import Link from "next/link";
import { useActionState } from "react";
import { setClientStatus, type ClientActionState } from "./actions";
import { secondaryButton } from "./ClientDialog";

// Archive (frees a plan slot) or restore (needs a free slot).
export function StatusButton({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const [state, action, pending] = useActionState<ClientActionState, FormData>(setClientStatus, {});

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={archived ? "active" : "archived"} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${archived ? "Restore" : "Archive"} ${name}`}
        className={secondaryButton}
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">
          {archived ? "unarchive" : "archive"}
        </span>
        <span className="hidden sm:inline">{pending ? "…" : archived ? "Restore" : "Archive"}</span>
      </button>
      {state.error && (
        <p role="alert" className="max-w-[220px] text-right text-xs text-[#ba1a1a]">
          {state.error}
          {state.limitReached && (
            <>
              {" "}
              <Link href="/settings/billing" className="font-semibold underline">
                Upgrade
              </Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
