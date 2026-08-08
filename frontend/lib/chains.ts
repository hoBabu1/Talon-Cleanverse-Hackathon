import { defineChain } from "viem";

/**
 * Monad testnet — not in viem's built-in chain list (confirmed before
 * writing this), so it's defined by hand from the same RPC used everywhere
 * else in the project (see `lib/generated/addresses.json`).
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadvision.com",
    },
  },
  testnet: true,
});
