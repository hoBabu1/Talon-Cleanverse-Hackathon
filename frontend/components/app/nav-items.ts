import {
  FileCheck2,
  History,
  Landmark,
  LayoutDashboard,
  ScrollText,
  ShieldAlert,
  UserPlus,
  Vault,
  type LucideIcon,
} from "lucide-react";

export type NavChild = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Issuer-only destinations are hidden from non-issuers entirely (nav + the page itself gates). */
  issuerOnly?: boolean;
};

export type NavItem = {
  /** For a group, this is the PUBLIC landing route (used by the collapsed rail and
   * the mobile tab bar) — never an issuer-only child, so non-issuers always land
   * somewhere they can see. */
  href: string;
  label: string;
  icon: LucideIcon;
  children?: NavChild[];
};

/** Single source of truth for the connected-wallet app's nav.
 *
 * Two groups fan out into issuer-only tools + a public read view:
 *   Register → Onboard (issuer) · Identity (issuer) · Cap Table (all)
 *   Actions  → Corporate Actions (issuer) · History (all)
 * Each group's own `href` points at its PUBLIC child. */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/register",
    label: "Register",
    icon: Landmark,
    children: [
      { href: "/register/onboard", label: "Onboard", icon: UserPlus, issuerOnly: true },
      { href: "/register/identity", label: "Identity", icon: ShieldAlert, issuerOnly: true },
      { href: "/register", label: "Cap Table", icon: LayoutDashboard },
    ],
  },
  {
    href: "/actions/history",
    label: "Actions",
    icon: ScrollText,
    children: [
      { href: "/actions", label: "Corporate Actions", icon: ScrollText, issuerOnly: true },
      { href: "/actions/history", label: "History", icon: History },
    ],
  },
  { href: "/escrow", label: "Escrow", icon: Vault },
  { href: "/audit", label: "Audit", icon: FileCheck2 },
];

/** Flattened leaf destinations for the mobile tab bar (no nested groups). Uses each
 * group's PUBLIC href, so a non-issuer tapping a tab always lands on a visible page. */
export const MOBILE_NAV_ITEMS = NAV_ITEMS.map(({ href, label, icon }) => ({ href, label, icon }));
