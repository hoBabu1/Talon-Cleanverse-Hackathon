import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { monadTestnet } from "./chains";

/**
 * Empty in dev until a WalletConnect Cloud project exists (see
 * `.env.local.example`). RainbowKit's default connector set still works
 * with injected wallets (MetaMask) without it — only the WalletConnect/QR
 * flow needs the real id.
 */
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000";

export const wagmiConfig = getDefaultConfig({
  appName: "Talon",
  projectId: walletConnectProjectId,
  chains: [monadTestnet],
  ssr: true,
});
