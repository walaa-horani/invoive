import React from "react";

export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        viewBox="0 0 40 40"
        width="34"
        height="34"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-sm"
      >
        <rect width="40" height="40" rx="10" fill="#0F172A" />
        <path
          d="M12 28V12L20 20L28 12V28"
          stroke="#38BDF8"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="25" r="2.5" fill="#34D399" />
      </svg>
      <span className="font-headline font-bold text-xl tracking-tight text-[#0b1c30]">
        LedgerFlow
      </span>
    </div>
  );
}
