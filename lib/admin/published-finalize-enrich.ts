import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractEmailsFromText,
  extractInstagramFromText,
  extractPhonesFromText,
  extractUsStreetAddresses,
} from "@/lib/admin/paste-enrich";
import { narrativeWithContactPointer } from "@/lib/content/structure-business-profile";
import {
  cityFromFreeText,
  normalizeCityLabel,
} from "@/lib/geo/city-aliases";
import {
  geocodeStreetAddress,
  googleMapsUrlForAddress,
} from "@/lib/geo/geocode-street";
import { resegmentCollapsedText } from "@/lib/content/resegment-text";
import {
  inferNameFromDescription,
  isJunkImportTitle,
  taglineForBrand,
} from "@/lib/import-review/display-name";
import { routeCard } from "@/lib/import-review/entity-routing";
import {
  addMissingProfessionalServices,
  offersFromAdTexts,
} from "@/lib/professional/import-services";
import { addMissingBusinessOffers } from "@/lib/business-offers/import-offers";
import { addMissingBusinessLocations } from "@/lib/business/import-locations";
import { promotionsFromAdText } from "@/lib/promotions/extract";
import { addMissingEntityPromotions } from "@/lib/promotions/queries";
import { updatesFromAdText } from "@/lib/updates/extract";
import { addMissingEntityUpdates } from "@/lib/updates/queries";
import type { EnrichRunResult } from "@/lib/import-review/enrich-progress";

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
  phone: string | null;
  email: string | null;
  instagram_url: string | null;
  category_id: string | null;
  source_url: string | null;
  city?: string | null;
  state_code?: string | null;
};

const SELECT_COLUMNS: Record<FinalizableKind, string> = {
  professional:
    "id, slug, display_name, headline, description, short_description, phone, email, instagram_url, category_id, source_url, city, state_code",
  business:
    "id, slug, name, description, short_description, phone, email, instagram_url, category_id, source_url, city, state_code",
};

/** Normalised for «does this name actually occur in the card copy?». */
function nameKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

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
 * Fill-empty only — a published card is live, so nothing already filled by a
 * human gets overwritten.
 */
