"use client";

import { useAccount, useReadContract } from "wagmi";
import addresses from "@/lib/generated/addresses.json";
import corporateActionManagerAbi from "@/lib/generated/CorporateActionManager.abi.json";

/**
 * Reads CorporateActionManager.owner() once and compares it against the
 * connected wallet. Shared by every layer that needs to gate issuer-only
 * controls (declare/execute/close) — read-only views must never be gated.
 */
export function useIsOwner() {
  const { address, isConnected } = useAccount();

  const { data: owner, isLoading } = useReadContract({
    address: addresses.CorporateActionManager as `0x${string}`,
    abi: corporateActionManagerAbi,
    functionName: "owner",
  });

  const ownerAddress = owner as `0x${string}` | undefined;
  const isOwner = Boolean(
    isConnected && address && ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase(),
  );

  return { owner: ownerAddress, isOwner, isLoading };
}
