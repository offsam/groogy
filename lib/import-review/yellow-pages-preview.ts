import type { Business } from "@/types/business";
import type { Listing } from "@/types/listing";
import type { Professional } from "@/types/professional";
import type { ImportReviewItem } from "@/types/import-review";
import { computePresenceFlags } from "@/lib/business/presence-flags";
import { normalizeCityLabel } from "@/lib/geo/city-aliases";
import {
  inferNameFromDescription,
  isJunkImportTitle,
} from "@/lib/import-review/display-name";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { ImportReviewPreviewFields } from "@/lib/import-review/to-business-preview";

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
    /юрист|адвокат|нотариус|риэлтор|массаж|обучен|бухгалтер|учитель|репетитор|перевод|врач|стоматолог|психолог|коуч|тренер/.test(
      cat,
    )
  ) {
    return "professional";
  }
  // yellow_pages / unclassified / other — still always return a preview kind.
  // Prefer business for directory dumps; never leave the workspace without a card.
  return "business";
}

function contactBits(item: CommentRecommendation) {
  const phone = first(item.phones);
  const email = first(emailsFromNotes(item.notes));
  const allSites = item.websites || [];
  const website = asHttpUrl(
    first(
      allSites.filter(
        (w) =>
          !/instagram\.com|t\.me|telegram\.me|facebook\.com|fb\.com|youtube\.com|youtu\.be|tiktok\.com|yelp\.com|trustpilot\.com/i.test(
            w,
          ),
      ),
    ),
  );
  const facebook = asHttpUrl(
    first(allSites.filter((w) => /facebook\.com|fb\.com/i.test(w))),
  );
  const yelp = asHttpUrl(first(allSites.filter((w) => /yelp\.com/i.test(w))));
  const youtube = asHttpUrl(
    first(allSites.filter((w) => /youtube\.com|youtu\.be/i.test(w))),
  );
  const telegram = asHttpUrl(
    noteField(item.notes, "telegram") ||
      first(allSites.filter((w) => /t\.me|telegram\.me/i.test(w))),
  );
  const trustpilot = asHttpUrl(
    first(allSites.filter((w) => /trustpilot\.com/i.test(w))),
  );
  const igHandle = first(item.instagram);
  const instagramUrl = igHandle
    ? `https://www.instagram.com/${igHandle.replace(/^@/, "")}`
    : asHttpUrl(first(allSites.filter((w) => /instagram\.com/i.test(w))));
  const sourceUrl = first(item.source_post_urls);
  const address =
    item.address_line?.trim() || noteField(item.notes, "address");
  const region = noteField(item.notes, "region") || "USA";
  const short =
    first(item.request_snippets) ||
    first(item.comment_texts)?.slice(0, 220) ||
    null;
  // Prefer the longer narrative: snippets are usually the full ad.
  const description =
    [first(item.request_snippets), first(item.comment_texts)]
      .filter(Boolean)
      .sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0] || short;
  const services = (noteField(item.notes, "services") || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  let openingHours: Business["openingHours"] = null;
  const hoursRaw = noteField(item.notes, "hours");
  if (hoursRaw) {
    try {
      openingHours = JSON.parse(hoursRaw) as Business["openingHours"];
    } catch {
      openingHours = null;
    }
  }
  return {
    phone,
    email,
    website,
    facebook,
    yelp,
    youtube,
    telegram,
    trustpilot,
    instagramUrl,
    sourceUrl,
    address,
    region,
    short,
    description,
    services,
    openingHours,
  };
}

/**
 * «Запись» / empty titles are junk left by extractors. Prefer a real name from
 * the ad text so preview doesn't look blank.
 */
export function recommendationDisplayName(
  item: CommentRecommendation,
): string {
  const raw = item.display_name?.trim() || "";
  if (raw && !isJunkImportTitle(raw)) return raw;
  const blob = [
    ...(item.request_snippets || []),
    ...(item.comment_texts || []),
  ].join("\n");
  const inferred = inferNameFromDescription(blob);
  if (inferred && !isJunkImportTitle(inferred)) return inferred;
  return raw || "Без названия";
}

function bucketToImportTypes(item: CommentRecommendation): {
  entity_type: string;
  target_collection: string;
} {
  if (item.kind === "event") {
    return { entity_type: "event", target_collection: "events" };
  }
  const kind = yellowPagesEntityKind(item);
  if (kind === "professional") {
    return {
      entity_type: "private_specialist",
      target_collection: "private_specialists",
    };
  }
  if (kind === "service") {
    return {
      entity_type: "private_specialist",
      target_collection: "services",
    };
  }
  return { entity_type: "business", target_collection: "businesses" };
}

/**
 * Map a recommendation queue row → the same preview fields import_review uses,
 * so admin cards render via ImportReviewTypedCard (one standard).
 */
