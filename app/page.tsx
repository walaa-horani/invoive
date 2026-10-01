import React from "react";
import { Navbar } from "@/components/Navbar";
import { PricingSection } from "@/components/PricingSection";
import { ComparisonTable } from "@/components/ComparisonTable";
import { SocialProof } from "@/components/SocialProof";
import { FaqSection } from "@/components/FaqSection";
import { EnterpriseBanner } from "@/components/EnterpriseBanner";
import { Footer } from "@/components/Footer";

export default function PricingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9ff] text-[#0b1c30]">
      {/* Navigation Bar */}
      <Navbar />

      {/* Main Content Area */}
      <main className="flex-1 w-full">
        {/* Pricing Hero & Cards */}
        <PricingSection />

        {/* Feature Comparison Matrix */}
        <ComparisonTable />

        {/* Testimonials & Security Audit Badges */}
        <SocialProof />

        {/* FAQ Accordion */}
        <FaqSection />

        {/* Enterprise & Custom Volume Banner */}
        <EnterpriseBanner />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
