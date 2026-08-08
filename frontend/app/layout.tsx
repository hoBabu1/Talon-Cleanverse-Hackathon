import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import SmoothScroll from "@/components/landing/SmoothScroll";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const description =
  "Talon runs the full corporate-action lifecycle for Cleanverse-verified RWAs on Monad: live cap table, declared actions, pay-date re-verification, direct payout or per-beneficiary escrow — with 0% forfeited and a full audit trail.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Talon — On-chain transfer agent for verified real-world assets",
  description,
  openGraph: {
    title: "Talon — On-chain transfer agent for verified real-world assets",
    description,
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${poppins.variable} h-full antialiased`}>
      <body className="min-h-full bg-ink font-sans text-white">
        <SmoothScroll>
          <Providers>{children}</Providers>
        </SmoothScroll>
      </body>
    </html>
  );
}
