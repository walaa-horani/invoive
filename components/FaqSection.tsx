"use client";

import React, { useState } from "react";

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      question: "Can I change or cancel my plan anytime?",
      answer:
        "Yes, absolutely. You can upgrade, downgrade, or cancel your subscription at any moment directly from your dashboard settings. If you upgrade, the prorated difference is credited instantly. When canceling, you will retain full access until the end of your prepaid billing period.",
    },
    {
      question: "What happens if I exceed my active client or invoice limit?",
      answer:
        "We never block incoming customer payments or cut off client access. If you approach your limit, we send an in-app notice offering a seamless 1-click tier upgrade or the option to archive inactive clients to free up active slots.",
    },
    {
      question: "Are there any hidden transaction fees on payments?",
      answer:
        "None. LedgerFlow charges exactly 0% platform transaction markups. You only pay standard merchant processing rates directly to Stripe, PayPal, or your direct merchant processor (e.g. 2.9% + 30¢ for cards, or 0.8% capped at $5 for ACH).",
    },
    {
      question: "Can my clients pay via ACH transfer and credit cards?",
      answer:
        "Yes. Through your client portal, clients can pay using ACH direct debit, wire instructions, major credit cards (Visa, MasterCard, Amex), Apple Pay, and Google Pay. You can also specify payment method restrictions on specific invoices.",
    },
    {
      question: "Do you offer migration support from FreshBooks, QuickBooks, or Harvest?",
      answer:
        "Yes. We offer automated CSV import templates for immediate roster migration. For Growth and Agency tiers, our customer engineering team provides white-glove migration assistance to import existing clients, historical records, and ongoing retainers without downtime.",
    },
  ];

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="w-full py-20 bg-[#eff4ff]/40 border-t border-[#e5eeff]">
      <div className="max-w-[840px] mx-auto px-6 md:px-8">
        <div className="text-center mb-12">
          <span className="text-xs uppercase tracking-wider text-[#0051d5] font-bold">
            Clear Answers
          </span>
          <h2 className="font-headline-lg text-[#0b1c30] mt-1 text-2xl md:text-3xl">
            Frequently Asked Questions
          </h2>
          <p className="text-sm text-[#45464d] mt-2">
            Everything you need to know about plans, billing mechanics, and migration.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="bg-white rounded-2xl border border-[#dce9ff] shadow-xs overflow-hidden transition-all"
              >
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  className="w-full py-5 px-6 md:px-7 flex items-center justify-between text-left focus:outline-none"
                  aria-expanded={isOpen}
                >
                  <span className="font-headline font-semibold text-base md:text-lg text-[#0b1c30]">
                    {faq.question}
                  </span>
                  <span
                    className={`material-symbols-outlined text-[#45464d] transition-transform duration-200 shrink-0 ml-4 ${
                      isOpen ? "rotate-180 text-[#0051d5]" : ""
                    }`}
                  >
                    expand_more
                  </span>
                </button>
                {isOpen && (
                  <div className="px-6 md:px-7 pb-6 text-sm text-[#45464d] leading-relaxed animate-in fade-in duration-200">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
