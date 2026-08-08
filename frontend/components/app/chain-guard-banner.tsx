"use client";

import { useSwitchChain } from "wagmi";
import { useIsCorrectChain } from "@/lib/hooks/useIsCorrectChain";

/** Persistent banner when a connected wallet is on the wrong network. */
export default function ChainGuardBanner() {
  const { isCorrectChain, expectedChainId } = useIsCorrectChain();
  const { switchChain, isPending } = useSwitchChain();

  if (isCorrectChain) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-2.5 text-center text-sm font-medium text-white">
      <span>Wrong network — switch to Monad Testnet</span>
      <button
        type="button"
        onClick={() => switchChain({ chainId: expectedChainId })}
        disabled={isPending}
        className="rounded-card bg-black/20 px-3 py-1 text-xs font-semibold transition-colors hover:bg-black/30 disabled:opacity-60"
      >
        {isPending ? "Switching…" : "Switch network"}
      </button>
    </div>
  );
}
