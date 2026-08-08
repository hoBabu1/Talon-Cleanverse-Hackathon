"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Shared sidebar state so the fixed <Sidebar/> and the content area's left
 * offset never disagree. Collapsed state and width persist across reloads.
 *
 * Two independent axes, deliberately not conflated:
 *   - `pinned`  : is the rail expanded and locked open (the VS Code default)?
 *   - `hovering`: is the pointer over a collapsed rail (Brave-style peek)?
 * A collapsed rail expands visually while hovered, but the CONTENT offset only
 * follows the pinned width — a hover-peek floats over the page, it doesn't
 * reflow it, so the layout doesn't jump every time the mouse grazes the edge.
 */

const COLLAPSED_WIDTH = 68;
const MIN_WIDTH = 200;
const MAX_WIDTH = 380;
const DEFAULT_WIDTH = 256;

const STORE_KEY = "talon.sidebar.v1";

/** Persisted axes live in one object so hydration is a single state write. */
type Settings = { pinned: boolean; width: number };

type SidebarState = {
  pinned: boolean;
  hovering: boolean;
  width: number;
  railWidth: number;
  contentOffset: number;
  expanded: boolean;
  collapsedWidth: number;
  minWidth: number;
  maxWidth: number;
  togglePinned: () => void;
  setHovering: (v: boolean) => void;
  setWidth: (w: number) => void;
};

const Ctx = createContext<SidebarState | null>(null);

export function useSidebar() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSidebar must be used within <SidebarProvider>");
  return ctx;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Defaults must match the server-rendered markup; real preferences are read
  // from localStorage after mount to avoid a hydration mismatch.
  const [settings, setSettings] = useState<Settings>({ pinned: true, width: DEFAULT_WIDTH });
  const [hovering, setHovering] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    let next: Settings | null = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Settings>;
        next = {
          pinned: typeof p.pinned === "boolean" ? p.pinned : true,
          width: typeof p.width === "number" ? clamp(p.width, MIN_WIDTH, MAX_WIDTH) : DEFAULT_WIDTH,
        };
      }
    } catch {
      // ignore corrupt storage
    }
    loaded.current = true;
    // Single hydration write: syncing React state to an external store (localStorage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next) setSettings(next);
  }, []);

  const persist = useCallback((next: Settings) => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // storage full / unavailable — non-fatal
    }
  }, []);

  const togglePinned = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, pinned: !prev.pinned };
      persist(next);
      return next;
    });
  }, [persist]);

  const setWidth = useCallback(
    (w: number) => {
      setSettings((prev) => {
        const next = { ...prev, width: clamp(w, MIN_WIDTH, MAX_WIDTH) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const value = useMemo<SidebarState>(() => {
    const { pinned, width } = settings;
    const expanded = pinned || hovering;
    return {
      pinned,
      hovering,
      width,
      railWidth: expanded ? width : COLLAPSED_WIDTH,
      contentOffset: pinned ? width : COLLAPSED_WIDTH,
      expanded,
      collapsedWidth: COLLAPSED_WIDTH,
      minWidth: MIN_WIDTH,
      maxWidth: MAX_WIDTH,
      togglePinned,
      setHovering,
      setWidth,
    };
  }, [settings, hovering, togglePinned, setWidth]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
