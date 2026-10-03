"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Workspace } from "@/lib/workspace";

// Dropdown built on <details>: works without JavaScript, closes on outside
// click / Escape when it is available. Switching goes through a route that
// remembers the choice and returns to the current page.
export function WorkspaceSwitcher({ workspaces, activeId }: { workspaces: Workspace[]; activeId: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  const active = workspaces.find((w) => w.id === activeId);

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm font-medium text-[#0F172A] hover:border-[#CBD5E1] max-w-[220px]">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[#64748B]">
          domain
        </span>
        <span className="truncate">{active?.name ?? "Workspace"}</span>
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[#64748B]">
          expand_more
        </span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-64 rounded-[12px] border border-[#E2E8F0] bg-white p-1.5 shadow-[0_10px_25px_-5px_rgba(15,23,42,0.12),0_8px_10px_-6px_rgba(15,23,42,0.06)]">
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold uppercase tracking-wider text-[#64748B]">Workspaces</p>
        <ul>
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/settings/workspaces/switch?id=${w.id}&next=${encodeURIComponent(pathname)}`}
                prefetch={false}
                aria-current={w.id === activeId ? "true" : undefined}
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-[#0F172A] hover:bg-[#F1F5F9]"
              >
                <span className="truncate">{w.name}</span>
                {w.id === activeId && (
                  <span aria-hidden className="material-symbols-outlined text-[18px] text-[#2563EB]">
                    check
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-[#E2E8F0] mt-1.5 pt-1.5">
          <Link
            href="/settings/workspaces/new"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-[#0F172A] hover:bg-[#F1F5F9]"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
            New workspace
          </Link>
        </div>
      </div>
    </details>
  );
}
