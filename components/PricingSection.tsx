"use client";

import React, { useState } from "react";

export function PricingSection() {
  const [isAnnual, setIsAnnual] = useState(true);

  return (
    <section id="pricing" className="relative w-full pt-32 pb-20 overflow-hidden">
      {/* Ambient Top Glow Effect */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[760px] h-[360px] bg-gradient-to-b from-[#b4c5ff]/35 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="max-w-[1280px] mx-auto px-6 md:px-8 flex flex-col items-center text-center">
        {/* Eyebrow Pill */}
        <div className="inline-flex items-center gap-2 bg-[#eff4ff] border border-[#dce9ff] px-4 py-1.5 rounded-full shadow-sm mb-6">
          <span className="material-symbols-outlined text-[#0051d5] text-[18px]">
            auto_awesome
          </span>
          <span className="font-semibold text-xs tracking-wider uppercase text-[#0051d5]">
            Simple, Predictable Pricing
          </span>
        </div>

        {/* Main Headline */}
        <h1 className="font-display-xl text-[#0b1c30] max-w-4xl tracking-tight mb-4">
          Scalable invoicing built for independent operators and growing agencies
        </h1>
        <p className="font-body-lg text-[#45464d] max-w-2xl mb-10 text-balance">
          Choose the plan that fits your client roster. Switch plans or cancel anytime with zero
          lock-in or hidden processing markups.
        </p>

        {/* Billing Switcher Toggle */}
        <div className="flex items-center gap-1.5 bg-[#eff4ff] border border-[#dce9ff] p-1.5 rounded-2xl shadow-sm mb-6">
          <button
            type="button"
            onClick={() => setIsAnnual(false)}
            className={`font-medium text-sm px-5 py-2 rounded-xl transition-all ${
              !isAnnual
                ? "bg-white text-[#0b1c30] shadow-sm font-semibold"
                : "text-[#45464d] hover:text-[#0b1c30]"
            }`}
          >
            Monthly Billing
          </button>
          <button
            type="button"
            onClick={() => setIsAnnual(true)}
            className={`font-medium text-sm px-5 py-2 rounded-xl transition-all flex items-center gap-2 ${
              isAnnual
                ? "bg-white text-[#0b1c30] shadow-sm font-semibold"
                : "text-[#45464d] hover:text-[#0b1c30]"
            }`}
          >
            Annual Billing
            <span className="bg-[#85f8c4] text-[#002114] text-xs px-2.5 py-0.5 rounded-full font-bold shadow-xs">
              Save 20% + 2 Mo Free
            </span>
          </button>
        </div>

        {/* Micro Trust Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-[#45464d] text-sm mb-16">
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[#0051d5] text-[18px]">
              check_circle
            </span>
            14-day free trial
          </span>
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[#0051d5] text-[18px]">
              check_circle
            </span>
            No credit card required
          </span>
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[#0051d5] text-[18px]">
              check_circle
            </span>
            0% transaction markups
          </span>
        </div>

        {/* 3-Column Pricing Cards Grid */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch text-left">
          {/* Tier 1: Starter */}
          <div className="flex flex-col bg-white rounded-2xl p-7 md:p-9 border border-[#dce9ff] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all relative">
            <div className="flex flex-col gap-1 mb-6">
              <span className="text-xs uppercase tracking-wider text-[#76777d] font-bold">
                Starter Plan
              </span>
              <h2 className="font-headline-md text-[#0b1c30]">Freelancer &amp; Solo</h2>
              <p className="text-xs text-[#45464d] leading-relaxed">
                Ideal for independent contractors, consultants, and solo practitioners establishing
                automated billing.
              </p>
            </div>

            {/* Price Display */}
            <div className="flex items-baseline gap-1 my-4">
              <span className="text-2xl font-bold text-[#0b1c30]">$</span>
              <span className="font-code-num text-5xl font-extrabold text-[#0b1c30] tracking-tight">
                {isAnnual ? "15" : "19"}
              </span>
              <span className="text-sm text-[#45464d]">/month</span>
            </div>
            <span className="text-xs font-semibold text-[#069669] -mt-2 mb-6">
              {isAnnual ? "Billed annually ($180/yr)" : "Billed month-to-month"}
            </span>

            {/* Limits Box */}
            <div className="bg-[#f8f9ff] border border-[#e5eeff] rounded-xl p-4 mb-7 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Active Clients</span>
                <span className="font-code-num font-semibold">5 Roster limit</span>
              </div>
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Monthly Invoices</span>
                <span className="font-code-num font-semibold">25 Invoices / mo</span>
              </div>
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Team Seats</span>
                <span className="font-code-num font-semibold">1 Dedicated Seat</span>
              </div>
            </div>

            {/* CTA Button */}
            <button
              type="button"
              className="w-full bg-[#eff4ff] hover:bg-[#dce9ff] text-[#0b1c30] font-semibold text-sm py-3.5 px-4 rounded-xl border border-[#dce9ff] shadow-xs transition-all transform hover:-translate-y-0.5 mb-7 active:translate-y-0"
            >
              Start 14-Day Free Trial
            </button>

            {/* Features */}
            <span className="text-xs font-bold uppercase tracking-wider text-[#0b1c30] mb-3">
              Core Capabilities Included:
            </span>
            <ul className="flex flex-col gap-3 text-xs text-[#45464d] flex-1">
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Automated recurring invoices &amp; polite reminders</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Online payments via Stripe &amp; PayPal (0% platform markup)</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Custom invoice branding, clean vector PDF export</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Basic expense &amp; receipt photo ledger</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Standard email technical support (24h response)</span>
              </li>
            </ul>

            <div className="pt-6 mt-6 border-t border-gray-100 text-center">
              <span className="text-xs text-[#76777d]">Cancel anytime with 1-click</span>
            </div>
          </div>

          {/* Tier 2: Growth (MOST POPULAR) */}
          <div className="flex flex-col bg-gradient-to-b from-[#eff4ff]/60 to-white rounded-2xl p-7 md:p-9 border-2 border-[#0051d5] shadow-[0_12px_36px_-6px_rgba(0,81,213,0.18)] hover:shadow-[0_16px_44px_-6px_rgba(0,81,213,0.24)] transition-all relative lg:-mt-4 lg:mb-4">
            {/* Recommended Pill */}
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#0051d5] text-white text-xs px-4 py-1 rounded-full uppercase tracking-wider font-bold shadow-md whitespace-nowrap">
              Most Popular — Best for Expanding Teams
            </div>

            <div className="flex flex-col gap-1 mb-6 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-[#0051d5] font-bold">
                  Growth Plan
                </span>
                <span className="bg-[#dbe1ff] text-[#00174b] font-code-num text-xs px-2.5 py-0.5 rounded font-semibold">
                  Scaling Tier
                </span>
              </div>
              <h2 className="font-headline-md text-[#0b1c30]">Studio &amp; Consultancies</h2>
              <p className="text-xs text-[#45464d] leading-relaxed">
                Built for boutique creative studios, engineering consultancies, and multi-client
                practices.
              </p>
            </div>

            {/* Price Display */}
            <div className="flex items-baseline gap-1 my-4">
              <span className="text-2xl font-bold text-[#0051d5]">$</span>
              <span className="font-code-num text-5xl font-extrabold text-[#0b1c30] tracking-tight">
                {isAnnual ? "39" : "49"}
              </span>
              <span className="text-sm text-[#45464d]">/month</span>
            </div>
            <span className="text-xs font-semibold text-[#069669] -mt-2 mb-6">
              {isAnnual ? "Billed annually ($468/yr)" : "Billed month-to-month"}
            </span>

            {/* Limits Box */}
            <div className="bg-[#eff4ff] border border-[#dbe1ff] rounded-xl p-4 mb-7 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Active Clients</span>
                <span className="font-code-num font-bold text-[#0051d5]">25 Active Clients</span>
              </div>
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Monthly Invoices</span>
                <span className="font-code-num font-semibold text-[#0b1c30]">
                  Unlimited Invoices &amp; Quotes
                </span>
              </div>
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Team Seats</span>
                <span className="font-code-num font-semibold">3 Seats ($10/mo additional)</span>
              </div>
            </div>

            {/* CTA Button */}
            <button
              type="button"
              className="w-full bg-[#0051d5] hover:bg-[#003ea8] text-white font-bold text-sm py-3.5 px-4 rounded-xl shadow-md transition-all transform hover:-translate-y-0.5 mb-7 active:translate-y-0"
            >
              Get Started with Growth
            </button>

            {/* Features */}
            <span className="text-xs font-bold uppercase tracking-wider text-[#0b1c30] mb-3">
              Everything in Starter, plus:
            </span>
            <ul className="flex flex-col gap-3 text-xs text-[#0b1c30] flex-1">
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#0051d5] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span className="font-medium">Multi-currency billing (135+ global currencies)</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#0051d5] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Client self-service portal with instant approval &amp; signature</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#0051d5] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Smart automated late fee penalties &amp; milestone schedules</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#0051d5] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Bi-directional QuickBooks &amp; Xero ledger synchronization</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#0051d5] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Priority Slack channel &amp; email support (2h SLA)</span>
              </li>
            </ul>

            <div className="pt-6 mt-6 border-t border-[#dbe1ff] text-center">
              <span className="text-xs font-semibold text-[#0051d5]">
                14 days free &bull; Seamless instant upgrade
              </span>
            </div>
          </div>

          {/* Tier 3: Agency */}
          <div className="flex flex-col bg-white rounded-2xl p-7 md:p-9 border border-[#dce9ff] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all relative">
            <div className="flex flex-col gap-1 mb-6">
              <span className="text-xs uppercase tracking-wider text-[#76777d] font-bold">
                Scale &amp; Enterprise
              </span>
              <h2 className="font-headline-md text-[#0b1c30]">Full Agency</h2>
              <p className="text-xs text-[#45464d] leading-relaxed">
                Customized governance and unlimited billing throughput for multi-department
                organizations.
              </p>
            </div>

            {/* Price Display */}
            <div className="flex items-baseline gap-1 my-4">
              <span className="text-2xl font-bold text-[#0b1c30]">$</span>
              <span className="font-code-num text-5xl font-extrabold text-[#0b1c30] tracking-tight">
                {isAnnual ? "95" : "119"}
              </span>
              <span className="text-sm text-[#45464d]">/month</span>
            </div>
            <span className="text-xs font-semibold text-[#069669] -mt-2 mb-6">
              {isAnnual ? "Billed annually ($1,140/yr)" : "Billed month-to-month"}
            </span>

            {/* Limits Box */}
            <div className="bg-[#f8f9ff] border border-[#e5eeff] rounded-xl p-4 mb-7 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Active Clients</span>
                <span className="font-code-num font-semibold text-[#0b1c30]">
                  Unlimited Clients
                </span>
              </div>
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Monthly Invoices</span>
                <span className="font-code-num font-semibold text-[#0b1c30]">
                  Unlimited Retainers
                </span>
              </div>
              <div className="flex items-center justify-between text-[#0b1c30]">
                <span className="text-[#45464d]">Team Seats</span>
                <span className="font-code-num font-semibold">10 Seats Included + RBAC</span>
              </div>
            </div>

            {/* CTA Button */}
            <button
              type="button"
              className="w-full bg-[#0f172a] hover:bg-[#1e293b] text-white font-semibold text-sm py-3.5 px-4 rounded-xl shadow-xs transition-all transform hover:-translate-y-0.5 mb-7 active:translate-y-0"
            >
              Start Agency Trial
            </button>

            {/* Features */}
            <span className="text-xs font-bold uppercase tracking-wider text-[#0b1c30] mb-3">
              Everything in Growth, plus:
            </span>
            <ul className="flex flex-col gap-3 text-xs text-[#45464d] flex-1">
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span className="font-medium text-[#0b1c30]">
                  White-label portal on custom domain (portal.youragency.com)
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Advanced multi-entity &amp; project budget burndown tracking</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Automated contractor timesheet to invoice synthesizer</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Dedicated customer success rep &amp; tailored migration concierge</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#069669] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>Custom Master Service Agreements (MSA) &amp; e-signatures</span>
              </li>
            </ul>

            <div className="pt-6 mt-6 border-t border-gray-100 text-center">
              <span className="text-xs text-[#76777d]">
                Custom billing cycles &amp; direct invoicing available
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
