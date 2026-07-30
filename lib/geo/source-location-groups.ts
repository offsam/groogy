/**
 * USA source-group → location catalog.
 * Seed: data/geo/source_location_groups.json
 */

import catalog from "@/data/geo/source_location_groups.json";

export type SourceGroupScope = "city" | "county" | "metro";

export type SourceGroupEntry = {
  id: string;
  chat_ids: string[];
  match: string | null;
  scope: SourceGroupScope;
  city: string | null;
  region: string;
  county_geoid: string;
  state_code: string;
  hub_id: string | null;
};

export type SourceGroupLocationHit = {
  city: string | null;
  region: string;
  countyGeoid: string;
  stateCode: string;
  hubId: string | null;
  scope: SourceGroupScope;
  catalogId: string;
};

const ENTRIES = catalog as SourceGroupEntry[];

const BY_CHAT = new Map<string, SourceGroupEntry>();
for (const entry of ENTRIES) {
  for (const chatId of entry.chat_ids ?? []) {
    if (chatId) BY_CHAT.set(String(chatId), entry);
  }
}

const COMPILED: Array<{ entry: SourceGroupEntry; re: RegExp }> = ENTRIES.filter(
  (e) => e.match && e.match.trim(),
).map((entry) => ({
  entry,
  re: new RegExp(entry.match!, "i"),
}));

function toHit(entry: SourceGroupEntry): SourceGroupLocationHit {
  return {
    city: entry.scope === "county" ? null : entry.city,
    region: entry.region,
    countyGeoid: entry.county_geoid,
    stateCode: entry.state_code,
    hubId: entry.hub_id,
    scope: entry.scope,
    catalogId: entry.id,
  };
}

/** Resolve location from chat id and/or group title / source key. */
export function resolveFromSourceGroupCatalog(
  ...parts: Array<string | null | undefined>
): SourceGroupLocationHit | null {
  for (const part of parts) {
    const id = String(part ?? "").trim();
    if (!id) continue;
    const byChat = BY_CHAT.get(id);
    if (byChat) return toHit(byChat);
  }

  const blob = parts.filter(Boolean).join(" ").trim();
  if (!blob) return null;
  for (const { entry, re } of COMPILED) {
    if (re.test(blob)) return toHit(entry);
  }
  return null;
}

export function listSourceGroupCatalog(): readonly SourceGroupEntry[] {
  return ENTRIES;
}
