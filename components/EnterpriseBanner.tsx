import React from "react";

export function EnterpriseBanner() {
  return (
    <section className="w-full py-20 bg-[#f8f9ff]">
      <div className="max-w-[1280px] mx-auto px-6 md:px-8">
        <div className="bg-[#0f172a] text-white rounded-3xl p-8 md:p-14 shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-8 relative overflow-hidden">
          {/* Subtle Background Glow */}
          <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#0051d5]/35 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col gap-3 max-w-2xl text-center lg:text-left z-10">
            <div className="inline-flex items-center gap-2 text-[#85f8c4] font-semibold text-xs uppercase tracking-wider self-center lg:self-start">
              <span className="material-symbols-outlined text-[18px]">corporate_fare</span>
              Enterprise &amp; Custom Volumes
            </div>
            <h2 className="font-headline text-2xl md:text-4xl font-bold tracking-tight text-white leading-tight">
              Need tailored multi-entity billing or custom volume SLA terms?
            </h2>
            <p className="text-sm md:text-base text-[#dae2fd]/85 leading-relaxed">
              For global agencies billing over $5M annually or requiring custom ERP integrations
              (NetSuite, Sage Intacct), our solutions team provides bespoke architectural provisioning.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 z-10 shrink-0">
            <a
              href="#contact"
              className="bg-white text-[#0f172a] hover:bg-[#eff4ff] font-bold text-sm px-6 py-3.5 rounded-xl shadow-sm transition-all transform hover:-translate-y-0.5 whitespace-nowrap active:translate-y-0"
            >
              Schedule Architecture Demo
            </a>
            <a
              href="#contact"
              className="bg-white/10 hover:bg-white/20 border border-white/15 text-white font-medium text-sm px-6 py-3.5 rounded-xl transition-colors whitespace-nowrap"
            >
              Contact Enterprise Sales
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
