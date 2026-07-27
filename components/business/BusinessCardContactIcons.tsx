"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CalendarCheck,
  Globe,
  Mail,
  Phone,
} from "lucide-react";
import {
  FacebookIcon,
  GoogleIcon,
  InstagramIcon,
  TelegramIcon,
  YelpIcon,
} from "@/components/brand/BrandIcons";
import {
  EMPTY_PRESENCE_FLAGS,
  hasAnyPresenceFlag,
  type BusinessPresenceFlags,
} from "@/lib/business/presence-flags";
import { cn } from "@/lib/utils";

type ContactChip = {
  key: string;
  title: string;
  icon: ReactNode;
  /** Compact metric next to the icon (rating or followers). */
  metric?: string;
  /** Prefer keeping these when the row is too narrow. */
  priority?: boolean;
  className?: string;
};

type BusinessCardContactIconsProps = {
  slug: string;
  flags?: BusinessPresenceFlags | null;
  googleRating?: number | null;
  googleReviewsCount?: number;
  yelpRating?: number | null;
  yelpReviewsCount?: number;
  instagramFollowersCount?: number | null;
  /** Hard cap — usually 5–6 so the row stays one line on the card plaque. */
  maxVisible?: number;
  className?: string;
};

const ICON_CHIP_PX = 28;
const METRIC_CHIP_PX = 52;
const GAP_PX = 6;

const chipClass =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50";

function formatRating(value: number): string {
  return value.toFixed(1);
}

/** Short follower count: 980, 1.2K, 15K, 1.1M */
export function formatFollowerCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "";
  if (count < 1000) return String(Math.round(count));
  if (count < 10_000) {
    const k = count / 1000;
    const rounded = Math.round(k * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}K`;
  }
  if (count < 1_000_000) return `${Math.round(count / 1000)}K`;
  const m = count / 1_000_000;
  const rounded = Math.round(m * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}M`;
}

function normalizeRating(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0 || value > 5) return null;
  return value;
}

/**
 * Compact contact icons for listing / preview cards.
 * Presence signals only — no links (the card itself opens the profile).
 * Google / Yelp / Instagram may show public metrics beside the icon.
 */
