import React from "react";
import Image from "next/image";

export function SocialProof() {
  const testimonials = [
    {
      quote:
        "“Switching to LedgerFlow cut our invoice realization cycle from 32 days down to 6 days. The automatic retainer scheduling alone saves our finance lead 15 hours each billing period.”",
      name: "Marcus Vance",
      title: "Founder, Vance Interactive (NY)",
      avatar:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuByb6do3xhB3urmF1U5bVMcoxnhoZ9uZzvL9DJjcJcEfgHJEVMx8Wj2FLZB1SMkqop11J6cEOnYg-R6VpcpOg-12ATdI0Kaomg6cRoxyqFV4i4p2iFaLxpAGlxY2fMMfwiL7eUNiQJnDEx6bL8N8NWznPTa8OEmY8qpV-2uBak9Aq7h2jNBuMcIhYfp88soCNc3iYU9oPfS_Nt-z4jc6mVRP3SiERlLHGiXLJFryBXAQgP-V0QoG022jg",
    },
    {
      quote:
        "“Our overseas clients in London and Tokyo pay directly in GBP and JPY through the client portal without conversion friction. It provides us the polish of a 50-person agency as a lean 4-person design pod.”",
      name: "Elena Rostova",
      title: "Principal, Studio Forma",
      avatar:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBmrMprcXfbJLKAbp2NpSqeQxUvXVwPCbwFlD4H2eULstG9gsZhsD7UOUG5AGK4OQAGgTOj7tqFDThdu19PlN_vR8cCnriUh0olmTn39tvWl86aXzPFW3sw2cWBzeSTrrPAIvTuMW7aMFrBTJ17oKhyCFKCTJ6wL48hVK0UEB69UyaH_pOmfNbF6-epacnQYQU1LWv1MS1CjpK_KgMfZRjvaAy36Bmadc8uQTpw7QoWGV9u-K-rp7w5ug",
    },
    {
      quote:
        "“Zero transaction commissions means our margins stay ours. FreshBooks was penalizing our growth; LedgerFlow provides the scalable API and Xero sync we strictly required.”",
      name: "Julian Thorne",
      title: "Operations Director, Apex Cloud",
      avatar:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBxPfV3nVL2Sc2JV-3C7TJdYTpy5NXER7Y0oIVdtEA4xQkCmc90NXDSFG-aoLA05a2kpd4omjXpgyHdFqgMYbO1IfnXSU6R6KnT6fRC34Tlm8TdJc-NZk106muy0PyXjEmPORNP-yZ-z045yLBIhyxrn01g5H0DZbqBG_LnnloCvD3oypMd9hGp2of7iLFgu3BO3Jxwn5BarSnO_Z4_JPN7wSaFKXFZpB4-Xz8rj5arArw4GuTxkM_E2w",
    },
  ];

  const badges = [
    {
      icon: "verified_user",
      title: "SOC-2 Type II",
      subtitle: "Independently Audited",
    },
    {
      icon: "lock",
      title: "256-Bit SSL",
      subtitle: "Bank-Grade Encryption",
    },
    {
      icon: "credit_card",
      title: "PCI-DSS Level 1",
      subtitle: "Certified Processing",
    },
    {
      icon: "speed",
      title: "99.99% Uptime",
      subtitle: "Guaranteed Service SLA",
    },
  ];

  return (
    <section id="customers" className="w-full py-20 bg-[#f8f9ff]">
      <div className="max-w-[1280px] mx-auto px-6 md:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <span className="text-xs uppercase tracking-wider text-[#76777d] font-bold">
            Institutional Reliability
          </span>
          <h2 className="font-headline-md text-[#0b1c30] mt-1 text-2xl md:text-3xl">
            Trusted by 12,000+ modern agencies &amp; top independents
          </h2>
        </div>

        {/* Testimonial Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {testimonials.map((item, index) => (
            <div
              key={index}
              className="bg-white p-7 rounded-2xl border border-[#dce9ff] shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <p className="text-sm md:text-base text-[#45464d] italic mb-6 leading-relaxed">
                {item.quote}
              </p>
              <div className="flex items-center gap-3.5 pt-3 border-t border-gray-100">
                <Image
                  src={item.avatar}
                  alt={`Photo of ${item.name}`}
                  width={48}
                  height={48}
                  sizes="48px"
                  className="w-12 h-12 rounded-full object-cover shadow-xs border border-gray-100"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-[#0b1c30]">{item.name}</span>
                  <span className="text-xs text-[#45464d]">{item.title}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Security Trust Badges Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 bg-[#eff4ff] border border-[#dce9ff] p-7 rounded-2xl">
          {badges.map((badge, idx) => (
            <div key={idx} className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-white border border-[#dbe1ff] flex items-center justify-center text-[#0051d5] shadow-xs shrink-0">
                <span className="material-symbols-outlined text-[24px]">{badge.icon}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-[#0b1c30]">{badge.title}</span>
                <span className="text-xs text-[#45464d]">{badge.subtitle}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
