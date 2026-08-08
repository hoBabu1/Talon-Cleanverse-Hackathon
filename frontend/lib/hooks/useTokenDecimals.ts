"use client";

import { useReadContract } from "wagmi";

const DECIMALS_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/**
 * Reads `decimals()` off an ERC-20-shaped token address. Shared by every page
 * that formats a token amount — was previously reimplemented per file with
 * drifting fallback values (0, 18) while the read was in flight.
 */
export function useTokenDecimals(token: string | undefined) {
  const isAddress = Boolean(token && /^0x[a-fA-F0-9]{40}$/.test(token));
  const { data, isLoading } = useReadContract({
    address: isAddress ? (token as `0x${string}`) : undefined,
    abi: DECIMALS_ABI,
    functionName: "decimals",
    query: { enabled: isAddress },
  });
  return { decimals: data ?? 6, isLoading };
}
