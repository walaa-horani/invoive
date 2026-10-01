import React from "react";

export function ComparisonTable() {
  const rows = [
    {
      feature: "Active Clients",
      starter: "5 Clients",
      growth: "25 Clients",
      agency: "Unlimited",
      isHighlight: false,
    },
    {
      feature: "Monthly Invoicing Throughput",
      starter: "25 / mo",
      growth: "Unlimited",
      agency: "Unlimited",
      isHighlight: false,
    },
    {
      feature: "User Accounts & Roles",
      starter: "1 Solo User",
      growth: "3 Seats Included",
      agency: "10 Seats + Roles",
      isHighlight: false,
    },
    {
      feature: "Multi-Currency (135+ FX rates)",
      starter: false,
      growth: true,
      agency: true,
      isHighlight: false,
    },
    {
      feature: "Client Approval & Payment Portal",
      starter: false,
      growth: true,
      agency: true,
      isHighlight: false,
    },
    {
      feature: "Custom CNAME & White-Label Domain",
      starter: false,
      growth: false,
      agency: true,
      isHighlight: false,
    },
    {
      feature: "Xero & QuickBooks Bi-directional Sync",
      starter: false,
      growth: true,
      agency: true,
      isHighlight: false,
    },
    {
      feature: "Customer Support SLA",
      starter: "24 Hours",
      growth: "2 Hours (Chat)",
      agency: "15 Min Dedicated",
      isHighlight: true,
    },
  ];

  return (
    <section id="features" className="w-full py-20 bg-[#eff4ff]/60 border-y border-[#dce9ff]">
      <div className="max-w-[1280px] mx-auto px-6 md:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-[#0051d5] font-bold">
              Side-by-Side Breakdown
            </span>
            <h2 className="font-headline-lg text-[#0b1c30] mt-1">Detailed Feature Matrix</h2>
          </div>
          <p className="text-xs md:text-sm text-[#45464d] max-w-md leading-relaxed">
            Explore complete operational capabilities across our tier ecosystem. No buried line items
            or surprise tier jumps.
          </p>
        </div>

        {/* Comparison Table Card */}
        <div className="bg-white rounded-2xl border border-[#dce9ff] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-[#eff4ff]/80 text-[#0b1c30] border-b border-[#dce9ff]">
                  <th className="py-4 px-6 md:px-8 font-semibold w-1/3">Core Dimensions</th>
                  <th className="py-4 px-4 font-semibold text-center w-1/5">Starter ($15)</th>
                  <th className="py-4 px-4 font-bold text-center w-1/5 text-[#0051d5] bg-[#eff4ff]/90 border-x border-[#dce9ff]">
                    Growth ($39)
                  </th>
                  <th className="py-4 px-4 font-semibold text-center w-1/5">Agency ($95)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5eeff]">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-[#f8f9ff] transition-colors">
                    <td className="py-4 px-6 md:px-8 text-[#0b1c30] font-medium text-xs md:text-sm">
                      {row.feature}
                    </td>

                    {/* Starter Column */}
                    <td className="py-4 px-4 text-center text-xs md:text-sm">
                      {typeof row.starter === "boolean" ? (
                        row.starter ? (
                          <span className="material-symbols-outlined text-[#069669] text-[20px]">
                            check_circle
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[#76777d]/60 text-[20px]">
                            horizontal_rule
                          </span>
                        )
                      ) : (
                        <span className="font-code-num text-[#45464d]">{row.starter}</span>
                      )}
                    </td>

                    {/* Growth Column (Highlighted) */}
                    <td className="py-4 px-4 text-center bg-[#eff4ff]/50 border-x border-[#dce9ff] text-xs md:text-sm">
                      {typeof row.growth === "boolean" ? (
                        row.growth ? (
                          <span className="material-symbols-outlined text-[#0051d5] text-[20px]">
                            check_circle
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[#76777d]/60 text-[20px]">
                            horizontal_rule
                          </span>
                        )
                      ) : (
                        <span className="font-code-num font-bold text-[#0051d5]">{row.growth}</span>
                      )}
                    </td>

                    {/* Agency Column */}
                    <td className="py-4 px-4 text-center text-xs md:text-sm">
                      {typeof row.agency === "boolean" ? (
                        row.agency ? (
                          <span className="material-symbols-outlined text-[#069669] text-[20px]">
                            check_circle
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[#76777d]/60 text-[20px]">
                            horizontal_rule
                          </span>
                        )
                      ) : (
                        <span className="font-code-num font-semibold text-[#0b1c30]">
                          {row.agency}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
