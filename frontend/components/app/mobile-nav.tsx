"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV_ITEMS } from "./nav-items";

/** Compact top bar (logo + wallet) and bottom tab bar, both `<md` only. */
export function MobileTopBar() {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-edge bg-card px-4 py-3 md:hidden">
      <Link href="/" className="flex items-center gap-2" aria-label="Talon — home">
        <Image src="/brand/talon-mark.png" alt="Talon logo" width={24} height={24} className="h-6 w-6 rounded-full object-cover ring-1 ring-edge" />
        <span className="text-base font-bold tracking-tight text-white">Talon</span>
      </Link>
      <ConnectButton showBalance={false} chainStatus="none" accountStatus="avatar" />
    </header>
  );
}

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-edge bg-card md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {MOBILE_NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
              isActive ? "text-accent" : "text-muted"
            }`}
          >
            <Icon size={20} strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
