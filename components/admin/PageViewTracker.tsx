"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackPageViewAction } from "@/lib/admin/actions";

export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastKey = useRef<string>("");

  useEffect(() => {
    const qs = searchParams?.toString();
    const path = qs ? `${pathname}?${qs}` : pathname || "/";
    if (path.startsWith("/admin")) return;
    if (lastKey.current === path) return;
    lastKey.current = path;
    void trackPageViewAction({
      path,
      referrer: typeof document !== "undefined" ? document.referrer : null,
    });
  }, [pathname, searchParams]);

  return null;
}
