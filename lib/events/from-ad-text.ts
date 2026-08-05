/**
 * Dated event / affiche blocks from card ad copy → events rows
 * (business provider link). Used by published enrich finalize.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  eventBlocksFromText,
  firstAdTitleLine,
} from "@/lib/admin/ad-block-classifier";
import { ensureTitleBodyRu } from "@/lib/content/translate-copy-to-ru";
import { structureEventFromText } from "@/lib/events/structure-event-from-text";

export type AdEventDraft = {
  title: string;
  body: string;
  startsAt: string | null;
  eventAtLabel: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  priceLabel: string | null;
  registrationUrl: string | null;
  phone: string | null;
};

const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function slugifyEventTitle(input: string): string {
  const chars: string[] = [];
  for (const ch of input.toLowerCase()) {
    if (CYR_TO_LAT[ch] !== undefined) chars.push(CYR_TO_LAT[ch]);
    else if (/[a-z0-9]/.test(ch)) chars.push(ch);
    else if (/\s|-|_/.test(ch)) chars.push("-");
  }
  const base =
    chars
      .join("")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "event";
  const stamp = Date.now().toString(36).slice(-5);
  return `${base}-${stamp}`;
}

function titleKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

/** Event drafts from ad paragraphs that look like dated affiches. */
export function eventsFromAdText(
  text: string | null | undefined,
): AdEventDraft[] {
  const out: AdEventDraft[] = [];
  const seen = new Set<string>();
  for (const block of eventBlocksFromText(text)) {
    const structured = structureEventFromText(block);
    const title = firstAdTitleLine(block, "Событие");
    const key = titleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      body: (structured.description || block).slice(0, 4000),
      startsAt: structured.startsAt,
      eventAtLabel: structured.eventAtLabel,
      addressLine: structured.addressLine,
      city: structured.city,
      postalCode: structured.postalCode,
      priceLabel: structured.priceLabel,
      registrationUrl: structured.registrationUrl,
      phone: structured.phone,
    });
  }
  return out;
}

/**
 * Fill-empty insert of events linked to a business.
 * Published only when starts_at is known; otherwise draft.
 */
export async function addMissingBusinessEvents(
  client: SupabaseClient,
  businessId: string,
  drafts: AdEventDraft[],
  opts?: { sourceUrl?: string | null },
): Promise<number> {
  if (!drafts.length) return 0;
  const db = untyped(client);
  const sourceUrl = opts?.sourceUrl?.trim() || null;

  const { data: existing } = await db
    .from("events")
    .select("id, title, source_url")
    .eq("provider_business_id", businessId)
    .limit(80);

  const existingKeys = new Set(
    ((existing ?? []) as Array<{ title: string | null; source_url: string | null }>)
      .map((row) => {
        const t = titleKey(row.title || "");
        if (!t) return "";
        if (sourceUrl && row.source_url === sourceUrl) return `src:${t}`;
        return t;
      })
      .filter(Boolean),
  );

  let added = 0;
  for (const draft of drafts) {
    const localized = await ensureTitleBodyRu({
      title: draft.title,
      body: draft.body,
    });
    const key = titleKey(localized.title);
    if (!key) continue;
    if (existingKeys.has(key) || existingKeys.has(`src:${key}`)) continue;

    const status = draft.startsAt ? "published" : "draft";
    const { error } = await db.from("events").insert({
      provider_business_id: businessId,
      title: localized.title.slice(0, 200),
      slug: slugifyEventTitle(localized.title),
      description: localized.body,
      status,
      starts_at: draft.startsAt,
      event_at_label: draft.eventAtLabel,
      city: draft.city,
      address_line: draft.addressLine,
      price_label: draft.priceLabel,
      registration_url: draft.registrationUrl,
      phone: draft.phone,
      source_url: sourceUrl,
      format: draft.addressLine ? "offline" : "unknown",
    });
    if (error) continue;
    existingKeys.add(key);
    if (sourceUrl) existingKeys.add(`src:${key}`);
    added += 1;
  }
  return added;
}
