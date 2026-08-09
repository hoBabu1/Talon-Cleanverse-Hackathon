"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AlertTriangle, ChevronsLeft, ChevronsRight, Lock, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { IdentityGem } from "./identity-gem";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { NAV_ITEMS, type NavChild, type NavItem } from "./nav-items";
import { useSidebar } from "./sidebar-context";

/** Longest matching href wins, so /register/onboard doesn't also light up /register. */
function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop-only (`md:` and up) fixed left sidebar: collapsible, hover-peek,
 * and drag-resizable. Mobile uses `MobileNav`. */
export default function Sidebar() {
  const pathname = usePathname();
  const { isOwner } = useIsOwner();
  const { pinned, expanded, railWidth, togglePinned, setHovering, setWidth } = useSidebar();

  const draggingRef = useRef(false);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setWidth(e.clientX);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setWidth]);

  return (
    <aside
      onMouseEnter={() => !pinned && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{ width: railWidth }}
      className="group/sidebar fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-edge bg-card shadow-[8px_0_24px_-16px_rgba(0,0,0,0.6)] transition-[width] duration-200 ease-out md:flex"
    >
      {/* Brand */}
      <Link
        href="/"
        className={`flex items-center gap-2.5 px-4 py-5 ${expanded ? "" : "justify-center px-0"}`}
        aria-label="Talon — home"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-edge">
          <Image src="/brand/talon-mark.png" alt="Talon logo" width={36} height={36} className="h-full w-full object-cover" />
        </span>
        {expanded && <span className="whitespace-nowrap text-lg font-bold tracking-tight text-white">Talon</span>}
      </Link>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-1" aria-label="Primary">
        {NAV_ITEMS.map((item) =>
          item.children ? (
            <NavGroup key={item.href} item={item} pathname={pathname} expanded={expanded} isOwner={isOwner} />
          ) : (
            <NavLeaf
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActivePath(pathname, item.href)}
              expanded={expanded}
            />
          ),
        )}
      </nav>

      {/* Collapse / pin control */}
      <div className="px-2.5 pb-1">
        <button
          type="button"
          onClick={togglePinned}
          aria-label={pinned ? "Collapse sidebar" : "Expand sidebar"}
          className={`flex w-full items-center gap-3 rounded-card px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-white/5 hover:text-white ${expanded ? "" : "justify-center px-0"}`}
        >
          {pinned ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
          {expanded && <span>Collapse</span>}
        </button>
      </div>

      <div className={`mt-auto border-t border-edge p-3 ${expanded ? "" : "flex justify-center px-0"}`}>
        {expanded ? (
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" label="Connect" />
        ) : (
          <RailWalletButton />
        )}
      </div>

      {/* Drag handle — only meaningful while pinned open */}
      {pinned && (
        <div
          onMouseDown={onDragStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize"
          className="absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize"
        >
          <span className="absolute inset-y-0 right-1 w-px bg-transparent transition-colors hover:bg-accent/60" />
        </div>
      )}
    </aside>
  );
}

/**
 * The wallet control for the COLLAPSED rail.
 *
 * RainbowKit's own button can't fit here. `accountStatus` only governs the connected
 * state, so while disconnected it renders the full "Connect" label at 92px inside a 68px
 * rail — measured overflowing 11.5px past the rail and starting at x=-12.5, i.e. clipped
 * off the left edge of the viewport. `ConnectButton.Custom` is RainbowKit's supported
 * escape hatch: it hands over the same modals while we own the markup, so one 40px control
 * covers every state instead of three differently-sized built-in ones.
 *
 * Connected renders the wallet's IdentityGem — the same deterministic avatar the cap table,
 * escrow and audit pages use for that address, so the rail says "this is who you are" in
 * the visual language the rest of the app already established.
 */
function RailWalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        // `mounted` guards against rendering wallet state during hydration, when it isn't
        // known yet — otherwise the rail briefly claims "disconnected" for a connected user.
        const ready = mounted;
        const connected = ready && account && chain;

        const base =
          "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

        if (!ready) {
          return <span className={`${base} bg-ink`} aria-hidden />;
        }

        if (!connected) {
          return (
            <button type="button" onClick={openConnectModal} title="Connect wallet" aria-label="Connect wallet"
              className={`${base} bg-accent text-white shadow-[0_10px_36px_rgba(248,101,28,0.28)] hover:bg-[#ff7a38]`}>
              <Wallet size={18} />
            </button>
          );
        }

        // Wrong network is its own state, not a variant of "connected": every write would
        // revert, so it gets the alarming colour and routes to the chain switcher.
        if (chain.unsupported) {
          return (
            <button type="button" onClick={openChainModal} title="Wrong network — switch to Monad testnet"
              aria-label="Wrong network — switch to Monad testnet"
              className={`${base} border border-red-400/40 bg-red-400/10 text-red-300 hover:border-red-400/70`}>
              <AlertTriangle size={18} />
            </button>
          );
        }

        return (
          <button type="button" onClick={openAccountModal} title={`${account.displayName} — ${chain.name}`}
            aria-label={`Wallet ${account.displayName}, ${chain.name}. Open account options.`}
            className={`${base} hover:opacity-90`}>
            <IdentityGem address={account.address} />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function NavLeaf({
  href,
  label,
  icon: Icon,
  active,
  expanded,
  issuerOnly,
  isOwner,
  nested,
}: {
  href: string;
  label: string;
  icon: NavItem["icon"];
  active: boolean;
  expanded: boolean;
  issuerOnly?: boolean;
  isOwner?: boolean;
  nested?: boolean;
}) {
  const lockable = issuerOnly && !isOwner;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={expanded ? undefined : label}
      className={`group/leaf relative flex items-center gap-3 rounded-card px-3 py-2.5 text-sm font-medium transition-colors ${
        expanded ? "" : "justify-center px-0"
      } ${nested ? "text-[13px]" : ""} ${
        active ? "bg-accent/15 text-accent" : "text-muted hover:bg-white/5 hover:text-white"
      }`}
    >
      {active && expanded && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
      <Icon size={nested ? 16 : 18} strokeWidth={2} className="shrink-0" />
      {expanded && (
        <span className="flex flex-1 items-center gap-1.5 whitespace-nowrap">
          {label}
          {lockable && <Lock size={11} className="text-muted/60" aria-label="Issuer only" />}
        </span>
      )}
    </Link>
  );
}

function NavGroup({
  item,
  pathname,
  expanded,
  isOwner,
}: {
  item: NavItem;
  pathname: string;
  expanded: boolean;
  isOwner: boolean;
}) {
  // Issuer-only children are hidden entirely from non-issuers — the nav never even
  // hints at tools they can't use. Every group still keeps at least one public child.
  const children = (item.children ?? []).filter((c) => isOwner || !c.issuerOnly);
  // The active child is the one whose href is the longest match — so /register
  // (Cap Table) never steals the highlight from /register/onboard.
  const activeChildHref = children
    .filter((c) => isActivePath(pathname, c.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // Collapsed rail: render just the group's icon as a link to its landing child.
  if (!expanded) {
    const groupActive = children.some((c) => c.href === activeChildHref);
    return (
      <NavLeaf
        href={item.href}
        label={item.label}
        icon={item.icon}
        active={groupActive}
        expanded={false}
      />
    );
  }

  return (
    <div className="mt-1">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted/50">{item.label}</p>
      <div className="flex flex-col gap-0.5">
        {children.map((child: NavChild) => (
          <NavLeaf
            key={child.href}
            href={child.href}
            label={child.label}
            icon={child.icon}
            active={child.href === activeChildHref}
            expanded
            issuerOnly={child.issuerOnly}
            isOwner={isOwner}
            nested
          />
        ))}
      </div>
    </div>
  );
}