export async function finalizePublishedEnrich(
  client: SupabaseClient,
  kind: FinalizableKind,
  entityId: string,
  prior: EnrichRunResult | null,
): Promise<{
  result: EnrichRunResult;
  found: string[];
  sectionMismatch?: string | null;
}> {
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
  if (!blob.trim()) return { result, found: [] };

  const found: string[] = [];
  const patch: Record<string, unknown> = {};

  const promos = promotionsFromAdText(blob);
  const promosAdded = promos.length
    ? await addMissingEntityPromotions(
        client,
        kind,
        entityId,
        promos,
        card.category_id,
      )
    : 0;
  if (promosAdded) found.push("promotions");

  const updates = updatesFromAdText(blob);
  const updatesAdded = updates.length
    ? await addMissingEntityUpdates(client, kind, entityId, updates, {
        source: "import",
        sourceUrl: card.source_url,
      })
    : 0;
  if (updatesAdded) found.push("updates");

  const offers = offersFromAdTexts([description, resegmentCollapsedText(ad)]);
  const servicesAdded = offers.length
    ? kind === "professional"
      ? await addMissingProfessionalServices(client, entityId, offers)
      : await addMissingBusinessOffers(client, entityId, offers)
    : 0;
  if (servicesAdded) found.push("services");

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

  // A name that appears nowhere in the card copy is the importer's guess —
  // usually the Telegram sender. The brand the ad repeats wins over it.
  const currentName = String(
    (kind === "business" ? card.name : card.display_name) ?? "",
  ).trim();
  // Name inference counts how often a brand is repeated, so it must see the
  // copy once — `blob` duplicates the description into short_description.
  const nameSource = description.trim() || resegmentCollapsedText(ad);
  const brand = inferNameFromDescription(nameSource);
  if (brand && currentName) {
    const haystack = ` ${nameKey(blob)} `;
    const nameInCopy = haystack.includes(` ${nameKey(currentName)} `);
    const brandIsNew = nameKey(brand) !== nameKey(currentName);
    if (brandIsNew && (!nameInCopy || isJunkImportTitle(currentName))) {
      patch[kind === "business" ? "name" : "display_name"] = brand.slice(0, 160);
      found.push(kind === "business" ? "business_name" : "person_name");
    }
  }

  // A headline naming a trade the copy never mentions («парикмахер» on a cargo
  // service) is leftover from the wrong category — replace it with the pitch.
  if (kind === "professional" && card.headline?.trim()) {
    const headline = card.headline.trim();
    const headlineInCopy = ` ${nameKey(blob)} `.includes(` ${nameKey(headline)} `);
    if (!headlineInCopy) {
      const tagline = taglineForBrand(nameSource, brand ?? currentName);
      if (tagline && nameKey(tagline) !== nameKey(headline)) {
        patch.headline = tagline;
        found.push("headline");
      }
    }
  }

  // Wrong section is never fixed silently: routeCard now sees the mismatch, so
  // the card shows up in «Не тот раздел» with a move button.
  const route = routeCard({
    text: blob,
    businessName: kind === "business" ? currentName : null,
    personName: kind === "professional" ? currentName : null,
    hasContact: Boolean(card.phone || card.email || card.instagram_url),
  });
  const expected = kind === "business" ? "businesses" : "private_specialists";
  const sectionMismatch =
    route.targetCollection && route.targetCollection !== expected
      ? route.targetCollection
      : null;

  // Several pickup / office streets → business_locations (businesses only).
  // Professionals keep them in the text until the card is moved to businesses.
  const extractedAddresses = extractUsStreetAddresses(description);
  const multiAddress = extractedAddresses.length > 1;
  let locationsStored = false;
  if (kind === "business" && extractedAddresses.length > 0) {
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
    // Mirror the first street onto the card pin when the main row is empty.
    const first = extractedAddresses[0];
    if (first.addressLine && !(card as { address_line?: string | null }).address_line) {
      // address_line may not be in SELECT — load only when needed via patch keys
      // the businesses table accepts.
      const { data: bizPin } = await untyped(client)
        .from("businesses")
        .select("address_line")
        .eq("id", entityId)
        .maybeSingle();
      const pin = bizPin as { address_line?: string | null } | null;
      if (!pin?.address_line?.trim()) {
        patch.address_line = first.addressLine;
        if (first.city) patch.city = first.city;
        if (first.state) patch.state_code = `US-${first.state.replace(/^US-/, "")}`;
        if (first.postalCode) patch.postal_code = first.postalCode;
        found.push("address_line");
        // Address found → geocode it, so the card gets a real pin (not a claim).
        const geo = await geocodeStreetAddress(
          {
            addressLine: first.addressLine,
            city: first.city ?? card.city,
            stateCode: first.state ?? card.state_code,
            postalCode: first.postalCode,
          },
          { attempts: "ladder" },
        );
        if (geo) {
          patch.latitude = geo.latitude;
          patch.longitude = geo.longitude;
          patch.location_precision = "street";
          if (!first.postalCode && geo.postalCode) {
            patch.postal_code = geo.postalCode;
          }
          patch.google_maps_url = googleMapsUrlForAddress(
            first.addressLine,
            first.city ?? card.city,
            first.state ?? card.state_code,
          );
          found.push("geo");
        }
      }
    }
  } else if (kind === "professional" && multiAddress) {
    found.push("address_multi");
  }

  // City: directories leave a state code («TX») in the column, while the copy
  // names the place («…в Хьюстоне»). A street patch above always wins.
  if (patch.city === undefined) {
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
    const cleaned = narrative
      .replace(FLAG_RE, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (cleaned && cleaned !== (card.description ?? "").trim()) {
      patch.description = cleaned;
      found.push("description");
    }
  }

  if (Object.keys(patch).length) {
    await untyped(client).from(table).update(patch).eq("id", entityId);
  }

  result.patch = { ...(result.patch ?? {}), ...patch };
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
  if (found.length) result.reason = null;
  return { result, found, sectionMismatch };
}
