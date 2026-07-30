/**
 * Visual identity tokens for category listing cards.
 * Shared shell; differentiation via accent strip, fallback media, and chips.
 */

export type CardThemeKey =
  | "marketplace"
  | "jobs"
  | "real_estate"
  | "events"
  | "lechu"
  | "transfers";

export type CardTheme = {
  key: CardThemeKey;
  label: string;
  /** Top accent strip */
  accentBar: string;
  /** Chip background + text */
  chip: string;
  /** Media fallback gradient + icon ring + label colors */
  fallback: {
    gradient: string;
    iconWrap: string;
    icon: string;
    label: string;
  };
};

export const CARD_THEMES: Record<CardThemeKey, CardTheme> = {
  marketplace: {
    key: "marketplace",
    label: "Купи-продай",
    accentBar: "bg-brand-orange",
    chip: "bg-brand-orange/15 text-orange-900",
    fallback: {
      gradient: "bg-gradient-to-br from-orange-50 via-white to-brand-orange/10",
      iconWrap: "bg-orange-100/80 text-orange-800 ring-1 ring-orange-200/80",
      icon: "text-orange-800",
      label: "text-orange-800/70",
    },
  },
  jobs: {
    key: "jobs",
    label: "Вакансия",
    accentBar: "bg-amber-500",
    chip: "bg-amber-100 text-amber-900",
    fallback: {
      gradient: "bg-gradient-to-br from-amber-50 via-white to-brand-orange/10",
      iconWrap: "bg-amber-100/80 text-amber-800 ring-1 ring-amber-200/80",
      icon: "text-amber-800",
      label: "text-amber-800/70",
    },
  },
  real_estate: {
    key: "real_estate",
    label: "Недвижимость",
    accentBar: "bg-brand-blue",
    chip: "bg-brand-blue/15 text-blue-900",
    fallback: {
      gradient: "bg-gradient-to-br from-blue-50 via-white to-brand-blue/10",
      iconWrap: "bg-blue-100/80 text-blue-800 ring-1 ring-blue-200/80",
      icon: "text-blue-800",
      label: "text-blue-800/70",
    },
  },
  events: {
    key: "events",
    label: "Событие",
    accentBar: "bg-brand-green",
    chip: "bg-brand-green/15 text-emerald-900",
    fallback: {
      gradient: "bg-gradient-to-br from-emerald-50 via-white to-brand-green/10",
      iconWrap: "bg-emerald-100/80 text-emerald-800 ring-1 ring-emerald-200/80",
      icon: "text-emerald-800",
      label: "text-emerald-800/70",
    },
  },
  lechu: {
    key: "lechu",
    label: "Лечу",
    accentBar: "bg-teal-500",
    chip: "bg-teal-100 text-teal-900",
    fallback: {
      gradient: "bg-gradient-to-br from-teal-50 via-white to-cyan-100/60",
      iconWrap: "bg-teal-100/80 text-teal-800 ring-1 ring-teal-200/80",
      icon: "text-teal-800",
      label: "text-teal-800/70",
    },
  },
  transfers: {
    key: "transfers",
    label: "Переводы",
    accentBar: "bg-brand-blue",
    chip: "bg-brand-blue/15 text-blue-900",
    fallback: {
      gradient: "bg-gradient-to-br from-sky-50 via-white to-brand-blue/10",
      iconWrap: "bg-sky-100/80 text-sky-900 ring-1 ring-sky-200/80",
      icon: "text-sky-900",
      label: "text-sky-900/70",
    },
  },
};
