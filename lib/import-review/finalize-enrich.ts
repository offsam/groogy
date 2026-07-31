import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractEmailsFromText,
  extractInstagramFromText,
  extractPhonesFromText,
  extractUsStreetAddress,
} from "@/lib/admin/paste-enrich";
import {
  narrativeWithContactPointer,
  type NarrativeContactChannel,
} from "@/lib/content/structure-business-profile";
import { resegmentCollapsedText } from "@/lib/content/resegment-text";
import {
  offersFromAdTexts,
  serviceLabelsFromOffers,
} from "@/lib/professional/import-services";
import { promotionsFromAdText } from "@/lib/promotions/extract";
import { updatesFromAdText } from "@/lib/updates/extract";
import type { EnrichRunResult } from "@/lib/import-review/enrich-progress";
import type { QueuePromotion } from "@/types/promotion";
import type { QueueUpdate } from "@/types/update";

type QueueRow = {
  id: string;
  description: string | null;
  description_original?: string | null;
  source_language?: string | null;
  source_text: string | null;
  title: string | null;
  phone: string[] | null;
  email: string[] | null;
  instagram: string[] | null;
  website: string[] | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  services: string[] | null;
  promotions: QueuePromotion[] | null;
  updates: QueueUpdate[] | null;
  entity_type: string | null;
  target_collection: string | null;
};

function emptyList(v: string[] | null | undefined): boolean {
  return !(v ?? []).some((x) => String(x || "").trim());
}

