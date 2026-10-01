import React from "react";
import Link from "next/link";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="w-full bg-white border-t border-[#e5eeff] shadow-[0_-1px_8px_rgba(0,0,0,0.02)] pt-16 pb-12">
      <div className="max-w-[1280px] mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-10 pb-14 border-b border-[#e5eeff]">
          {/* Logo & Newsletter Column */}
          <div className="lg:col-span-2 flex flex-col gap-4 pr-0 lg:pr-6">
            <Link href="/" className="hover:opacity-90 transition-opacity">
              <Logo />
            </Link>
            <p className="text-xs md:text-sm text-[#45464d] max-w-sm leading-relaxed">
              Enterprise-grade billing and automated subscription infrastructure built for global
              scale, audit transparency, and fiscal precision.
            </p>

            <div className="flex flex-col gap-1.5 pt-2">
              <span className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider">
                Subscribe to Product Updates
              </span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="email"
                  placeholder="work@company.com"
                  className="bg-[#f8f9ff] text-[#0b1c30] border border-[#dce9ff] placeholder:text-[#76777d] text-xs px-3.5 py-2.5 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-[#0051d5]"
                />
                <button
                  type="button"
                  className="bg-[#0f172a] hover:bg-[#1e293b] text-white text-xs font-semibold px-4 py-2.5 rounded-xl shrink-0 transition-colors shadow-xs"
                >
                  Join
                </button>
              </div>
            </div>
          </div>

          {/* Product Column */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0b1c30]">Product</h3>
            <ul className="flex flex-col gap-2 text-xs text-[#45464d]">
              <li>
                <a href="#features" className="hover:text-[#0051d5] transition-colors">
                  Recurring Invoicing
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#0051d5] transition-colors">
                  Usage Metering
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#0051d5] transition-colors">
                  Smart Dunning
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#0051d5] transition-colors">
                  Revenue Recognition
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#0051d5] transition-colors">
                  Multi-Currency
                </a>
              </li>
            </ul>
          </div>

          {/* Solutions Column */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0b1c30]">Solutions</h3>
            <ul className="flex flex-col gap-2 text-xs text-[#45464d]">
              <li>
                <a href="#solutions" className="hover:text-[#0051d5] transition-colors">
                  B2B SaaS
                </a>
              </li>
              <li>
                <a href="#solutions" className="hover:text-[#0051d5] transition-colors">
                  Consultancies
                </a>
              </li>
              <li>
                <a href="#solutions" className="hover:text-[#0051d5] transition-colors">
                  Digital Agencies
                </a>
              </li>
              <li>
                <a href="#solutions" className="hover:text-[#0051d5] transition-colors">
                  Marketplaces
                </a>
              </li>
              <li>
                <a href="#solutions" className="hover:text-[#0051d5] transition-colors">
                  Enterprise Sales
                </a>
              </li>
            </ul>
          </div>

          {/* Resources Column */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0b1c30]">Resources</h3>
            <ul className="flex flex-col gap-2 text-xs text-[#45464d]">
              <li>
                <a href="#documentation" className="hover:text-[#0051d5] transition-colors">
                  API Documentation
                </a>
              </li>
              <li>
                <a href="#documentation" className="hover:text-[#0051d5] transition-colors">
                  SDK Libraries
                </a>
              </li>
              <li>
                <a href="#documentation" className="hover:text-[#0051d5] transition-colors">
                  System Status
                </a>
              </li>
              <li>
                <a href="#documentation" className="hover:text-[#0051d5] transition-colors">
                  Compliance Whitepapers
                </a>
              </li>
              <li>
                <a href="#documentation" className="hover:text-[#0051d5] transition-colors">
                  Engineering Blog
                </a>
              </li>
            </ul>
          </div>

          {/* Company & Legal Column */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0b1c30]">Company</h3>
            <ul className="flex flex-col gap-2 text-xs text-[#45464d]">
              <li>
                <a href="#about" className="hover:text-[#0051d5] transition-colors">
                  About Us
                </a>
              </li>
              <li>
                <a href="#careers" className="hover:text-[#0051d5] transition-colors">
                  Careers
                </a>
              </li>
              <li>
                <a href="#privacy" className="hover:text-[#0051d5] transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#terms" className="hover:text-[#0051d5] transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#security" className="hover:text-[#0051d5] transition-colors">
                  Security Portal
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar: Trust Badges and Copyright */}
        <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 bg-[#f8f9ff] border border-[#dce9ff] px-3 py-1 rounded-lg">
              <span className="material-symbols-outlined text-[#0051d5] text-[16px]">
                verified_user
              </span>
              <span className="text-xs font-medium text-[#0b1c30]">SOC2 Type II</span>
            </div>
            <div className="flex items-center gap-1.5 bg-[#f8f9ff] border border-[#dce9ff] px-3 py-1 rounded-lg">
              <span className="material-symbols-outlined text-[#0051d5] text-[16px]">lock</span>
              <span className="text-xs font-medium text-[#0b1c30]">256-bit SSL</span>
            </div>
            <div className="flex items-center gap-1.5 bg-[#f8f9ff] border border-[#dce9ff] px-3 py-1 rounded-lg">
              <span className="material-symbols-outlined text-[#0051d5] text-[16px]">shield</span>
              <span className="text-xs font-medium text-[#0b1c30]">GDPR Compliant</span>
            </div>
          </div>

          <div className="text-xs text-[#76777d] text-center md:text-right">
            &copy; 2025 LedgerFlow Technologies Inc. All rights reserved. Precision financial infrastructure.
          </div>
        </div>
      </div>
    </footer>
  );
}
