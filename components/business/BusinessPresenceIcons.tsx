import { Globe, Navigation } from "lucide-react";
import {
  FacebookIcon,
  GoogleIcon,
  InstagramIcon,
} from "@/components/brand/BrandIcons";
import { cn } from "@/lib/utils";
import {
  hasGoogleMapsPresence,
  resolveFacebookUrl,
  resolveGoogleMapsUrl,
  resolveInstagramUrl,
  resolveWebsiteUrl,
  type BusinessPresence,
} from "@/lib/business/presence";

type BusinessPresenceIconsProps = {
  presence: BusinessPresence;
  businessName?: string;
  /** Directions / route URL (same destination as Google Maps when possible). */
  routeUrl?: string | null;
  className?: string;
};

const chipClass =
  "inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50";

/**
 * Icon-only presence row: site / social / Google / route.
 * Phone & email stay in the contacts sidebar — no text duplicates here.
 */
export function BusinessPresenceIcons({
  presence,
  businessName,
  routeUrl = null,
  className,
}: BusinessPresenceIconsProps) {
  const website = resolveWebsiteUrl(presence);
  const instagram = resolveInstagramUrl(presence);
  const facebook = resolveFacebookUrl(presence);
  const googleHref = hasGoogleMapsPresence(presence)
    ? resolveGoogleMapsUrl(presence, businessName)
    : null;

  const coordsRoute =
    typeof presence.latitude === "number" &&
    Number.isFinite(presence.latitude) &&
    typeof presence.longitude === "number" &&
    Number.isFinite(presence.longitude)
      ? `https://www.google.com/maps/dir/?api=1&destination=${presence.latitude},${presence.longitude}`
      : null;
  const routeHref =
    routeUrl?.trim() ||
    coordsRoute ||
    (businessName?.trim()
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(businessName.trim())}`
      : null);
  // Avoid two identical chips when Google fallback is already a directions URL.
  const showRoute = Boolean(routeHref && routeHref !== googleHref);

  if (!website && !instagram && !facebook && !googleHref && !showRoute) {
    return null;
  }

  return (
    <div
      aria-label="Ссылки и маршрут"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {website ? (
        <a
          aria-label="Сайт"
          className={chipClass}
          href={website}
          rel="noopener noreferrer"
          target="_blank"
          title="Сайт"
        >
          <Globe aria-hidden="true" className="size-4" />
        </a>
      ) : null}

      {instagram ? (
        <a
          aria-label="Instagram"
          className={cn(chipClass, "text-[#E4405F]")}
          href={instagram}
          rel="noopener noreferrer"
          target="_blank"
          title="Instagram"
        >
          <InstagramIcon className="size-4" />
        </a>
      ) : null}

      {facebook ? (
        <a
          aria-label="Facebook"
          className={chipClass}
          href={facebook}
          rel="noopener noreferrer"
          target="_blank"
          title="Facebook"
        >
          <FacebookIcon className="size-4" />
        </a>
      ) : null}

      {googleHref ? (
        <a
          aria-label="Google Maps"
          className={chipClass}
          href={googleHref}
          rel="noopener noreferrer"
          target="_blank"
          title="Google Maps"
        >
          <GoogleIcon className="size-4" />
        </a>
      ) : null}

      {showRoute && routeHref ? (
        <a
          aria-label="Маршрут"
          className={chipClass}
          href={routeHref}
          rel="noopener noreferrer"
          target="_blank"
          title="Маршрут"
        >
          <Navigation aria-hidden="true" className="size-4" />
        </a>
      ) : null}
    </div>
  );
}