function mergeUnique(
  existing: string[] | null | undefined,
  next: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(existing ?? []), ...next]) {
    const t = String(raw || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function blobOf(row: QueueRow): string {
  return [
    resegmentCollapsedText(row.description),
    resegmentCollapsedText(row.source_text),
    row.title,
  ]
    .filter((x): x is string => Boolean(x?.trim()))
    .join("\n\n");
}

function wantsServices(row: QueueRow): boolean {
  const entity = (row.entity_type || "").toLowerCase();
  const target = (row.target_collection || "").toLowerCase();
  return (
    entity.includes("specialist") ||
    entity.includes("professional") ||
    entity.includes("business") ||
    entity.includes("service") ||
    target.includes("specialist") ||
    target.includes("professional") ||
    target.includes("business") ||
    target.includes("service")
  );
}

/**
 * After Python pre-publish enrich: clean description, fill contacts/address
 * from the stripped text, and extract services from the price / service list.
 */
export async function finalizePrePublishEnrich(
  supabase: SupabaseClient,
  itemId: string,
  prior: EnrichRunResult | null,
): Promise<{
  result: EnrichRunResult;
  found: string[];
  removedChannels: NarrativeContactChannel[];
}> {
  const { data: row, error } = await supabase
    .from("import_review_items")
    .select(
      "id, description, description_original, source_language, source_text, title, phone, email, instagram, website, address_line, city, postal_code, services, promotions, updates, entity_type, target_collection",
    )
    .eq("id", itemId)
    .maybeSingle();

  if (error || !row) {
    return {
      result: prior ?? { id: itemId },
      found: [],
      removedChannels: [],
    };
  }

  const item = row as QueueRow;
  const blob = blobOf(item);
  const narrative = narrativeWithContactPointer(
    resegmentCollapsedText(item.description).trim() ||
      resegmentCollapsedText(item.source_text).trim() ||
      null,
  );

  const patch: Record<string, unknown> = {};
  const found: string[] = [];

  if (
    narrative.text &&
    narrative.text.trim() !== (item.description || "").trim()
  ) {
    patch.description = narrative.text;
    found.push("description");
  }

  if (emptyList(item.phone)) {
    const phones = extractPhonesFromText(blob);
    if (phones.length) {
      patch.phone = phones.slice(0, 3);
      found.push("phone");
    }
  }
  if (emptyList(item.email)) {
    const emails = extractEmailsFromText(blob);
    if (emails.length) {
      patch.email = emails.slice(0, 3);
      found.push("email");
    }
  }
  if (emptyList(item.instagram)) {
    const ig = extractInstagramFromText(blob);
    if (ig.length) {
      patch.instagram = ig.slice(0, 3);
      found.push("instagram");
    }
  }

  // Address from source text: fill empty, and repair city stolen from the
  // street name («Irvine» ⊂ «18062 Irvine Blvd» while the post says Tustin, CA).
  {
    const addr = extractUsStreetAddress(blob);
    const curStreet = (item.address_line || "").trim();
    const curCity = (item.city || "").trim();
    if (!curStreet && addr.addressLine) {
      patch.address_line = addr.addressLine;
      found.push("address_line");
    }
    const streetForCheck = String(
      patch.address_line || curStreet || addr.addressLine || "",
    );
    const cityIsStreetToken =
      Boolean(curCity) &&
      streetForCheck.toLowerCase().includes(curCity.toLowerCase()) &&
      new RegExp(
        `\\b${curCity.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b\\s+(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|place|pl|way)\\b`,
        "i",
      ).test(streetForCheck);
    if (
      addr.city &&
      (!curCity ||
        (cityIsStreetToken &&
          addr.city.toLowerCase() !== curCity.toLowerCase()))
    ) {
      patch.city = addr.city;
      found.push("city");
    }
    if (!(item.postal_code || "").trim() && addr.postalCode) {
      patch.postal_code = addr.postalCode;
      found.push("postal_code");
    }
  }

  if (wantsServices(item) && emptyList(item.services)) {
    const offers = offersFromAdTexts([
      resegmentCollapsedText(item.description),
      resegmentCollapsedText(item.source_text),
    ]);
    const labels = serviceLabelsFromOffers(offers);
    if (labels.length) {
      patch.services = labels;
      found.push("services");
    }
  } else if (wantsServices(item) && !emptyList(item.services)) {
    // Keep existing services; still try to add any missing priced titles.
    const offers = offersFromAdTexts([
      resegmentCollapsedText(item.description),
      resegmentCollapsedText(item.source_text),
    ]);
    const labels = serviceLabelsFromOffers(offers);
    const merged = mergeUnique(item.services, labels);
    if (merged.length > (item.services ?? []).length) {
      patch.services = merged;
      found.push("services");
    }
  }

  const existingPromos = Array.isArray(item.promotions) ? item.promotions : [];
  if (existingPromos.length === 0) {
    const promos = promotionsFromAdText(blob);
    if (promos.length) {
      patch.promotions = promos;
      found.push("promotions");
    }
  }

  const existingUpdates = Array.isArray(item.updates) ? item.updates : [];
  if (existingUpdates.length === 0) {
    const updates = updatesFromAdText(blob);
    if (updates.length) {
      patch.updates = updates;
      found.push("updates");
    }
  }

  // Drop promo / update paragraphs from the cleaned narrative so they don't
  // live in both «Описание» and the dedicated sections.
  const promosForStrip = (Array.isArray(patch.promotions)
    ? (patch.promotions as QueuePromotion[])
    : existingPromos) as QueuePromotion[];
  const updatesForStrip = (Array.isArray(patch.updates)
    ? (patch.updates as QueueUpdate[])
    : existingUpdates) as QueueUpdate[];
  if (
    (promosForStrip.length || updatesForStrip.length) &&
    (typeof patch.description === "string" || narrative.text)
  ) {
    let desc = String(patch.description ?? narrative.text ?? "");
    const stripNorms = [
      ...promosForStrip.map((p) =>
        (p.body || p.title || "").replace(/\s+/g, " ").trim().toLowerCase(),
      ),
      ...updatesForStrip.map((u) =>
        (u.body || u.title || "").replace(/\s+/g, " ").trim().toLowerCase(),
      ),
    ].filter(Boolean);
    desc = desc
      .split(/\n{2,}/)
      .filter((block) => {
        const norm = block.replace(/\s+/g, " ").trim().toLowerCase();
        if (!norm) return false;
        if (
          stripNorms.some(
            (p) => p && (norm === p || norm.includes(p) || p.includes(norm)),
          )
        ) {
          return false;
        }
        // Standalone discount blurb leftover after partial strip.
        if (/скидк|акци[яи]|%\s*off|discount/i.test(norm) && norm.length < 220) {
          return false;
        }
        return true;
      })
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (desc && desc !== (item.description || "").trim()) {
      patch.description = desc;
      if (!found.includes("description")) found.push("description");
    }
  }

  // EN → RU so admin preview + approve already show Russian; EN behind «оригинал».
  {
    const descForTranslate = String(
      patch.description ?? item.description ?? "",
    ).trim();
    const target = (item.target_collection || "").toLowerCase();
    const translateTitle =
      target === "events" ||
      target === "jobs" ||
      target === "marketplace" ||
      target === "lechu" ||
      target === "transfers" ||
      target === "real_estate";
    if (descForTranslate) {
      const { resolvePublishNarrative } = await import(
        "@/lib/content/translate-copy-to-ru"
      );
      const narrative = await resolvePublishNarrative({
        title: (item.title || "").trim() || "—",
        description: descForTranslate,
        descriptionOriginal: item.description_original ?? null,
        sourceLanguage: item.source_language ?? null,
        translateTitle,
      });
      if (
        narrative.description &&
        narrative.description !== (item.description || "").trim()
      ) {
        patch.description = narrative.description;
        if (!found.includes("description")) found.push("description");
      }
      if (narrative.descriptionOriginal) {
        patch.description_original = narrative.descriptionOriginal;
        found.push("description_original");
      }
      if (narrative.sourceLanguage) {
        patch.source_language = narrative.sourceLanguage;
        found.push("source_language");
      }
    }
  }

  if (Object.keys(patch).length) {
    const { error: updateError } = await supabase
      .from("import_review_items")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    if (updateError) {
      return {
        result: {
          ...(prior ?? { id: itemId }),
          patch: { ...(prior?.patch ?? {}), ...patch },
        },
        found: [],
        removedChannels: narrative.removedChannels,
      };
    }
  }

  const mergedPatch = {
    ...(prior?.patch ?? {}),
    ...patch,
  };
  const priorSteps = prior?.steps ?? {};
  return {
    result: {
      ...(prior ?? { id: itemId }),
      patch: mergedPatch,
      steps: {
        ...priorSteps,
        cleanup: found,
      },
    },
    found,
    removedChannels: narrative.removedChannels,
  };
}
