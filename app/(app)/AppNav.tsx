"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/clients", label: "Clients" },
  { href: "/invoices", label: "Invoices" },
  { href: "/settings/payments", label: "Payments" },
  { href: "/settings/billing", label: "Billing" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {SECTIONS.map(({ href, label }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`whitespace-nowrap text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
              current ? "bg-[#F1F5F9] text-[#0F172A]" : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
