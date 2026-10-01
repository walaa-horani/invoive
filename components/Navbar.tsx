"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Logo } from "./Logo";

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#f8f9ff]/90 backdrop-blur-md border-b border-[#e5eeff] shadow-[0_1px_8px_rgba(0,0,0,0.03)]">
      {/* Announcement Ribbon */}
      <div className="bg-[#131b2e] text-[#dae2fd] px-4 py-2 text-center text-xs tracking-wide">
        <div className="max-w-[1280px] mx-auto flex items-center justify-center gap-2">
          <span className="text-[#dae2fd]/90 font-medium">
            Announcing Automated Multi-Currency Recurring Billing —
          </span>
          <a
            href="#pricing"
            className="text-[#85f8c4] font-semibold underline underline-offset-4 hover:text-white transition-colors"
          >
            Learn more &rarr;
          </a>
        </div>
      </div>

      {/* Main Bar */}
      <div className="h-16 max-w-[1280px] mx-auto px-6 md:px-8 flex items-center justify-between gap-6">
        <Link href="/" className="hover:opacity-90 transition-opacity">
          <Logo />
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden lg:flex items-center gap-7">
          <Link
            href="#features"
            className="text-sm font-medium text-[#45464d] hover:text-[#0b1c30] transition-colors py-1 px-2"
          >
            Features
          </Link>
          <Link
            href="#solutions"
            className="text-sm font-medium text-[#45464d] hover:text-[#0b1c30] transition-colors py-1 px-2"
          >
            Solutions
          </Link>
          <Link
            href="#pricing"
            className="text-sm font-semibold text-[#0051d5] bg-[#eff4ff] rounded-lg px-3 py-1.5 transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="#customers"
            className="text-sm font-medium text-[#45464d] hover:text-[#0b1c30] transition-colors py-1 px-2"
          >
            Customers
          </Link>
          <Link
            href="#documentation"
            className="text-sm font-medium text-[#45464d] hover:text-[#0b1c30] transition-colors py-1 px-2"
          >
            Documentation
          </Link>
        </nav>

        {/* Right CTA Actions */}
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="hidden sm:inline-block text-sm font-medium text-[#45464d] hover:text-[#0b1c30] transition-colors px-3 py-1.5"
          >
            Sign in
          </Link>
          <Link
            href="#pricing"
            className="text-sm font-semibold bg-[#0f172a] hover:bg-[#1e293b] text-white px-4 py-2 rounded-lg shadow-sm transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            Start Free Trial
          </Link>

          {/* User Icon Avatar */}
          <div className="hidden sm:flex w-8 h-8 rounded-full bg-[#131b2e] items-center justify-center text-white shrink-0 shadow-inner">
            <span className="material-symbols-outlined text-[18px]">person</span>
          </div>

          {/* Mobile Hamburger Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 text-[#0b1c30] rounded-lg hover:bg-[#eff4ff] focus:outline-none"
            aria-label="Toggle navigation menu"
          >
            <span className="material-symbols-outlined text-[24px]">
              {mobileMenuOpen ? "close" : "menu"}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Nav Dropdown */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white border-b border-[#e5eeff] px-6 py-4 space-y-3 shadow-lg animate-in fade-in slide-in-from-top-2">
          <Link
            href="#features"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-medium text-[#45464d] hover:text-[#0b1c30] py-2"
          >
            Features
          </Link>
          <Link
            href="#solutions"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-medium text-[#45464d] hover:text-[#0b1c30] py-2"
          >
            Solutions
          </Link>
          <Link
            href="#pricing"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-semibold text-[#0051d5] bg-[#eff4ff] rounded-lg px-3 py-2"
          >
            Pricing
          </Link>
          <Link
            href="#customers"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-medium text-[#45464d] hover:text-[#0b1c30] py-2"
          >
            Customers
          </Link>
          <Link
            href="#documentation"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-sm font-medium text-[#45464d] hover:text-[#0b1c30] py-2"
          >
            Documentation
          </Link>
          <div className="pt-2 border-t border-gray-100 flex flex-col gap-2">
            <Link
              href="/login"
              className="text-sm font-medium text-[#45464d] hover:text-[#0b1c30] py-2 text-center"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