export function recommendationToImportPreviewFields(
  item: CommentRecommendation,
): ImportReviewPreviewFields {
  const name = recommendationDisplayName(item);
  const kind = yellowPagesEntityKind(item);
  const types = bucketToImportTypes(item);
  const cityRaw = resolveYellowPagesCity(item);
  // «Sacramento, CA» → city only when possible
  const cityMatch = cityRaw?.match(
    /^(.+?)\s*,\s*(CA|California|NY|FL|TX|AZ|OR|WA|NV|IL|NJ)\s*$/i,
  );
  const city = cityMatch?.[1]?.trim() || cityRaw;
  const state =
    cityMatch?.[2]?.toUpperCase() === "CALIFORNIA"
      ? "CA"
      : cityMatch?.[2]?.toUpperCase() ||
        item.state_code?.replace(/^US-/i, "") ||
        null;
  const description =
    [first(item.request_snippets), first(item.comment_texts)]
      .filter(Boolean)
      .sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0] || null;
  const emails = emailsFromNotes(item.notes);
  const notesEmail = noteField(item.notes, "email")?.toLowerCase();
  if (notesEmail && !emails.includes(notesEmail)) {
    emails.unshift(notesEmail);
  }

  return {
    id: item.id,
    title: name,
    business_name: kind === "business" ? name : null,
    person_name: kind === "professional" ? name : null,
    description,
    description_original: item.description_original ?? null,
    category: item.category_guess || item.category || null,
    city,
    state,
    address_line:
      item.address_line?.trim() || noteField(item.notes, "address"),
    postal_code:
      noteField(item.notes, "zip") ||
      noteField(item.notes, "postal") ||
      noteField(item.notes, "postal_code"),
    phone: item.phones || [],
    email: emails,
    website: item.websites || [],
    instagram: (item.instagram || []).map((h) => h.replace(/^@/, "")),
    services: (() => {
      const raw = noteField(item.notes, "services");
      if (!raw) return [];
      return raw
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
    })(),
    price: null,
    currency: null,
    photos_count: item.cover_image_url ? 1 : 0,
    preview_image_url: item.cover_image_url,
    entity_type: types.entity_type,
    target_collection: types.target_collection,
    whatsapp: [],
    telegram_username: (() => {
      const tg =
        noteField(item.notes, "telegram") ||
        first(
          (item.websites || []).filter((w) => /t\.me|telegram\.me/i.test(w)),
        );
      if (!tg) return null;
      const handle = tg
        .replace(/^https?:\/\//i, "")
        .replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
        .split("/")[0];
      return handle?.replace(/^@/, "") || null;
    })(),
    telegram_user_id: null,
    source_author_username: first(item.recommender_names),
    source_text: first(item.comment_texts),
    source_url: first(item.source_post_urls),
    source: item.source_channel || "telegram",
    source_group: first(item.source_groups),
    payment_methods: item.payment_methods ?? null,
    latitude:
      typeof item.latitude === "number" && Number.isFinite(item.latitude)
        ? item.latitude
        : null,
    longitude:
      typeof item.longitude === "number" && Number.isFinite(item.longitude)
        ? item.longitude
        : null,
  };
}

/**
 * Synthetic import_review row so ReviewFullPagePreviewModal can render the
 * same full-page chrome (hub tabs + profile). Not persisted.
 */
