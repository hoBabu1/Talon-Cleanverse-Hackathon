/**
 * Shared site-wide constants for the landing page.
 * Single source of truth — update here, not inline in components.
 */

/** Entry point of the connected-wallet app (cap table dashboard). */
export const APP_ENTRY = "/register";

/** Public repo. TODO: replace with the real repository URL before submission. */
export const GITHUB_URL = "https://github.com/REPLACE-WITH-TALON-REPO";

/**
 * Demo video. Paste the YouTube video ID here once the demo is recorded
 * (e.g. "dQw4w9WgXcQ"). While empty, the hero renders a branded
 * "video coming soon" placeholder instead of the player.
 */
export const DEMO_VIDEO_ID = "";

/** Monad testnet block explorer (monadvision.com is dead; monadexplorer is the live one). */
export const EXPLORER_ADDRESS_URL = "https://testnet.monadexplorer.com/address/";
export const EXPLORER_TX_URL = "https://testnet.monadexplorer.com/tx/";

export const HACKATHON_URL = "https://cleanverse.com/hackathon";

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