export function BusinessCardContactIcons({
  slug: _slug,
  flags = EMPTY_PRESENCE_FLAGS,
  googleRating = null,
  googleReviewsCount = 0,
  yelpRating = null,
  yelpReviewsCount = 0,
  instagramFollowersCount = null,
  maxVisible = 7,
  className,
}: BusinessCardContactIconsProps) {
  void _slug;
  const rowRef = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState(maxVisible);
  const resolved = flags ?? EMPTY_PRESENCE_FLAGS;

  const googleStars = normalizeRating(googleRating);
  const yelpStars = normalizeRating(yelpRating);
  const igFollowers =
    instagramFollowersCount != null &&
    Number.isFinite(instagramFollowersCount) &&
    instagramFollowersCount > 0
      ? Math.round(instagramFollowersCount)
      : null;

  const chips: ContactChip[] = [];

  // Metric channels first so ResizeObserver keeps them when space is tight.
  if (resolved.hasGoogleMaps) {
    chips.push({
      key: "google",
      title:
        googleStars != null
          ? `Google ${formatRating(googleStars)}${
              googleReviewsCount > 0
                ? ` · ${googleReviewsCount.toLocaleString("ru-RU")} отзывов`
                : ""
            }`
          : "Google Maps — на странице бизнеса",
      icon: <GoogleIcon className="size-3.5" />,
      metric: googleStars != null ? formatRating(googleStars) : undefined,
      priority: googleStars != null,
    });
  }
  if (resolved.hasInstagram) {
    const followersLabel =
      igFollowers != null ? formatFollowerCount(igFollowers) : undefined;
    chips.push({
      key: "instagram",
      title:
        igFollowers != null
          ? `Instagram · ${igFollowers.toLocaleString("ru-RU")} подписчиков`
          : "Instagram — на странице бизнеса",
      icon: <InstagramIcon className="size-3.5" />,
      metric: followersLabel,
      priority: followersLabel != null,
      className: "text-[#E4405F]",
    });
  }
  if (resolved.hasYelp) {
    chips.push({
      key: "yelp",
      title:
        yelpStars != null
          ? `Yelp ${formatRating(yelpStars)}${
              yelpReviewsCount > 0
                ? ` · ${yelpReviewsCount.toLocaleString("ru-RU")} отзывов`
                : ""
            }`
          : "Yelp — на странице бизнеса",
      icon: <YelpIcon className="size-3.5" />,
      metric: yelpStars != null ? formatRating(yelpStars) : undefined,
      priority: yelpStars != null,
    });
  }
  if (resolved.hasPhone) {
    chips.push({
      key: "phone",
      title: "Телефон — на странице бизнеса",
      icon: <Phone aria-hidden="true" className="size-3.5" />,
    });
  }
  if (resolved.hasWebsite) {
    chips.push({
      key: "website",
      title: "Сайт — на странице бизнеса",
      icon: <Globe aria-hidden="true" className="size-3.5" />,
    });
  }
  if (resolved.hasBooking) {
    chips.push({
      key: "booking",
      title: "Онлайн-запись — на странице бизнеса",
      icon: <CalendarCheck aria-hidden="true" className="size-3.5" />,
      priority: true,
      className: "border-brand-blue/30 bg-brand-blue/5 text-brand-blue",
    });
  }
  if (resolved.hasTelegram) {
    chips.push({
      key: "telegram",
      title: "Telegram — на странице бизнеса",
      icon: <TelegramIcon className="size-3.5" />,
    });
  }
  if (resolved.hasEmail) {
    chips.push({
      key: "email",
      title: "Email — на странице бизнеса",
      icon: <Mail aria-hidden="true" className="size-3.5" />,
    });
  }
  if (resolved.hasFacebook) {
    chips.push({
      key: "facebook",
      title: "Facebook — на странице бизнеса",
      icon: <FacebookIcon className="size-3.5" />,
    });
  }

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const chipWidth = (chip: ContactChip) =>
      chip.metric ? METRIC_CHIP_PX : ICON_CHIP_PX;

    const measure = () => {
      const width = el.clientWidth;
      if (width <= 0) {
        setFitCount(maxVisible);
        return;
      }

      // Keep priority (metric) chips; drop trailing non-priority first.
      const priority = chips.filter((c) => c.priority);
      const rest = chips.filter((c) => !c.priority);
      const ordered = [...priority, ...rest];

      let used = 0;
      let count = 0;
      for (const chip of ordered) {
        if (count >= maxVisible) break;
        const w = chipWidth(chip) + (count > 0 ? GAP_PX : 0);
        if (used + w > width) break;
        used += w;
        count += 1;
      }
      setFitCount(count);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxVisible, chips.length, googleStars, yelpStars, igFollowers]);

  if (!hasAnyPresenceFlag(resolved) || chips.length === 0) return null;

  // Same order as measure: priority metrics first, then the rest.
  const priority = chips.filter((c) => c.priority);
  const rest = chips.filter((c) => !c.priority);
  const ordered = [...priority, ...rest];
  const visible = ordered.slice(0, fitCount);

  return (
    <div
      ref={rowRef}
      aria-label="Доступные контакты"
      className={cn(
        "mt-2 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden",
        className,
      )}
    >
      {visible.map((chip) => (
        <span
          key={chip.key}
          aria-label={chip.title}
          className={cn(
            chipClass,
            "pointer-events-none",
            chip.metric ? "gap-1 px-1.5" : "size-7",
            chip.className,
          )}
          title={chip.title}
        >
          {chip.icon}
          {chip.metric ? (
            <span className="text-[11px] font-semibold tabular-nums text-slate-700">
              {chip.metric}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
