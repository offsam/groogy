import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractEmailsFromText,
  extractInstagramFromText,
  extractPhonesFromText,
  extractSpaPostalAddressLines,
  extractUsStreetAddresses,
  preferWebsiteStreet,
} from "@/lib/admin/paste-enrich";
import { narrativeWithContactPointer } from "@/lib/content/structure-business-profile";
import { cleanEnrichDescription } from "@/lib/content/sanitize-public-description";
import {
  cityFromFreeText,
  normalizeCityLabel,
} from "@/lib/geo/city-aliases";
import { cleanAdminStreetAddress } from "@/lib/geo/geocode-street";
import { resegmentCollapsedText } from "@/lib/content/resegment-text";
import { stateCodeFromText } from "@/lib/address/normalize";
import {
  postalConflictsKnownCity,
  reconcileStateCode,
} from "@/lib/geo/us-zip-state";
import {
  eventBlocksFromText,
  isVacancyAdText,
} from "@/lib/admin/ad-block-classifier";
import {
  correctEnrichCardIdentity,
  slugifyBusinessBrand,
  slugLooksLikePersonName,
  slugMismatchesBrandName,
} from "@/lib/admin/enrich-identity-correction";
import { isJunkImportTitle } from "@/lib/import-review/display-name";
import {
  addMissingBusinessEvents,
  eventsFromAdText,
} from "@/lib/events/from-ad-text";
import {
  addMissingJobsFromAd,
  resolveJobWorksite,
  vacancyFromAdText,
} from "@/lib/jobs/from-ad-text";
import {
  addMissingProfessionalServices,
  offersFromAdTexts,
} from "@/lib/professional/import-services";
import {
  addMissingBusinessOffers,
  menuItemsToImportedOffers,
} from "@/lib/business-offers/import-offers";
import { isFoodBusinessCategory } from "@/lib/business-offers/food-category";
import {
  looksLikeMenuDocument,
  parseMenuFromText,
} from "@/lib/business-offers/parse-menu-text";
import { addMissingBusinessLocations } from "@/lib/business/import-locations";
import { promotionsFromAdText } from "@/lib/promotions/extract";
import { addMissingEntityPromotions } from "@/lib/promotions/queries";
import { updatesFromAdText } from "@/lib/updates/extract";
import { addMissingEntityUpdates } from "@/lib/updates/queries";
import type { EnrichRunResult } from "@/lib/import-review/enrich-progress";
import type { QueueUpdate } from "@/types/update";

/** Card kinds whose description is parsed into blocks. */
export type FinalizableKind = "professional" | "business";

export function isFinalizableKind(kind: string): kind is FinalizableKind {
  return kind === "professional" || kind === "business";
}

const TABLES: Record<FinalizableKind, string> = {
  professional: "professionals",
  business: "businesses",
};

/** Regional indicator pairs — flags are banned everywhere in the product UI. */
const FLAG_RE = /[\u{1F1E6}-\u{1F1FF}]{2}\uFE0F?/gu;

type CardRow = {
  id: string;
  slug: string | null;
  name?: string | null;
  display_name?: string | null;
  headline?: string | null;
  description: string | null;
  short_description: string | null;
  description_original?: string | null;
  phone: string | null;
  email: string | null;
  website?: string | null;
  instagram_url: string | null;
  category_id: string | null;
  source_url: string | null;
  city?: string | null;
  state_code?: string | null;
  region?: string | null;
  address_line?: string | null;
  private_address_line?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_precision?: string | null;
  google_maps_url?: string | null;
  categories?:
    | { slug?: string | null; name?: string | null }
    | Array<{ slug?: string | null; name?: string | null }>
    | null;
};

/** Marketing «7213 truck driver vacancies» must never become a pin. */
function isJunkStreetCandidate(value: string | null | undefined): boolean {
  const t = String(value || "").trim();
  if (!t) return true;
  return /\b(?:vacanc(?:y|ies)|hiring|jobs?\s+per\s+day|truck\s+driver|earn\s+\$)\b/i.test(
    t,
  );
}

