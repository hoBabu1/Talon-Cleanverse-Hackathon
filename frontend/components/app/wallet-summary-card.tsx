"use client";

import Link from "next/link";
import { ArrowRight, KeyRound, Wallet } from "lucide-react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { Badge } from "@/components/app/badge";
import { STATE_META } from "@/components/app/holder-card";
import { WalletAddress } from "@/components/app/wallet-address";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { useTokenDecimals } from "@/lib/hooks/useTokenDecimals";
import { useEscrow, useHolders } from "@/lib/queries";

/** Shared shell so every state is the same card, not four differently-shaped ones. */
function Shell({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div
      className={`rounded-card border bg-card p-4 ${accent ? "border-accent/40" : "border-edge"}`}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
      {children}
    </p>
  );
}

/**
 * "Your wallet" panel for the desktop sidebar.
 *
 * Answers the one question the cap table can't: where does the person looking at
 * this screen sit in it? Every figure here is read from the queries the pages
 * already run (`useHolders`, `useEscrow`) rather than a private fetch, so the
 * sidebar can never disagree with the table next to it.
 *
 * Desktop-only by placement — `MobileNav` has no room for it.
 */
export function WalletSummaryCard() {
  const { address, isConnected, status } = useAccount();
  const { isOwner, isLoading: ownerLoading } = useIsOwner();

  const holdersQuery = useHolders();
  // Only the "am I a holder with something in escrow" branch needs this, so it stays
  // off for the issuer and for a disconnected visitor.
  const escrowQuery = useEscrow(isConnected && !isOwner && !ownerLoading);

  const { decimals } = useTokenDecimals(holdersQuery.data?.asset);

  // `reconnecting` is the page-load case: wagmi has a stored connection it hasn't
  // restored yet. Rendering "not connected" during it would flash a wrong answer.
  if (status === "connecting" || status === "reconnecting") {
    return (
      <Shell>
        <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
        <div className="mt-3 h-4 w-32 animate-pulse rounded bg-white/5" />
      </Shell>
    );
  }

  if (!isConnected || !address) {
    return (
      <Shell>
        <Label>
          <Wallet size={12} strokeWidth={2} />
          Your wallet
        </Label>
        <p className="text-xs leading-relaxed text-muted">
          Not connected — connect a wallet to see your holdings.
        </p>
      </Shell>
    );
  }

  if (ownerLoading || holdersQuery.isLoading) {
    return (
      <Shell>
        <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
        <div className="mt-3 h-4 w-28 animate-pulse rounded bg-white/5" />
        <div className="mt-2 h-4 w-20 animate-pulse rounded bg-white/5" />
      </Shell>
    );
  }

  if (isOwner) {
    return (
      <Shell accent>
        <Label>
          <KeyRound size={12} strokeWidth={2} />
          Your wallet
        </Label>
        <p className="text-sm font-medium text-accent">You are the issuer</p>
        <div className="mt-2">
          <WalletAddress wallet={address} />
        </div>
        <Link
          href="/actions"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-accent"
        >
          Declare an action
          <ArrowRight size={12} strokeWidth={2} />
        </Link>
      </Shell>
    );
  }

  const holder = holdersQuery.data?.holders.find(
    (h) => h.wallet.toLowerCase() === address.toLowerCase(),
  );

  if (!holder) {
    return (
      <Shell>
        <Label>
          <Wallet size={12} strokeWidth={2} />
          Your wallet
        </Label>
        <div className="mb-2">
          <WalletAddress wallet={address} />
        </div>
        <p className="text-xs leading-relaxed text-muted">You don&apos;t currently hold any TLNB.</p>
      </Shell>
    );
  }

  const held = escrowQuery.data?.liveBalances.find(
    (b) => b.beneficiary.toLowerCase() === address.toLowerCase() && b.held !== "0",
  );

  return (
    <Shell>
      <Label>
        <Wallet size={12} strokeWidth={2} />
        Your wallet
      </Label>
      <WalletAddress wallet={holder.wallet} />
      <p className="mt-2 text-sm text-white">
        {formatUnits(BigInt(holder.balance), decimals)} <span className="text-xs text-muted">TLNB</span>
      </p>
      <div className="mt-2">
        <Badge meta={STATE_META[holder.displayState]} />
      </div>
      {held && (
        <Link
          href="/escrow"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-400 transition-colors hover:text-amber-300"
        >
          You have value held in escrow
          <ArrowRight size={12} strokeWidth={2} />
        </Link>
      )}
    </Shell>
  );
}
