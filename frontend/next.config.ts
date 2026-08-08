import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // RainbowKit's default wallet set pulls in a Coinbase/Base "smart wallet" connector
  // whose SDK dynamically imports an exotic Solana payment package (@x402/svm/...).
  // We don't use that connector — Talon runs on Monad (EVM only) — but Next still
  // tries to statically resolve the import during SSR bundling and fails the build.
  // Marking the whole SDK external stops Next from bundling it; Node resolves it
  // normally at runtime only if that code path is ever actually hit (it won't be).
  serverExternalPackages: ["@coinbase/cdp-sdk", "@base-org/account"],
};

export default nextConfig;