function categoryMeta(card: CardRow): { slug: string | null; name: string | null } {
  const raw = card.categories;
  const one = Array.isArray(raw) ? raw[0] : raw;
  return {
    slug: one?.slug?.trim() || null,
    name: one?.name?.trim() || null,
  };
}

function htmlToVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((ln) => ln.trim())
    .filter(Boolean)
    .join("\n");
}

function extractJsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = (m[1] || "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

function sameOriginScriptUrls(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const host = base.hostname.replace(/^www\./i, "").toLowerCase();
  const out: string[] = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    const raw = (m[1] || "").trim();
    if (!raw || raw.startsWith("data:")) continue;
    let abs: URL;
    try {
      abs = new URL(raw, base);
    } catch {
      continue;
    }
    const h = abs.hostname.replace(/^www\./i, "").toLowerCase();
    if (h !== host) continue;
    if (!/\.js(?:$|\?)/i.test(abs.pathname)) continue;
    // Skip analytics / tag managers — keep app bundles (CRA /static/js, Vite /assets).
    if (
      /googletagmanager|google-analytics|gtag\/|facebook\.net|hotjar|clarity/i.test(
        abs.href,
      )
    ) {
      continue;
    }
    out.push(abs.toString());
    if (out.length >= 3) break;
  }
  return out;
}

async function fetchTextLimited(
  url: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "*/*",
        "User-Agent": "KrugiEnrich/1.0 (+https://krugi.app)",
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch {
    return null;
  }
}

function extractMetaText(html: string): string[] {
  const out: string[] = [];
  const re =
    /<meta[^>]+(?:property|name)=["'](og:title|og:site_name|og:description|description|twitter:title|twitter:description)["'][^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const content = tag.match(/content=["']([^"']{3,500})["']/i)?.[1];
    if (content?.trim()) out.push(content.trim());
  }
  const title = html.match(/<title[^>]*>([^<]{3,200})<\/title>/i)?.[1];
  if (title?.trim()) out.push(title.trim());
  return out;
}

/**
 * Visible page text plus SPA/JSON-LD office lines (React sites hide addresses
 * in /static/js bundles — plain HTML fetch alone misses them).
 */
async function fetchWebsiteVisibleText(
  website: string | null | undefined,
  path = "/",
): Promise<string | null> {
  const raw = (website || "").trim();
  if (!raw) return null;
  const base = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: string;
  try {
    const u = new URL(base);
    if (path && path !== "/") {
      u.pathname = path;
      u.search = "";
      u.hash = "";
    }
    url = u.toString();
  } catch {
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        "User-Agent": "KrugiEnrich/1.0 (+https://krugi.app)",
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 200) return null;

    const parts: string[] = [];
    parts.push(...extractMetaText(html));
    for (const block of extractJsonLdBlocks(html)) {
      parts.push(block);
      parts.push(...extractSpaPostalAddressLines(block));
    }
    const visible = htmlToVisibleText(html);
    if (visible) parts.push(visible);

    for (const scriptUrl of sameOriginScriptUrls(html, url)) {
      const js = await fetchTextLimited(scriptUrl, 1_500_000);
      if (!js) continue;
      const addrs = extractSpaPostalAddressLines(js);
      if (addrs.length) parts.push(...addrs);
      // Booking CTAs (Calendly) often live only in the app bundle.
      const book = js.match(
        /https?:\/\/(?:www\.)?calendly\.com\/[A-Za-z0-9_\-/?=&%.]+/i,
      );
      if (book?.[0]) parts.push(`Booking: ${book[0]}`);
    }

    const text = parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text.length < 80) return null;
    return text.slice(0, 40_000);
  } catch {
    return null;
  }
}

async function fetchWebsiteMenuText(
  website: string | null | undefined,
): Promise<string | null> {
  return fetchWebsiteVisibleText(website, "/menu");
}

