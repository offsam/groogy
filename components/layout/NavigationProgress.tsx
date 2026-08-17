"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";
import {
  AI_SEARCH_START_EVENT,
  signalAiSearch,
} from "@/components/search/AiSearchLoader";

const APP_NAV_START_EVENT = "krugi:app-nav-start";

/** Survives Suspense remounts of this component during soft navigations. */
let navBusy = false;
let navStartedAt = 0;
const MIN_VISIBLE_MS = 450;
const SETTLE_AFTER_URL_MS = 700;
const MAX_VISIBLE_MS = 14_000;

/**
 * Call before `router.push` / `router.replace` so the mute overlay shows
 * (Link clicks are covered automatically).
 */
export function signalAppNavigation(): void {
  if (typeof window === "undefined") return;
  navBusy = true;
  navStartedAt = Date.now();
  window.dispatchEvent(new CustomEvent(APP_NAV_START_EVENT));
}

function markBusy() {
  navBusy = true;
  navStartedAt = Date.now();
}

function clearBusy() {
  navBusy = false;
}

type Props = {
  pathPrefix?: string;
};

/**
 * Soft-nav feedback: pin in the center until the new route has actually
 * painted — not only until the URL flips (URL often flips seconds earlier).
 */
export function NavigationProgress({ pathPrefix }: Props) {
  const pathname = usePathname();
  // Avoid useSearchParams() — it suspends and remounts this component mid-nav.
  const [active, setActive] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPath = useRef(pathname);

  function clearTimers() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }

  function begin() {
    markBusy();
    setActive(true);
    clearTimers();
    hideTimer.current = setTimeout(() => {
      clearBusy();
      setActive(false);
    }, MAX_VISIBLE_MS);
  }

  function endAfterSettle() {
    const elapsed = Date.now() - navStartedAt;
    const waitMore = Math.max(0, MIN_VISIBLE_MS - elapsed) + SETTLE_AFTER_URL_MS;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      clearBusy();
      setActive(false);
      clearTimers();
    }, waitMore);
  }

  // Restore after Suspense remount while a nav is still in flight.
  useEffect(() => {
    if (navBusy) setActive(true);
  }, []);

  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    if (!navBusy && !active) return;
    // URL changed — keep pin up until RSC/content catches up.
    endAfterSettle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only path flips
  }, [pathname]);

  useEffect(() => {
    function onProgrammatic() {
      begin();
    }
    function onAiSearch() {
      clearBusy();
      clearTimers();
      setActive(false);
    }
    window.addEventListener(APP_NAV_START_EVENT, onProgrammatic);
    window.addEventListener(AI_SEARCH_START_EVENT, onAiSearch);
    return () => {
      window.removeEventListener(APP_NAV_START_EVENT, onProgrammatic);
      window.removeEventListener(AI_SEARCH_START_EVENT, onAiSearch);
    };
  }, []);

  useEffect(() => {
    function isAppNavAnchor(node: EventTarget | null): HTMLAnchorElement | null {
      if (!(node instanceof Element)) return null;
      const a = node.closest("a");
      if (!a) return null;
      if (a.target === "_blank" || a.hasAttribute("download")) return null;
      const raw = a.getAttribute("href");
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
        return null;
      }
      try {
        const url = new URL(a.href, window.location.href);
        if (url.origin !== window.location.origin) return null;
        if (pathPrefix && !url.pathname.startsWith(pathPrefix)) return null;
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
          return null;
        }
        return a;
      } catch {
        return null;
      }
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = isAppNavAnchor(e.target);
      if (!a) return;
      try {
        const url = new URL(a.href, window.location.href);
        const q = url.searchParams.get("q")?.trim() ?? "";
        if (url.pathname === "/search" && q) {
          signalAiSearch(q);
          return;
        }
      } catch {
        // fall through to generic nav pin
      }
      begin();
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimers();
    };
  }, [pathPrefix]);

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] bg-transparent"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {/* Invisible click shield — no dim plate */}
      <div className="absolute inset-0 bg-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
        <div className="nav-progress-bar h-full w-1/3 bg-brand-blue/80" />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <BrandPinLoader size="page" />
      </div>
    </div>
  );
}
