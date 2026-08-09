import BuiltOn from "@/components/landing/BuiltOn";
import ClosingCTA from "@/components/landing/ClosingCTA";
import Features from "@/components/landing/Features";
import Footer from "@/components/landing/Footer";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import Nav from "@/components/landing/Nav";
import Problem from "@/components/landing/Problem";
import ScrollProgress from "@/components/landing/ScrollProgress";

/**
 * Public marketing landing page. The connected-wallet app lives under
 * /register, /actions, /escrow, /audit — untouched by this page.
 * Smooth scroll is mounted globally in the root layout.
 */
export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-ink font-sans text-white">
      <ScrollProgress />
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <BuiltOn />
        <ClosingCTA />
      </main>
      <Footer />
    </div>
  );
}
