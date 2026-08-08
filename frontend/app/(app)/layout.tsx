import type { ReactNode } from "react";
import AppFrame from "@/components/app/app-frame";
import ChainGuardBanner from "@/components/app/chain-guard-banner";
import MobileNav, { MobileTopBar } from "@/components/app/mobile-nav";
import Sidebar from "@/components/app/sidebar";
import { SidebarProvider } from "@/components/app/sidebar-context";

/**
 * Shared shell for the connected-wallet app: /register, /actions, /escrow,
 * /audit. Collapsible/resizable sidebar on desktop, top bar + bottom tab bar
 * on mobile — both driven by the single `NAV_ITEMS` source of truth.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-ink">
        <Sidebar />
        <AppFrame>
          <ChainGuardBanner />
          <MobileTopBar />
          <main className="flex-1 pb-20 md:pb-0">{children}</main>
        </AppFrame>
        <MobileNav />
      </div>
    </SidebarProvider>
  );
}
