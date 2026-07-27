import {
  hasGoogleMapsPresence,
  hasProvenanceSource,
  isFacebookUrl,
  isInstagramUrl,
  isYelpUrl,
  resolveWebsiteUrl,
  type BusinessPresence,
} from "@/lib/business/presence";

/** Boolean presence signals safe to expose on listing cards (no URLs / phones). */
export type BusinessPresenceFlags = {
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  hasInstagram: boolean;
  hasTelegram: boolean;
  hasYelp: boolean;
  hasFacebook: boolean;
  hasGoogleMaps: boolean;
  hasSource: boolean;
  hasBooking: boolean;
};

export const EMPTY_PRESENCE_FLAGS: BusinessPresenceFlags = {
  hasPhone: false,
  hasEmail: false,
  hasWebsite: false,
  hasInstagram: false,
  hasTelegram: false,
  hasYelp: false,
  hasFacebook: false,
  hasGoogleMaps: false,
  hasSource: false,
  hasBooking: false,
};

type ContactSource = {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  instagram_url?: string | null;
  instagramUrl?: string | null;
  telegram_url?: string | null;
  telegramUrl?: string | null;
  source_url?: string | null;
  sourceUrl?: string | null;
  source_kind?: string | null;
  sourceKind?: string | null;
  yelp_url?: string | null;
  yelpUrl?: string | null;
  google_maps_url?: string | null;
  googleMapsUrl?: string | null;
  booking_url?: string | null;
  bookingUrl?: string | null;
  has_booking?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
};

function trimmed(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function computePresenceFlags(source: ContactSource): BusinessPresenceFlags {
  const phone = trimmed(source.phone);
  const email = trimmed(source.email);
  const website = trimmed(source.website);
  const instagram = trimmed(source.instagram_url ?? source.instagramUrl);
  const telegram = trimmed(source.telegram_url ?? source.telegramUrl);
  const sourceUrl = trimmed(source.source_url ?? source.sourceUrl);
  const sourceKind = trimmed(source.source_kind ?? source.sourceKind);
  const yelp = trimmed(source.yelp_url ?? source.yelpUrl);
  const googleMaps = trimmed(source.google_maps_url ?? source.googleMapsUrl);
  const booking = trimmed(source.booking_url ?? source.bookingUrl);

  const presence: BusinessPresence = {
    website,
    instagramUrl: instagram,
    telegramUrl: telegram,
    sourceUrl,
    sourceKind: sourceKind as BusinessPresence["sourceKind"],
    yelpUrl: yelp,
    googleMapsUrl: googleMaps,
    latitude: source.latitude,
    longitude: source.longitude,
  };

  const websiteResolved = resolveWebsiteUrl(presence);
  const websiteIsIg = website ? isInstagramUrl(website) : false;
  const websiteIsFb = website ? isFacebookUrl(website) : false;
  const websiteIsYelp = website ? isYelpUrl(website) : false;
  const hasSource = hasProvenanceSource({
    sourceUrl,
    sourceKind: sourceKind as BusinessPresence["sourceKind"],
  });

  return {
    hasPhone: Boolean(phone),
    hasEmail: Boolean(email),
    hasWebsite: Boolean(websiteResolved),
    hasInstagram: Boolean(instagram) || websiteIsIg,
    hasTelegram: Boolean(telegram),
    hasYelp: Boolean(yelp) || websiteIsYelp,
    hasFacebook: websiteIsFb,
    hasGoogleMaps: hasGoogleMapsPresence(presence),
    hasSource,
    hasBooking: Boolean(booking) || Boolean(source.has_booking),
  };
}

export function hasAnyPresenceFlag(flags: BusinessPresenceFlags): boolean {
  return (
    flags.hasPhone ||
    flags.hasEmail ||
    flags.hasWebsite ||
    flags.hasInstagram ||
    flags.hasTelegram ||
    flags.hasYelp ||
    flags.hasFacebook ||
    flags.hasGoogleMaps ||
    flags.hasSource ||
    flags.hasBooking
  );
}
