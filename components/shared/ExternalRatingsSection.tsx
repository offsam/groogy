import { Star } from "lucide-react";
import {
  GoogleIcon,
  TrustpilotIcon,
  YelpIcon,
} from "@/components/brand/BrandIcons";
import { cn } from "@/lib/utils";

export type ExternalRatingItem = {
  id: string;
  label: string;
  rating: number | null;
  reviewsCount?: number | null;
  href?: string | null;
};

function iconFor(id: string) {
  if (id === "google") return <GoogleIcon className="size-3.5" />;
  if (id === "yelp") return <YelpIcon className="size-3.5" />;
  if (id === "trustpilot") return <TrustpilotIcon className="size-3.5" />;
  return <Star aria-hidden className="size-3.5 fill-amber-500 text-amber-500" />;
}

/**
 * Compact row under platform reviews in the profile header:
 * Google ★4.7 · Yelp ★4.2 · Trustpilot ★3.7 — same block, not a separate section.
 */
export function ExternalRatingChips({
  items,
  className,
}: {
  items: ExternalRatingItem[];
  className?: string;
}) {
  const visible = items.filter(
    (item) =>
      item.rating != null &&
      Number.isFinite(item.rating) &&
      item.rating > 0,
  );
  if (visible.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700",
        className,
      )}
    >
      {visible.map((item) => {
        const content = (
          <span className="inline-flex items-center gap-1">
            {iconFor(item.id)}
            <Star
              aria-hidden
              className="size-3 fill-amber-500 text-amber-500"
            />
            <span className="font-semibold tabular-nums text-slate-900">
              {item.rating!.toFixed(1)}
            </span>
            <span className="sr-only">{item.label}</span>
          </span>
        );

        if (item.href) {
          return (
            <a
              key={item.id}
              className="inline-flex items-center rounded-md transition-colors hover:bg-slate-100"
              href={item.href}
              rel="noopener noreferrer"
              target="_blank"
              title={item.label}
            >
              {content}
            </a>
          );
        }

        return (
          <span key={item.id} title={item.label}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

export function businessExternalRatingItems(input: {
  googleRating?: number | null;
  googleReviewsCount?: number | null;
  googleMapsUrl?: string | null;
  yelpRating?: number | null;
  yelpReviewsCount?: number | null;
  yelpUrl?: string | null;
  trustpilotRating?: number | null;
  trustpilotReviewsCount?: number | null;
  trustpilotUrl?: string | null;
}): ExternalRatingItem[] {
  return [
    {
      id: "google",
      label: "Google",
      rating: input.googleRating ?? null,
      reviewsCount: input.googleReviewsCount ?? null,
      href: input.googleMapsUrl?.trim() || null,
    },
    {
      id: "yelp",
      label: "Yelp",
      rating: input.yelpRating ?? null,
      reviewsCount: input.yelpReviewsCount ?? null,
      href: input.yelpUrl?.trim() || null,
    },
    {
      id: "trustpilot",
      label: "Trustpilot",
      rating: input.trustpilotRating ?? null,
      reviewsCount: input.trustpilotReviewsCount ?? null,
      href: input.trustpilotUrl?.trim() || null,
    },
  ];
}
