"use client";

import { useAccount, useChainId } from "wagmi";
import { monadTestnet } from "@/lib/chains";

/**
 * True only when a wallet is connected AND on Monad testnet. Disconnected
 * wallets are not "wrong network" — there's nothing to warn about yet.
 * Later layers gate writes on this; this layer only surfaces the banner.
 */
export function useIsCorrectChain() {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  const isCorrectChain = !isConnected || chainId === monadTestnet.id;

  return { isCorrectChain, chainId, expectedChainId: monadTestnet.id };
}
