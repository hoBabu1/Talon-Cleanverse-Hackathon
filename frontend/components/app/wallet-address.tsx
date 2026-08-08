"use client";

import { Check, Copy, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { shortAddress } from "@/lib/site";

/**
 * Shortened wallet address with a copy-to-clipboard button. Shared shell for
 * what used to be two separately-named, identically-behaving components
 * (`WalletAddress` in holder-card, `CopyableAddress` in the escrow page).
 * `copiedIcon` preserves each call site's original checkmark glyph (`Check`
 * vs `CheckCircle2`) since that's the one pixel difference between the two.
 */
export function WalletAddress({
  wallet,
  copiedIcon: CopiedIcon = Check,
}: {
  wallet: string;
  copiedIcon?: LucideIcon;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — nothing actionable to do.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={wallet}
      className="inline-flex items-center gap-1.5 font-mono text-sm text-white transition-colors hover:text-accent"
    >
      {shortAddress(wallet)}
      {copied ? <CopiedIcon size={13} className="text-emerald-400" /> : <Copy size={13} className="text-muted" />}
    </button>
  );
}
