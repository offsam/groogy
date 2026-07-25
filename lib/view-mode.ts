export const VIEW_MODE_STORAGE_KEY = "rba-view-mode";

export type ViewMode = "auto" | "mobile" | "desktop";

export const VIEW_MODES: ViewMode[] = ["auto", "mobile", "desktop"];

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  auto: "Авто",
  mobile: "Телефон",
  desktop: "Компьютер",
};

export function isViewMode(value: string | null | undefined): value is ViewMode {
  return value === "auto" || value === "mobile" || value === "desktop";
}

export function readStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return isViewMode(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function writeStoredViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}

/** Classic mobile↔desktop site switch via the viewport meta tag. */
export function applyViewportForMode(mode: ViewMode): void {
  if (typeof document === "undefined") return;

  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    document.head.appendChild(meta);
  }

  if (mode === "desktop") {
    meta.setAttribute("content", "width=1280");
  } else {
    meta.setAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
  }
}

export function applyViewMode(mode: ViewMode): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (mode === "auto") {
    root.removeAttribute("data-view-mode");
  } else {
    root.setAttribute("data-view-mode", mode);
  }
  applyViewportForMode(mode);
}
