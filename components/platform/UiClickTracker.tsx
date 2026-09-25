"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

const CARD_PATH = /^\/(business|marketplace|services|lechu|transfers)(\/|$)/;
let lastKey = "";
let lastAt = 0;

function labelOf(node: HTMLElement): { label: string; href: string | null } | null {
  const control = node.closest("a, button, [role='button']");
  if (!(control instanceof HTMLElement)) return null;
  if (control.closest("input, textarea, select, [contenteditable='true']")) {
    return null;
  }
  if (control instanceof HTMLAnchorElement) {
    const href = control.getAttribute("href") ?? "";
    if (href.startsWith("/") && CARD_PATH.test(href)) return null;
  }
  const aria = control.getAttribute("aria-label")?.trim() ?? "";
  const text = (control.innerText || "").replace(/\s+/g, " ").trim();
  const raw = (aria || text || control.getAttribute("title") || "").slice(0, 80);
  if (raw.length < 2 || /^\d+$/.test(raw)) return null;
  if (/контакт/i.test(raw)) return null;
  const href =
    control instanceof HTMLAnchorElement
      ? (control.getAttribute("href") || "").slice(0, 180) || null
      : null;
  return { label: raw, href };
}

export function UiClickTracker() {
  const pathname = usePathname() || "/";

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const found = labelOf(target as HTMLElement);
      if (!found) return;
      const path = `${window.location.pathname}${window.location.search}`.slice(0, 500);
      const key = `${path}|${found.label}|${found.href ?? ""}`;
      const now = Date.now();
      if (key === lastKey && now - lastAt < 1500) return;
      lastKey = key;
      lastAt = now;

      void (async () => {
        try {
          const supabase = createBrowserClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          await supabase.from("platform_events").insert({
            event_type: "click",
            path,
            referrer: document.referrer.slice(0, 500) || null,
            user_id: user?.id ?? null,
            meta: {
              surface: "ui",
              label: found.label,
              href: found.href,
            },
          });
        } catch {
          // Analytics must never break the page.
        }
      })();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  return null;
}
