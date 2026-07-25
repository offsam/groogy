import { cn } from "@/lib/utils";
import {
  hasGoogleMapsPresence,
  normalizeGoogleRating,
  resolveInstagramUrl,
  type BusinessPresence,
} from "@/lib/business/presence";
import { GoogleIcon, InstagramIcon } from "@/components/brand/BrandIcons";

type BusinessPresenceBadgesProps = {
  presence: BusinessPresence;
  className?: string;
};

export function BusinessPresenceBadges({
  presence,
  className,
}: BusinessPresenceBadgesProps) {
  const instagram = resolveInstagramUrl(presence);
  const onGoogle = hasGoogleMapsPresence(presence);
  const rating = normalizeGoogleRating(presence.googleRating);

  if (!instagram && !onGoogle) return null;

  return (
    <div
      className={cn(
        "mt-1.5 flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {onGoogle ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700",
            rating != null && "pr-2",
          )}
          title={
            rating != null
              ? `Google ${rating.toFixed(1)}`
              : "Есть на Google Maps"
          }
        >
          <GoogleIcon className="size-3.5 shrink-0" />
          {rating != null ? (
            <span className="tabular-nums">{rating.toFixed(1)}</span>
          ) : null}
        </span>
      ) : null}

      {instagram ? (
        <span
          className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 bg-white text-[#E4405F]"
          title="Instagram"
        >
          <InstagramIcon className="size-3.5" />
        </span>
      ) : null}
    </div>
  );
}