export function recommendationToSyntheticImportItem(
  item: CommentRecommendation,
): ImportReviewItem {
  const fields = recommendationToImportPreviewFields(item);
  const status =
    item.status === "approved" || item.status === "merged"
      ? "approved"
      : item.status === "rejected"
        ? "rejected"
        : item.status === "suspected_duplicate"
          ? "needs_more_info"
          : "pending";

  return {
    id: item.id,
    source: fields.source || "telegram",
    source_group: fields.source_group ?? null,
    source_chat_id: null,
    source_message_ids: [],
    source_fingerprint: `recommendation:${item.id}`,
    source_author_id: null,
    source_author_username: fields.source_author_username ?? null,
    source_author_display_name: first(item.recommender_names),
    source_posted_at: item.last_posted_at,
    source_text: fields.source_text ?? null,
    source_url: fields.source_url ?? null,
    source_media: [],
    ai_decision: null,
    ai_confidence: null,
    ai_reason: null,
    entity_type: fields.entity_type as ImportReviewItem["entity_type"],
    target_collection:
      fields.target_collection as ImportReviewItem["target_collection"],
    category: fields.category ?? null,
    subcategory: null,
    title: fields.title ?? null,
    business_name: fields.business_name ?? null,
    person_name: fields.person_name ?? null,
    description: fields.description ?? null,
    description_original: fields.description_original ?? null,
    services: fields.services ?? [],
    payment_methods: fields.payment_methods ?? [],
    price: null,
    currency: null,
    city: fields.city ?? null,
    state: fields.state ?? null,
    address_line: fields.address_line ?? null,
    postal_code: fields.postal_code ?? null,
    phone: fields.phone ?? [],
    whatsapp: [],
    telegram_username: fields.telegram_username ?? null,
    telegram_user_id: null,
    instagram: fields.instagram ?? [],
    website: fields.website ?? [],
    email: fields.email ?? [],
    photos_count: fields.photos_count ?? 0,
    preview_image_url: fields.preview_image_url ?? null,
    duplicate_status: item.status === "suspected_duplicate" ? "suspected" : null,
    recurring_cluster_id: null,
    occurrence_count: item.mention_count ?? null,
    first_seen: item.created_at,
    last_seen: item.updated_at,
    raw_payload: {
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      state_code: item.state_code ?? null,
    },
    review_status: status,
    review_notes: item.notes,
    reject_reason: null,
    duplicate_of_item_id: null,
    duplicate_of_entity_type: item.duplicate_of_entity_type ?? null,
    duplicate_of_entity_id: item.duplicate_of_entity_id ?? null,
    published_entity_type: item.published_entity_type ?? null,
    published_entity_id: item.published_entity_id ?? null,
    published_at: null,
    last_renewed_at: null,
    expires_at: null,
    approved_at: null,
    approved_by: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

export function yellowPagesToBusinessPreview(
  item: CommentRecommendation,
): Business {
  const name = recommendationDisplayName(item);
  const c = contactBits(item);
  const city = resolveYellowPagesCity(item);
  const presenceFlags = computePresenceFlags({
    phone: c.phone,
    email: c.email,
    website: c.website || c.facebook,
    instagram_url: c.instagramUrl,
    telegram_url: c.telegram,
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
    shortDescription: null,
    description: c.description,
    ratingAvg: 0,
    reviewsCount: 0,
    aiVerifiedReviewsCount: 0,
    transactionVerifiedReviewsCount: 0,
    phone: c.phone,
    email: c.email,
    website: c.website,
    instagramUrl: c.instagramUrl,
    telegramUrl: c.telegram,
    sourceUrl: c.sourceUrl,
    sourceKind: "platform",
    facebookUrl: c.facebook,
    tiktokUrl: null,
    yelpUrl: c.yelp,
    yelpRating: null,
    yelpReviewsCount: 0,
    trustpilotUrl: c.trustpilot,
    trustpilotRating: null,
    trustpilotReviewsCount: 0,
    facebookRecommendPct: null,
    facebookReviewsCount: 0,
    instagramFollowersCount: null,
    googleMapsUrl: null,
    googleRating: null,
    googleReviewsCount: 0,
    bookingUrl: null,
    paymentMethods: item.payment_methods ?? [],
    contactLinks: [
      ...(c.youtube
        ? [{ channel: "youtube" as const, value: c.youtube, label: null }]
        : []),
      ...(c.trustpilot
        ? [
            {
              channel: "trustpilot" as const,
              value: c.trustpilot,
              label: null,
            },
          ]
        : []),
    ],
    imageUrl: item.cover_image_url,
    addressLine: c.address || item.address_line?.trim() || null,
    city,
    region: c.region,
    stateCode: item.state_code?.trim() || null,
    postalCode:
      noteField(item.notes, "zip") ||
      noteField(item.notes, "postal") ||
      noteField(item.notes, "postal_code"),
    latitude:
      typeof item.latitude === "number" && Number.isFinite(item.latitude)
        ? item.latitude
        : null,
    longitude:
      typeof item.longitude === "number" && Number.isFinite(item.longitude)
        ? item.longitude
        : null,
    locationPrecision:
      c.address || item.address_line?.trim() ? "street" : "county",
    openingHours: c.openingHours,
    createdAt: item.created_at,
    presenceFlags,
  };
}

export function yellowPagesToProfessionalPreview(
  item: CommentRecommendation,
): Professional {
  const name = recommendationDisplayName(item);
  const c = contactBits(item);
  const city = resolveYellowPagesCity(item);
  return {
    id: item.id,
    slug: slugFromName(name, item.id),
    displayName: name,
    headline: item.category_guess,
    shortDescription: null,
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
    stateCode: item.state_code?.trim() || null,
    postalCode: null,
    latitude:
      typeof item.latitude === "number" && Number.isFinite(item.latitude)
        ? item.latitude
        : null,
    longitude:
      typeof item.longitude === "number" && Number.isFinite(item.longitude)
        ? item.longitude
        : null,
    addressLine: c.address || item.address_line?.trim() || null,
    locationPrecision:
      c.address || item.address_line?.trim() ? "street" : "county",
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
      hasTelegram: Boolean(c.telegram),
      hasSource: Boolean(c.sourceUrl),
    },
    phone: c.phone,
    email: c.email,
    website: c.website,
    bookingUrl: null,
    paymentMethods: [],
    instagramUrl: c.instagramUrl,
    telegramUrl: c.telegram,
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
  const name = recommendationDisplayName(item);
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
    stateCode: item.state_code?.trim() || null,
    cityGeoid: null,
    latitude:
      typeof item.latitude === "number" && Number.isFinite(item.latitude)
        ? item.latitude
        : null,
    longitude:
      typeof item.longitude === "number" && Number.isFinite(item.longitude)
        ? item.longitude
        : null,
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