const SELECT_COLUMNS: Record<FinalizableKind, string> = {
  professional:
    "id, slug, display_name, headline, description, description_original, short_description, phone, email, website, instagram_url, category_id, source_url, city, state_code, private_address_line, postal_code, latitude, longitude, location_precision, categories(slug, name)",
  business:
    "id, slug, name, description, description_original, short_description, phone, email, website, instagram_url, category_id, source_url, city, state_code, address_line, postal_code, latitude, longitude, location_precision, google_maps_url, categories(slug, name)",
};

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

/** Ad copy the card was published from — the offer often survives only there. */
async function sourceText(
  client: SupabaseClient,
  entityId: string,
): Promise<string | null> {
  const { data } = await untyped(client)
    .from("import_review_items")
    .select("source_text, description")
    .eq("published_entity_id", entityId)
    .limit(3);
  const parts = ((data ?? []) as Array<{
    source_text: string | null;
    description: string | null;
  }>).flatMap((row) => [row.source_text, row.description]);
  const text = parts.filter((x) => x?.trim()).join("\n\n");
  return text.trim() || null;
}

function stripBlocks(text: string, bodies: string[]): string {
  const norms = bodies
    .map((b) => b.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  if (!norms.length) return text;
  return text
    .split(/\n{2,}/)
    .filter((block) => {
      const norm = block.replace(/\s+/g, " ").trim().toLowerCase();
      if (!norm) return false;
      return !norms.some((n) => norm === n || norm.includes(n) || n.includes(norm));
    })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Runs after the Python resource crawl on a published card: pulls услуги,
 * акции and обновления out of the card copy and leaves «О нас» as narrative.
 *
 * Contacts / offers stay fill-empty. Street address is different: the card's
 * own website (or ad text) may rewrite a wrong dump, then peel + geocode.
 */
export async function finalizePublishedEnrich(
  client: SupabaseClient,
  kind: FinalizableKind,
  entityId: string,
  prior: EnrichRunResult | null,
  opts?: { dryRun?: boolean },
): Promise<{
  result: EnrichRunResult;
  found: string[];
  sectionMismatch?: string | null;
}> {
  const dryRun = Boolean(opts?.dryRun);
  const table = TABLES[kind];
  const { data, error } = await untyped(client)
    .from(table)
    .select(SELECT_COLUMNS[kind])
    .eq("id", entityId)
    .maybeSingle();

  const result: EnrichRunResult = { ...(prior ?? {}) };
  if (error || !data) return { result, found: [] };

  const card = data as unknown as CardRow;
  const ad = await sourceText(client, entityId);
  // Imported copy often arrives as one line; parsers below need paragraphs.
  const description = resegmentCollapsedText(card.description);
  const blob = [description, card.short_description, resegmentCollapsedText(ad)]
    .filter((x): x is string => Boolean(x?.trim()))
    .join("\n\n");

  const found: string[] = [];
  const patch: Record<string, unknown> = {};
  const cat = categoryMeta(card);
  const foodVenue =
    kind === "business" && isFoodBusinessCategory(cat.slug, cat.name);

  // Food venues: /menu from prior Python crawl or live fetch → menu_item.
  if (kind === "business" && foodVenue) {
    const menuBlob =
      (typeof prior?.menu_text === "string" && prior.menu_text.trim()
        ? prior.menu_text
        : null) || (await fetchWebsiteMenuText(card.website));
    if (menuBlob) {
      const menuItems = parseMenuFromText(menuBlob);
      if (menuItems.length > 0) {
        if (dryRun) {
          found.push("menu");
        } else {
          const menuAdded = await addMissingBusinessOffers(
            client,
            entityId,
            menuItemsToImportedOffers(menuItems),
            { offerType: "menu_item" },
          );
          if (menuAdded) found.push("menu");
        }
      }
    }
  }

  const hasCopy = Boolean(blob.trim());
  if (!hasCopy && !card.website?.trim()) {
    if (found.length) {
      result.steps = {
        ...(result.steps ?? {}),
        cleanup: found,
      };
      result.reason = null;
    }
    if (dryRun) result.pending_review = true;
    return { result, found };
  }

  const promos = promotionsFromAdText(blob);
  if (promos.length) {
    if (dryRun) {
      found.push("promotions");
    } else {
      const promosAdded = await addMissingEntityPromotions(
        client,
        kind,
        entityId,
        promos,
        card.category_id,
      );
      if (promosAdded) found.push("promotions");
    }
  }

  const updates = updatesFromAdText(blob);
  // Professionals have no events FK — dated affiche blocks become updates.
  const eventAnnounceUpdates: QueueUpdate[] = [];
  if (kind === "professional") {
    for (const block of eventBlocksFromText(blob)) {
      const drafts = eventsFromAdText(block);
      for (const d of drafts) {
        eventAnnounceUpdates.push({
          title: d.title,
          body: d.body,
        });
      }
    }
  }
  const updatesMerged = [...updates, ...eventAnnounceUpdates];
  if (updatesMerged.length) {
    if (dryRun) {
      found.push("updates");
    } else {
      const updatesAdded = await addMissingEntityUpdates(
        client,
        kind,
        entityId,
        updatesMerged,
        {
          source: "import",
          sourceUrl: card.source_url,
        },
      );
      if (updatesAdded) found.push("updates");
    }
  }

  // Vacancies → jobs (not services). Events on businesses → /events.
  // Agency businesses keep HQ on the card; worksite streets go on the job.
  const vacancyAd = isVacancyAdText(blob);
  const vacancyWorksiteHits = vacancyAd
    ? extractUsStreetAddresses(blob).filter(
        (a) => a.addressLine && !isJunkStreetCandidate(a.addressLine),
      )
    : [];
  const vacancyWorksiteHit = vacancyWorksiteHits[0] ?? null;

  if (vacancyAd) {
    const vacancies = vacancyFromAdText(blob);
    if (vacancies.length) {
      const worksite = vacancyWorksiteHit
        ? await resolveJobWorksite({
            addressLine: vacancyWorksiteHit.addressLine,
            city: vacancyWorksiteHit.city,
            stateCode: vacancyWorksiteHit.state
              ? `US-${vacancyWorksiteHit.state.replace(/^US-/i, "").toUpperCase()}`
              : null,
            postalCode: vacancyWorksiteHit.postalCode,
          })
        : await resolveJobWorksite({
            city: card.city,
            stateCode: card.state_code,
            postalCode: card.postal_code,
          });
      const drafts = vacancies.map((v) => ({
        ...v,
        addressLine: worksite.addressLine,
        city: worksite.city,
        stateCode: worksite.stateCode,
        postalCode: worksite.postalCode,
        latitude: worksite.latitude,
        longitude: worksite.longitude,
        locationPrecision: worksite.locationPrecision,
      }));
      if (dryRun) {
        found.push("jobs");
        result.pending_jobs = drafts.map((d) => ({
          title: d.title,
          description: d.description,
          address_line: d.addressLine ?? null,
          city: d.city ?? null,
          state_code: d.stateCode ?? null,
          postal_code: d.postalCode ?? null,
          latitude: d.latitude ?? null,
          longitude: d.longitude ?? null,
          location_precision: d.locationPrecision ?? null,
        }));
      } else {
        const jobsAdded = await addMissingJobsFromAd(client, drafts, {
          sourceUrl: card.source_url,
          businessId: kind === "business" ? entityId : null,
          geocodeWorksite: false,
        });
        if (jobsAdded) found.push("jobs");
      }
    }
  } else if (kind === "business") {
    const eventDrafts = eventsFromAdText(blob);
    if (eventDrafts.length) {
      if (dryRun) {
        found.push("events");
      } else {
        const eventsAdded = await addMissingBusinessEvents(
          client,
          entityId,
          eventDrafts,
          { sourceUrl: card.source_url },
        );
        if (eventsAdded) found.push("events");
      }
    }
  }

  // Services only from copy that is not a vacancy/event block.
  // Food menus go to menu_item (above / parse below), not generic services.
  const offerSources = [description, resegmentCollapsedText(ad)].filter(
    (t): t is string => Boolean(t?.trim()),
  );
  const combinedOffersText = offerSources.join("\n\n");
  let servicesAdded = 0;
  if (
    kind === "business" &&
    foodVenue &&
    looksLikeMenuDocument(combinedOffersText)
  ) {
    const fromCopy = parseMenuFromText(combinedOffersText);
    if (fromCopy.length > 0) {
      if (dryRun) {
        found.push("menu");
      } else {
        const menuAdded = await addMissingBusinessOffers(
          client,
          entityId,
          menuItemsToImportedOffers(fromCopy),
          { offerType: "menu_item" },
        );
        if (menuAdded) found.push("menu");
      }
    }
  } else if (!(kind === "business" && foodVenue)) {
    // Restaurants/cafes: never scrape opening posts into «Меню» as services.
    const offers = offersFromAdTexts(offerSources);
    if (offers.length) {
      if (dryRun) {
        found.push("services");
        servicesAdded = offers.length;
      } else {
        servicesAdded =
          kind === "professional"
            ? await addMissingProfessionalServices(client, entityId, offers)
            : await addMissingBusinessOffers(client, entityId, offers);
        if (servicesAdded) found.push("services");
      }
    }
  }

  if (!card.phone?.trim()) {
    const [phone] = extractPhonesFromText(blob);
    if (phone) {
      patch.phone = phone;
      found.push("phone");
    }
  }
  if (!card.email?.trim()) {
    const [email] = extractEmailsFromText(blob);
    if (email) {
      patch.email = email;
      found.push("email");
    }
  }
  if (!card.instagram_url?.trim()) {
    const [handle] = extractInstagramFromText(blob);
    if (handle) {
      patch.instagram_url = `https://www.instagram.com/${handle.replace(/^@/, "")}`;
      found.push("instagram_url");
    }
  }

  // Website text first — SPA offices live in JS bundles; also feeds junk-title rename.
  const siteText = card.website?.trim()
    ? await fetchWebsiteVisibleText(card.website)
    : null;

  // Telegram poster name → store brand; retail storefront → «Не тот раздел».
  const currentName = String(
    (kind === "business" ? card.name : card.display_name) ?? "",
  ).trim();
  const baseNameSource = description.trim() || resegmentCollapsedText(ad) || "";
  const nameSource =
    isJunkImportTitle(currentName) && siteText?.trim()
      ? `${baseNameSource}\n\n${siteText}`.slice(0, 6000)
      : baseNameSource;
  const identity = correctEnrichCardIdentity({
    kind,
    currentName,
    headline: card.headline,
    description: nameSource,
    routeText: [blob, siteText].filter((x): x is string => Boolean(x?.trim())).join("\n\n"),
    phone: card.phone,
    email: card.email,
    website: card.website,
    instagramUrl: card.instagram_url,
    addressLine:
      kind === "business" ? card.address_line : card.private_address_line,
    postalCode: card.postal_code,
  });
  if (identity.displayName) {
    patch[kind === "business" ? "name" : "display_name"] = identity.displayName;
    found.push(kind === "business" ? "business_name" : "person_name");
  }
  if (identity.headline) {
    patch.headline = identity.headline;
    found.push("headline");
  }

  // Person URL left after rename to brand → retarget slug (maksim-degtyar → lamour-…).
  if (kind === "business") {
    const liveName = String(
      identity.displayName || card.name || "",
    ).trim();
    const currentSlug = (card.slug || "").trim();
    const wantSlug =
      identity.suggestedSlug ||
      (liveName &&
      /\b(boutique|florist|shop|store|flower|bakery|salon|studio|clinic|gallery|кафе|бутик|магазин)\b/i.test(
        liveName,
      ) &&
      slugLooksLikePersonName(currentSlug) &&
      slugMismatchesBrandName(currentSlug, liveName)
        ? slugifyBusinessBrand(liveName)
        : null);
    if (wantSlug && wantSlug !== currentSlug) {
      let candidate = wantSlug;
      for (let n = 0; n < 8; n += 1) {
        const trySlug = n === 0 ? candidate : `${wantSlug}-${n}`;
        const { data: clash } = await untyped(client)
          .from("businesses")
          .select("id")
          .eq("slug", trySlug)
          .neq("id", entityId)
          .maybeSingle();
        if (!clash) {
          candidate = trySlug;
          break;
        }
      }
      if (candidate !== currentSlug) {
        patch.slug = candidate;
        found.push("slug");
      }
    }
  }

  const sectionMismatch = identity.sectionMismatch;
  const route = identity.route;

  // Street pin: website / ad text may rewrite a wrong dump on the card, then
  // peel City/ST/ZIP and geocode (same cleanAdminStreetAddress as paste/queue).
  const addressKey =
    kind === "professional" ? "private_address_line" : "address_line";
  const cardStreet =
    (
      kind === "professional" ? card.private_address_line : card.address_line
    )?.trim() || null;

  const priorExtra = Array.isArray(
    (prior as { extra_addresses?: unknown } | null)?.extra_addresses,
  )
    ? (
        (prior as { extra_addresses?: unknown[] }).extra_addresses ?? []
      )
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    : [];
  const addressBlob = [blob, siteText, ...priorExtra]
    .filter((x): x is string => Boolean(x?.trim()))
    .join("\n\n");

  // Vacancy worksites must not become agency office pins / multi-locations.
  const extractedAddresses = (
    vacancyAd && kind === "business"
      ? []
      : extractUsStreetAddresses(addressBlob)
  ).filter((a) => a.addressLine && !isJunkStreetCandidate(a.addressLine));
  const multiAddress = extractedAddresses.length > 1;
  let locationsStored = false;
  if (kind === "business" && extractedAddresses.length > 0) {
    if (dryRun) {
      found.push("locations");
      result.extra_addresses = extractedAddresses.map((a) =>
        [a.addressLine, a.city, a.state, a.postalCode].filter(Boolean).join(", "),
      );
    } else {
      const added = await addMissingBusinessLocations(
        client,
        entityId,
        extractedAddresses,
        { source: "enrich_description", sourceUrl: card.source_url },
      );
      if (added) {
        found.push("locations");
        locationsStored = true;
      }
    }
  } else if (kind === "professional" && multiAddress) {
    found.push("address_multi");
  }

  const priorPatch = (prior?.patch ?? {}) as Record<string, unknown>;
  const priorStreetRaw =
    (typeof priorPatch[addressKey] === "string"
      ? String(priorPatch[addressKey])
      : typeof priorPatch.address_line === "string"
        ? String(priorPatch.address_line)
        : typeof priorPatch.private_address_line === "string"
          ? String(priorPatch.private_address_line)
          : "") || "";
  const priorStreet = priorStreetRaw.trim() || null;

  const textHit = extractedAddresses[0] ?? null;
  let pickStreet = cardStreet;
  let pickCity = card.city?.trim() || null;
  let pickState = card.state_code?.trim() || null;
  let pickZip = card.postal_code?.trim() || null;

  // Agency + vacancy: keep existing HQ street; never adopt worksite as office.
  const skipVacancyStreetOntoAgency = vacancyAd && kind === "business";

  // Website / crawl street beats a wrong dump already on the card.
  if (
    !skipVacancyStreetOntoAgency &&
    priorStreet &&
    !isJunkStreetCandidate(priorStreet) &&
    preferWebsiteStreet(pickStreet, priorStreet)
  ) {
    pickStreet = priorStreet;
  }
  if (
    !skipVacancyStreetOntoAgency &&
    textHit?.addressLine &&
    preferWebsiteStreet(pickStreet, textHit.addressLine)
  ) {
    pickStreet = textHit.addressLine;
    if (textHit.city) pickCity = textHit.city;
    if (textHit.state) {
      pickState = `US-${textHit.state.replace(/^US-/i, "").toUpperCase()}`;
    }
    if (textHit.postalCode) pickZip = textHit.postalCode;
  } else if (
    !skipVacancyStreetOntoAgency &&
    textHit?.addressLine &&
    pickStreet
  ) {
    // Same street as card/prior — still take peeled city/ST/ZIP from text.
    const sameAsPick =
      !preferWebsiteStreet(pickStreet, textHit.addressLine) &&
      !preferWebsiteStreet(textHit.addressLine, pickStreet);
    if (sameAsPick) {
      if (textHit.city) pickCity = textHit.city;
      if (textHit.state) {
        pickState = `US-${textHit.state.replace(/^US-/i, "").toUpperCase()}`;
      }
      if (textHit.postalCode) pickZip = textHit.postalCode;
    }
  }

  if (pickStreet && !skipVacancyStreetOntoAgency) {
    const cleaned = await cleanAdminStreetAddress(
      {
        addressLine: pickStreet,
        city: pickCity,
        stateCode: pickState,
        postalCode: pickZip,
      },
      { withGeo: true },
    );
    const nextStreet = cleaned.addressLine?.trim() || null;
    const missingGeo =
      card.latitude == null ||
      card.longitude == null ||
      !Number.isFinite(Number(card.latitude)) ||
      !Number.isFinite(Number(card.longitude));
    const streetRewrite =
      Boolean(nextStreet) &&
      (preferWebsiteStreet(cardStreet, nextStreet) ||
        (nextStreet !== null && nextStreet !== cardStreet));

    if (nextStreet && (streetRewrite || cleaned.changed || missingGeo)) {
      if (streetRewrite || nextStreet !== cardStreet) {
        patch[addressKey] = nextStreet;
        found.push("address_line");
      }
      if (cleaned.city && cleaned.city !== (card.city || "").trim()) {
        patch.city = cleaned.city;
        if (!found.includes("city")) found.push("city");
      }
      if (
        cleaned.stateCode &&
        cleaned.stateCode !== (card.state_code || "").trim()
      ) {
        patch.state_code = cleaned.stateCode;
        found.push("state_code");
      }
      if (
        cleaned.postalCode &&
        cleaned.postalCode !== (card.postal_code || "").trim()
      ) {
        patch.postal_code = cleaned.postalCode;
        found.push("postal_code");
      }
      if (cleaned.latitude != null && cleaned.longitude != null) {
        patch.latitude = cleaned.latitude;
        patch.longitude = cleaned.longitude;
        patch.location_precision = cleaned.locationPrecision ?? "street";
        if (kind === "business" && cleaned.googleMapsUrl) {
          patch.google_maps_url = cleaned.googleMapsUrl;
        }
        if (!found.includes("geo")) found.push("geo");
      }
    }
  }

  // City: directories leave a state code («TX») in the column, while the copy
  // names the place («…в Хьюстоне»). A street patch above always wins.
  // Vacancy ads: do not adopt worksite city onto the staffing agency card.
  if (patch.city === undefined && !(vacancyAd && kind === "business")) {
    const cardCity = normalizeCityLabel(card.city);
    if (cardCity && cardCity !== card.city?.trim()) {
      patch.city = cardCity;
      found.push("city");
    } else if (!cardCity) {
      const fromText = cityFromFreeText(blob);
      const stateCode = card.state_code?.trim() || "";
      if (fromText && (!stateCode || stateCode === fromText.stateCode)) {
        patch.city = fromText.city;
        if (!stateCode) patch.state_code = fromText.stateCode;
        found.push("city");
      }
    }
  }

  // Region / ZIP often already have the right state while state_code stayed a
  // hub default (US-CA). Prefer ZIP/region/known city before the street peel
  // above left state alone — otherwise geocode + city map both miss.
  {
    const nextCity =
      (typeof patch.city === "string" ? patch.city : null) || card.city;
    const nextZip =
      (typeof patch.postal_code === "string" ? patch.postal_code : null) ||
      card.postal_code;
    const reconciled = reconcileStateCode({
      stateCode:
        (typeof patch.state_code === "string" ? patch.state_code : null) ||
        card.state_code,
      postalCode: nextZip,
      city: nextCity,
      region:
        (typeof patch.region === "string" ? patch.region : null) || card.region,
      regionState: stateCodeFromText(
        String(
          (typeof patch.region === "string" ? patch.region : null) ||
            card.region ||
            "",
        ),
      ),
    });
    const cardState = (
      (typeof patch.state_code === "string" ? patch.state_code : null) ||
      card.state_code ||
      ""
    )
      .trim()
      .toUpperCase();
    if (
      reconciled &&
      (!cardState || reconciled.toUpperCase() !== cardState)
    ) {
      patch.state_code = reconciled;
      if (!found.includes("state_code")) found.push("state_code");
    }

    // Hub dump: Florida city + Fresno ZIP → drop ZIP and stale Fresno pin.
    if (postalConflictsKnownCity(nextCity, nextZip)) {
      if (card.postal_code || patch.postal_code) {
        patch.postal_code = null;
        if (!found.includes("postal_code")) found.push("postal_code");
      }
      if (
        card.latitude != null ||
        card.longitude != null ||
        patch.latitude != null
      ) {
        patch.latitude = null;
        patch.longitude = null;
        patch.location_precision = null;
        if (kind === "business") patch.google_maps_url = null;
        if (!found.includes("geo")) found.push("geo");
      }
    }
  }

  // «О нас» keeps only narrative: no contacts, no flags, no promo / news blocks
  // that now live in their own sections. Professionals with several streets keep
  // the addresses in the text — the card cannot store them yet.
  const keepAddressesInText =
    kind === "professional" && multiAddress && !locationsStored;

  if (description.trim()) {
    const narrative = keepAddressesInText
      ? description
      : stripBlocks(narrativeWithContactPointer(description).text ?? "", [
          ...promos.map((p) => p.body || p.title),
          ...updates.map((u) => u.body || u.title),
        ]);
    let cleaned = narrative
      .replace(FLAG_RE, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    cleaned = cleanEnrichDescription(cleaned) ?? cleaned;
    if (cleaned) {
      const { resolvePublishNarrative } = await import(
        "@/lib/content/translate-copy-to-ru"
      );
      const narrativeRu = await resolvePublishNarrative({
        title: currentName || "—",
        description: cleaned,
        descriptionOriginal:
          (card as { description_original?: string | null }).description_original ??
          null,
        translateTitle: false,
      });
      cleaned = narrativeRu.description || cleaned;
      if (
        narrativeRu.descriptionOriginal &&
        narrativeRu.descriptionOriginal !== cleaned
      ) {
        patch.description_original = narrativeRu.descriptionOriginal;
      }
    }
    if (cleaned && cleaned !== (card.description ?? "").trim()) {
      patch.description = cleaned;
      found.push("description");
    }
  }

  if (Object.keys(patch).length) {
    if (!dryRun) {
      await untyped(client).from(table).update(patch).eq("id", entityId);
    }
  }

  result.patch = { ...(result.patch ?? {}), ...patch };
  if (dryRun) {
    result.pending_review = true;
    if (
      Object.keys(result.patch ?? {}).length ||
      (result.field_conflicts?.length ?? 0) > 0 ||
      found.length
    ) {
      result.reason =
        result.reason ||
        "Черновик — отметьте поля ниже и нажмите «Сохранить».";
    }
  }
  result.services_inserted = (result.services_inserted ?? 0) + servicesAdded;
  result.steps = {
    ...(result.steps ?? {}),
    cleanup: found,
  };
  if (sectionMismatch) {
    result.section_mismatch = {
      suggested: sectionMismatch,
      reason: route.reason,
      confidence: route.confidence,
    };
  }
  if (found.length) result.reason = dryRun
    ? result.reason
    : null;
  return { result, found, sectionMismatch };
}
