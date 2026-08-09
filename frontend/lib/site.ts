/**
 * Shared site-wide constants for the landing page.
 * Single source of truth — update here, not inline in components.
 */

/** Entry point of the connected-wallet app (cap table dashboard). */
export const APP_ENTRY = "/register";

/** Public repo. */
export const GITHUB_URL = "https://github.com/hoBabu1/Talon-Cleanverse-Hackathon";

/** Builder's X / Twitter. */
export const X_URL = "https://x.com/thedhanyosmi";

/**
 * Demo video. Paste the YouTube video ID here once the demo is recorded
 * (e.g. "dQw4w9WgXcQ"). While empty, the hero renders a branded
 * "video coming soon" placeholder instead of the player.
 */
export const DEMO_VIDEO_ID = "CT_b-7mUf2U";

/** Monad testnet block explorer (monadvision.com is dead; monadexplorer is the live one). */
export const EXPLORER_ADDRESS_URL = "https://testnet.monadexplorer.com/address/";
export const EXPLORER_TX_URL = "https://testnet.monadexplorer.com/tx/";

export const HACKATHON_URL = "https://cleanverse.com/hackathon";

/**
 * The demo RWA the corporate-action form is about (what the action concerns,
 * not what holders are paid in). Pre-fills the "Asset" field so the issuer
 * doesn't type a 42-char address on camera.
 */
export const DEMO_ASSET = {
  address: "0xbAE642890988C3EF56e77Fb041aFD847A6131d64",
  symbol: "TLNB",
  name: "Talon Bond 2026",
} as const;

/** Landing-page section anchors, shared by Nav and Footer. */
export const NAV_LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#why-talon", label: "Why Talon" },
  { href: "#built-on", label: "Built on" },
] as const;

/** Shorten a 0x address for display: 0xb634…FFB7 */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
