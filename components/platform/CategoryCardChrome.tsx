import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  CARD_THEMES,
  type CardThemeKey,
} from "@/lib/platform/card-themes";

export function CategoryAccentBar({
  theme,
  muted = false,
}: {
  theme: CardThemeKey;
  /** Past / inactive — soften the strip */
  muted?: boolean;
}) {
  const t = CARD_THEMES[theme];
  return (
    <div
      aria-hidden
      className={`h-[3px] w-full ${muted ? "bg-slate-300" : t.accentBar}`}
    />
  );
}

export function CategoryChip({
  theme,
  label,
  muted = false,
}: {
  theme: CardThemeKey;
  label?: string;
  muted?: boolean;
}) {
  const t = CARD_THEMES[theme];
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        muted ? "bg-slate-100 text-slate-600" : t.chip
      }`}
    >
      {label ?? t.label}
    </span>
  );
}

export function CategoryMediaFallback({
  theme,
  icon: Icon,
  label,
  children,
  className = "",
}: {
  theme: CardThemeKey;
  icon: LucideIcon;
  label?: string;
  /** Optional secondary content under the icon (e.g. route) */
  children?: ReactNode;
  className?: string;
}) {
  const t = CARD_THEMES[theme];
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-2 px-3 ${t.fallback.gradient} ${className}`}
    >
      <span
        className={`flex size-12 items-center justify-center rounded-2xl ${t.fallback.iconWrap}`}
      >
        <Icon aria-hidden className={`size-6 ${t.fallback.icon}`} />
      </span>
      <span
        className={`text-[10px] font-medium uppercase tracking-wide ${t.fallback.label}`}
      >
        {label ?? t.label}
      </span>
      {children}
    </div>
  );
}
