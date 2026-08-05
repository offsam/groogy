import {
  isFacebookUrl,
  isInstagramUrl,
  isTelegramUrl,
  normalizeTelegramInput,
} from "@/lib/business/presence";
import { isOpeningHours } from "@/lib/business/opening-hours";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import { parseContactLinks } from "@/lib/contacts/channels";
import type {
  Church,
  ChurchMinistry,
  ChurchPublicRow,
  ChurchRow,
  ChurchSourceKind,
} from "@/types/church";

const PLACEHOLDER = "/placeholder.svg";

export function deriveChurchSourceKind(
  sourceKind: string | null | undefined,
  sourceUrl: string | null | undefined,
): ChurchSourceKind {
  const kind = (sourceKind ?? "").trim().toLowerCase();
  if (
    kind === "telegram" ||
    kind === "facebook" ||
    kind === "directory" ||
    kind === "platform"
  ) {
    return kind;
  }
  const url = sourceUrl?.trim() || null;
  if (!url) return null;
  if (isFacebookUrl(url)) return "facebook";
  if (isTelegramUrl(url)) return "telegram";
  return "directory";
}

export function parseChurchMinistries(raw: unknown): ChurchMinistry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChurchMinistry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    if (!title) continue;
    const detail =
      typeof row.detail === "string" ? row.detail.trim() || null : null;
    const url = typeof row.url === "string" ? row.url.trim() || null : null;
    out.push({ title: title.slice(0, 160), detail, url });
  }
  return out;
}

export function mapChurchPublic(row: ChurchPublicRow): Church {
  const sourceKind = deriveChurchSourceKind(row.source_kind, null);
  const website = null;
  const hasInstagram = Boolean(row.has_instagram);
  const hasWebsite = Boolean(row.has_website);
  const openingHours = isOpeningHours(row.opening_hours)
    ? row.opening_hours
    : null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: redactContactsFromPublicText(row.description),
    descriptionOriginal: redactContactsFromPublicText(
      row.description_original ?? null,
    ),
    imageUrl: row.image_url || PLACEHOLDER,
    status: row.status,
    addressLine: row.address_line?.trim() || null,
    city: row.city,
    stateCode: row.state_code,
    postalCode: row.postal_code ?? null,
    region: row.region,
    countyGeoid: row.county_geoid ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    locationPrecision: row.location_precision ?? null,
    googleMapsUrl: null,
    openingHours,
    scheduleText: row.schedule_text?.trim() || null,
    ministries: parseChurchMinistries(row.ministries),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    presenceFlags: {
      hasPhone: Boolean(row.has_phone),
      hasEmail: Boolean(row.has_email),
      hasWebsite,
      hasInstagram,
      hasTelegram: Boolean(row.has_telegram),
      hasSource:
        Boolean(row.has_source) ||
        sourceKind === "platform" ||
        Boolean(row.source_kind),
    },
    phone: null,
    email: null,
    website,
    instagramUrl: null,
    telegramUrl: null,
    contactLinks: [],
    sourceUrl: null,
    sourceKind,
  };
}

export function mapChurchOwner(row: ChurchRow): Church {
  const contactLinks = parseContactLinks(row.contact_links);
  const website = row.website?.trim() || null;
  const instagram =
    row.instagram_url?.trim() ||
    (website && isInstagramUrl(website) ? website : null);
  const telegram = normalizeTelegramInput(row.telegram_url) || null;
  const sourceUrl = row.source_url?.trim() || null;
  const sourceKind = deriveChurchSourceKind(row.source_kind, sourceUrl);
  const openingHours = isOpeningHours(row.opening_hours)
    ? row.opening_hours
    : null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    descriptionOriginal: row.description_original ?? null,
    imageUrl: row.image_url || PLACEHOLDER,
    status: row.status,
    addressLine: row.address_line?.trim() || null,
    city: row.city,
    stateCode: row.state_code,
    postalCode: row.postal_code ?? null,
    region: row.region,
    countyGeoid: row.county_geoid ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    locationPrecision: row.location_precision ?? null,
    googleMapsUrl: row.google_maps_url?.trim() || null,
    openingHours,
    scheduleText: row.schedule_text?.trim() || null,
    ministries: parseChurchMinistries(row.ministries),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    presenceFlags: {
      hasPhone: Boolean(row.phone?.trim() || row.has_phone),
      hasEmail: Boolean(row.email?.trim() || row.has_email),
      hasWebsite: Boolean(
        (website && !isInstagramUrl(website)) || row.has_website,
      ),
      hasInstagram: Boolean(instagram || row.has_instagram),
      hasTelegram: Boolean(telegram || row.has_telegram),
      hasSource:
        Boolean(sourceUrl) ||
        sourceKind === "platform" ||
        Boolean(row.has_source),
      extraChannels: contactLinks.map((l) => l.channel),
    },
    phone: row.phone?.trim() || null,
    email: row.email?.trim() || null,
    website: website && !isInstagramUrl(website) ? website : null,
    instagramUrl: instagram,
    telegramUrl: telegram,
    contactLinks,
    sourceUrl,
    sourceKind,
  };
}

export function slugifyChurchName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
