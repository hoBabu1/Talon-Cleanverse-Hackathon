"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Lock } from "lucide-react";
import Link from "next/link";

/**
 * Full-page "issuer only" wall. Shown when a non-issuer opens an issuer-restricted
 * page directly (the nav already hides these, but the URL is still reachable).
 * Not a security boundary on its own — every write is also gated on-chain by
 * MINTER_ROLE / Ownable — this is the honest UX layer over that.
 */
export function IssuerGate({
  title = "Issuer only",
  message = "You're not the issuer. This tool is restricted to the asset issuer's wallet.",
  publicHref,
  publicLabel,
}: {
  title?: string;
  message?: string;
  publicHref?: string;
  publicLabel?: string;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center md:py-28">
      <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
        <Lock size={28} className="text-accent" />
      </span>
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{message}</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" label="Connect issuer wallet" />
        {publicHref && (
          <Link href={publicHref} className="text-sm font-medium text-accent hover:underline">
            {publicLabel ?? "View the public page instead"} →
          </Link>
        )}
      </div>
    </div>
  );
}
