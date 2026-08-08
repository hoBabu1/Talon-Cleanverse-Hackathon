"use client";

import type { ReactNode } from "react";
import { useSidebar } from "./sidebar-context";

/**
 * The content column beside the desktop sidebar. Reserves exactly the pinned
 * rail's width on md+ (a hover-peek floats over the page and does NOT reflow
 * it). On mobile the sidebar is hidden, so no offset applies.
 */
export default function AppFrame({ children }: { children: ReactNode }) {
  const { contentOffset } = useSidebar();
  return (
    <div
      className="flex min-h-screen flex-col transition-[padding] duration-200 ease-out md:pl-[var(--rail)]"
      style={{ ["--rail" as string]: `${contentOffset}px` }}
    >
      {children}
    </div>
  );
}
