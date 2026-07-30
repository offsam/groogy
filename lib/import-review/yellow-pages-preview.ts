import type { Business } from "@/types/business";
import type { Listing } from "@/types/listing";
import type { Professional } from "@/types/professional";
import { computePresenceFlags } from "@/lib/business/presence-flags";
import { normalizeCityLabel } from "@/lib/geo/city-aliases";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";

function first(values: string[] | null | undefined): string | null {
  const v = (values ?? []).map((s) => s.trim()).find(Boolean);
  return v || null;
}

function asHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("@")) return `https://www.instagram.com/${t.slice(1)}`;
  if (/instagram\.com/i.test(t)) return t.startsWith("http") ? t : `https://${t}`;
  return `https://${t}`;
}

function noteField(notes: string | null | undefined, key: string): string | null {
  if (!notes) return null;
  for (const part of notes.split(";")) {
    const p = part.trim();
    if (p.toLowerCase().startsWith(`${key.toLowerCase()}:`)) {
      return p.slice(key.length + 1).trim() || null;
    }
  }
  return null;
}

function emailsFromNotes(notes: string | null | undefined): string[] {
  const raw = noteField(notes, "emails");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function slugFromName(name: string, id: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "item";
  return `${base}-${id.slice(0, 8)}`;
}

/**
 * City for preview/completeness: DB city, else parse from address in notes
 * (to4ka often has «2116 Avenue P, Нью-Йорк, NY, USA» with city=null).
 */
export function resolveYellowPagesCity(
  item: Pick<CommentRecommendation, "city" | "notes">,
): string | null {
  const direct = item.city?.trim() || null;
  if (direct) return normalizeCityLabel(direct) || direct;

  const address = noteField(item.notes, "address");
  if (!address) return null;

  // «street, City, ST, USA» or «street, City, ST»
  const withState = address.match(
    /,\s*([^,]+?)\s*,\s*([A-Za-zА-Яа-яЁё]{2})\s*(?:,\s*(?:USA|United States))?\s*$/i,
  );
  if (withState?.[1]) {
    const city = normalizeCityLabel(withState[1]);
    if (city) return city;
  }

  // «City, USA» / «City, ST»
  const cityOnly = address.match(
    /^([^,]+?)\s*,\s*(?:USA|United States|[A-Z]{2})\s*$/i,
  );
  if (cityOnly?.[1] && !/\d/.test(cityOnly[1])) {
    const city = normalizeCityLabel(cityOnly[1]);
    if (city) return city;
  }

  return null;
}


export type YellowPagesPreviewKind = "professional" | "business" | "service";

export function yellowPagesEntityKind(
  item: CommentRecommendation,
): YellowPagesPreviewKind {
  if (item.target_bucket === "professional") return "professional";
  if (item.target_bucket === "business") return "business";
  if (item.target_bucket === "service") return "service";

  const fromNotes = noteField(item.notes, "entity")?.toLowerCase();
  if (fromNotes === "professional") return "professional";
  if (fromNotes === "business") return "business";
  if (fromNotes === "service") return "service";
  const cat = (item.category_guess || "").toLowerCase();
  if (
    /юрист|нотариус|риэлтор|массаж|обучен|бухгалтер|учитель|репетитор|перевод/.test(
      cat,
    )
  ) {
    return "professional";
  }
  return "business";
}

function contactBits(item: CommentRecommendation) {
  const phone = first(item.phones);
  const email = first(emailsFromNotes(item.notes));
  const websites = (item.websites || []).filter(
    (w) => !/instagram\.com|t\.me|telegram\.me/i.test(w),
  );
  const website = asHttpUrl(
    first(websites.filter((w) => !/facebook\.com|yelp\.com/i.test(w))),
  );
  const facebook = asHttpUrl(
    first(websites.filter((w) => /facebook\.com/i.test(w))),
  );
  const yelp = asHttpUrl(first(websites.filter((w) => /yelp\.com/i.test(w))));
  const igHandle = first(item.instagram);
  const instagramUrl = igHandle
    ? `https://www.instagram.com/${igHandle.replace(/^@/, "")}`
    : asHttpUrl(first((item.websites || []).filter((w) => /instagram\.com/i.test(w))));
  const sourceUrl = first(item.source_post_urls);
  const address = noteField(item.notes, "address");
  const region = noteField(item.notes, "region") || "USA";
  const short =
    first(item.request_snippets) ||
    first(item.comment_texts)?.slice(0, 220) ||
    null;
  const description = first(item.comment_texts) || short;
  return {
    phone,
    email,
    website,
    facebook,
    yelp,
    instagramUrl,
    sourceUrl,
    address,
    region,
    short,
    description,
  };
}

export function yellowPagesToBusinessPreview(
  item: CommentRecommendation,
): Business {
  const name = item.display_name?.trim() || "Без названия";
  const c = contactBits(item);
  const city = resolveYellowPagesCity(item);
  const presenceFlags = computePresenceFlags({
    phone: c.phone,
    email: c.email,
    website: c.website || c.facebook,
    instagram_url: c.instagramUrl,
    telegram_url: null,
    yelp_url: c.yelp,
    google_maps_url: null,
    source_url: c.sourceUrl,
  });

  return {
    id: item.id,
    slug: slugFromName(name, item.id),
    name,
    categoryId: null,
    categorySlug: null,
    categoryName: item.category_guess,
    shortDescription: c.short,
    description: c.description,
    ratingAvg: 0,
    reviewsCount: 0,
    aiVerifiedReviewsCount: 0,
    transactionVerifiedReviewsCount: 0,
    phone: c.phone,
    email: c.email,
    website: c.website,
    instagramUrl: c.instagramUrl,
    telegramUrl: null,
    sourceUrl: c.sourceUrl,
    sourceKind: "platform",
    facebookUrl: c.facebook,
    tiktokUrl: null,
    yelpUrl: c.yelp,
    yelpRating: null,
    yelpReviewsCount: 0,
    instagramFollowersCount: null,
    googleMapsUrl: null,
    googleRating: null,
    googleReviewsCount: 0,
    bookingUrl: null,
    contactLinks: [],
    imageUrl: item.cover_image_url,
    addressLine: c.address,
    city,
    region: c.region,
    stateCode: "US-CA",
    postalCode: null,
    latitude: null,
    longitude: null,
    locationPrecision: c.address ? "street" : "county",
    openingHours: null,
    createdAt: item.created_at,
    presenceFlags,
  };
}

export function yellowPagesToProfessionalPreview(
  item: CommentRecommendation,
): Professional {
  const name = item.display_name?.trim() || "Без названия";
  const c = contactBits(item);
  const city = resolveYellowPagesCity(item);
  return {
    id: item.id,
    slug: slugFromName(name, item.id),
    displayName: name,
    headline: item.category_guess,
    shortDescription: c.short,
    description: c.description,
    imageUrl: item.cover_image_url,
    status: "pending",
    experienceYears: null,
    languages: ["ru"],
    availabilityText: null,
    ratingAvg: 0,
    reviewsCount: 0,
    city,
    region: c.region,
    stateCode: "US-CA",
    postalCode: null,
    latitude: null,
    longitude: null,
    serviceAreaText: c.region,
    publishedAt: null,
    createdAt: item.created_at,
    categoryId: null,
    categorySlug: null,
    categoryName: item.category_guess,
    presenceFlags: {
      hasPhone: Boolean(c.phone),
      hasEmail: Boolean(c.email),
      hasWebsite: Boolean(c.website),
      hasInstagram: Boolean(c.instagramUrl),
      hasTelegram: false,
      hasSource: Boolean(c.sourceUrl),
    },
    phone: c.phone,
    email: c.email,
    website: c.website,
    instagramUrl: c.instagramUrl,
    telegramUrl: null,
    contactLinks: [],
    sourceUrl: c.sourceUrl,
    sourceKind: "platform",
    thirdPartyMentionCount: item.third_party_mention_count,
    selfAdMentionCount: item.self_ad_mention_count,
  };
}

/** Service / listing card preview for recommendation queue. */
export function yellowPagesToServicePreview(
  item: CommentRecommendation,
): Listing {
  const name = item.display_name?.trim() || "Без названия";
  const c = contactBits(item);
  const city = resolveYellowPagesCity(item);
  const categoryLabel = item.category_guess?.trim() || null;
  const category = categoryLabel
    ? {
        id: "preview-cat",
        slug: slugFromName(categoryLabel, item.id),
        nameRu: categoryLabel,
        nameEn: null,
        sortOrder: 0,
      }
    : null;

  return {
    id: `preview-${item.id}`,
    ownerId: "preview",
    listingType: "service",
    status: "active",
    visibility: "public",
    authorVisibility: "public",
    title: name,
    description: c.description || "",
    priceAmount: null,
    priceCurrency: "USD",
    isNegotiable: true,
    city,
    state: null,
    stateCode: "US-CA",
    cityGeoid: null,
    latitude: null,
    longitude: null,
    contactPreference: c.phone ? "phone" : "any",
    publisherType: "profile",
    publisherBusinessId: null,
    sourceUrl: c.sourceUrl,
    sourceKind: "platform",
    hasSource: Boolean(c.sourceUrl),
    publishedAt: item.created_at,
    reservedAt: null,
    completedAt: null,
    pausedAt: null,
    archivedAt: null,
    expiresAt: null,
    moderationReason: null,
    favoritesCount: 0,
    createdAt: item.created_at,
    updatedAt: item.created_at,
    media: item.cover_image_url
      ? [
          {
            id: `preview-media-${item.id}`,
            listingId: item.id,
            storagePath: item.cover_image_url,
            sortOrder: 0,
            publicUrl: item.cover_image_url,
          },
        ]
      : [],
    author: {
      mode: "public",
      label: name,
      avatarUrl: null,
      username: first(item.instagram),
      profilePath: null,
    },
    publisher: {
      publisherType: "profile",
      businessId: null,
      slug: null,
      name,
      logoUrl: null,
    },
    favoritedByMe: false,
    service: {
      serviceCategoryId: null,
      pricingType: "contact_for_price",
      priceFrom: null,
      priceTo: null,
      priceUnit: null,
      serviceModes: ["in_person"],
      serviceArea: [city, c.region].filter(Boolean).join(", ") || null,
      experienceYears: null,
      languages: ["ru"],
      licenseInfo: null,
      insuranceStatus: null,
      availabilityText: null,
      offersFreeEstimate: false,
      offersEmergencyService: false,
      category,
    },
  };
}

