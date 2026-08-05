"use client";

import { NavigationProgress } from "@/components/layout/NavigationProgress";

/** @deprecated Prefer NavigationProgress — kept for AdminShell import path. */
export function AdminNavigationProgress() {
  return <NavigationProgress pathPrefix="/admin" />;
}
