import type { CSSProperties } from "react";

/**
 * The one identity avatar for a wallet address, used everywhere an address gets
 * a circle: cap table, escrow ledger, audit legs, action snapshots.
 *
 * Replaces four copies of a `gemStyle()` helper whose glyphs said nothing about
 * *which* holder you were looking at — the cap table rendered `meta.label[0]`,
 * so every verified holder was a letter "V", and the escrow/audit rows showed
 * the first address byte, so anything sharing a prefix collided. Both were
 * redundant with the badge and the address sitting right beside them.
 *
 * Colour AND glyph are derived from the address, so the same holder is the same
 * gem on every page — that cross-page recognition is the point. Deterministic,
 * never random: a random pick would differ between server and client render
 * (hydration mismatch) and would change identity on every re-render.
 */

/**
 * Deliberately large: with only ~45 glyphs, a 9-holder register hit a repeat
 * more often than not (birthday paradox), which is the same "they all look
 * alike" complaint in miniature. At ~110 the odds drop sharply, and since hue
 * is hashed independently, two holders who do share a glyph still read as
 * clearly different gems.
 *
 * Every entry is emoji-presentation by default — no U+FE0F variation selectors,
 * which render as monochrome text glyphs on some platforms.
 */
const GEM_EMOJI = [
  // fruit + veg
  "🍇", "🍉", "🍊", "🍋", "🍍", "🥭", "🍎", "🍐", "🍑", "🍒",
  "🍓", "🥝", "🥥", "🥑", "🍅", "🍆", "🥕", "🌽", "🥦", "🥬",
  "🥒", "🧄", "🧅", "🍄", "🌰", "🥜",
  // plants + weather
  "🌵", "🌲", "🌳", "🌴", "🌱", "🌿", "🍀", "🍁", "🍃", "🌷",
  "🌹", "🌺", "🌻", "🌼", "🌸", "💐", "🌙", "⭐", "🌟", "✨",
  "⚡", "🔥", "🌈", "⛄", "💧", "🌊",
  // creatures
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
  "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦅",
  "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌",
  "🐞", "🐢", "🐍", "🦎", "🐙", "🦑", "🦀", "🐡", "🐠", "🐬",
  "🐳", "🦈", "🐊", "🦓", "🦍", "🐘", "🦏", "🐪", "🦒", "🦘",
  "🦌", "🦔",
  // objects
  "🎈", "🎉", "🎁", "🎨", "🎧", "🎸", "🎺", "🎯", "🎲", "🚀",
  "🛸", "🧭", "💎", "🔮", "🍯", "🧩",
] as const;

/** FNV-1a, 32-bit. `Math.imul` keeps the multiply from losing precision. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Addresses reach the UI in mixed casing — EIP-55 checksummed from one source,
 * lowercased from another. Normalising is what makes a holder's gem identical
 * across pages instead of quietly different on each.
 */
export function gemFor(address: string): { emoji: string; style: CSSProperties } {
  const key = address.toLowerCase();
  // Two independently-seeded hashes so hue and glyph don't move together.
  const glyph = hash32(key);
  const hue = hash32(`${key}#hue`) % 360;
  const hue2 = (hue + 38) % 360;

  return {
    emoji: GEM_EMOJI[glyph % GEM_EMOJI.length]!,
    style: {
      // Muted relative to a plain accent fill: the emoji is the foreground, and
      // a fully saturated disc fights it for attention.
      background: `linear-gradient(135deg, hsl(${hue} 52% 44%), hsl(${hue2} 56% 30%))`,
    },
  };
}

const SIZES = {
  sm: "h-9 w-9 text-[15px]",
  md: "h-10 w-10 text-[17px]",
} as const;

interface IdentityGemProps {
  address: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export function IdentityGem({ address, size = "md", className }: IdentityGemProps) {
  const { emoji, style } = gemFor(address);

  return (
    <span
      aria-hidden
      style={style}
      className={[
        "emoji-glyph flex shrink-0 select-none items-center justify-center rounded-full border border-white/10 shadow-inner",
        SIZES[size],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {emoji}
    </span>
  );
}
