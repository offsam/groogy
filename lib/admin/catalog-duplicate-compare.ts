/**
 * Pure catalog duplicate compare — used by full-list scan with progress.
 * Keeps signal rules aligned with published-duplicates-scan.ts.
 */

import { repeatedBrandFromText } from "@/lib/import-review/display-name";
import {
  citiesConflict,
  phoneDigits,
  websiteHost,
} from "@/lib/import-review/recommendation-duplicate";
import { isSharedNonIdentityHost } from "@/lib/import-review/shared-hosts";
import type {
  LiveDuplicateHit,
  LiveEntityKind,
} from "@/lib/admin/published-duplicates-scan";
import { preferKeepSelfByFill } from "@/lib/admin/catalog-merge-keep";

export const BIZ_PRO_FILL_KEYS = [
  "phone",
  "website",
  "email",
  "instagram_url",
  "telegram_url",
  "description",
  "short_description",
  "image_url",
  "private_address_line",
  "address_line",
  "city",
] as const;

export { preferKeepSelfByFill };

export const PRO_SCAN_SELECT =
  "id, slug, display_name, phone, website, email, instagram_url, telegram_url, source_url, description, short_description, image_url, private_address_line, city, status";

export const BIZ_SCAN_SELECT =
  "id, slug, name, phone, website, email, instagram_url, telegram_url, source_url, description, short_description, image_url, address_line, city, status";

export function catalogSelectFor(
  entityType: "professional" | "business",
): string {
  return entityType === "professional" ? PRO_SCAN_SELECT : BIZ_SCAN_SELECT;
}

export function publicHrefFor(
  kind: LiveEntityKind,
  id: string,
  slug: string | null | undefined,
): string | null {
  if (kind === "professional" && slug) return `/professional/${slug}`;
  if (kind === "business" && slug) return `/business/${slug}`;
  if (kind === "event" && slug) return `/events/${slug}`;
  if (kind === "job" && slug) return `/jobs/${slug}`;
  if (kind === "service") return `/services/${id}`;
  if (kind === "transfer") return `/transfers/${id}`;
  if (kind === "marketplace") return `/marketplace/${id}`;
  if (kind === "lechu") return `/lechu/${id}`;
  return null;
}

export function nonemptyCount(
  row: Record<string, unknown>,
  keys: readonly string[],
): number {
  let n = 0;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) n += 1;
  }
  return n;
}

export function normName(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 80);
}

export function normUrl(raw: string | null | undefined): string {
  return (raw || "").trim().replace(/\/+$/, "").toLowerCase();
}

export function emailNorm(raw: string | null | undefined): string | null {
  const e = (raw || "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.length < 5) return null;
  return e;
}

export function instagramHandle(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  try {
    if (/instagram\.com/i.test(t)) {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      const handle = u.pathname.split("/").filter(Boolean)[0] || "";
      return handle.replace(/^@/, "").toLowerCase() || null;
    }
  } catch {
    /* plain handle */
  }
  const handle = t.replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
  if (!/^[a-z0-9._]{2,30}$/.test(handle)) return null;
  if (["p", "reel", "reels", "stories", "explore"].includes(handle)) return null;
  return handle;
}

export function telegramKey(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  try {
    if (/t\.me|telegram\./i.test(t)) {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      const part = u.pathname.split("/").filter(Boolean)[0] || "";
      return part.replace(/^@/, "").toLowerCase() || null;
    }
  } catch {
    /* plain */
  }
  const handle = t.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,32}$/.test(handle) ? handle : null;
}

export function addressKey(raw: string | null | undefined): string | null {
  const t = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (t.length < 8) return null;
  const m = t.match(
    /(\d{1,6})\s+([a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,4})\s+(?:ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway)\b/,
  );
  if (!m) return null;
  const zip = t.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? "";
  return `${m[1]}${m[2].replace(/[^a-z0-9]+/g, "")}${zip}`;
}

export function identityNamesFromCard(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const title = String(row.display_name || row.name || row.title || "").trim();
  if (title) out.push(title);
  const blob = [row.description, row.short_description]
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .join("\n");
  const brand = repeatedBrandFromText(blob);
  if (brand) out.push(brand);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of out) {
    const key = normName(name);
    if (key.length < 4 || seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

export type SelfScanSignals = {
  selfId: string;
  selfKind: "business" | "professional";
  selfName: string;
  selfFill: number;
  phone: string;
  email: string | null;
  ig: string | null;
  tg: string | null;
  source: string;
  host: string | null;
  addressKeys: Set<string>;
  nameKeys: Set<string>;
  identityNames: string[];
  /** Normalized description blob for equality checks. */
  descKey: string;
  /** Raw city text — gates name-only weak matches against distant cities. */
  city: string | null;
};

/** Identity slots used for overlap % (biz/pro). */
export const BIZ_PRO_MATCH_SLOTS = 9;

export function buildBizProSelfSignals(
  self: Record<string, unknown>,
  selfKind: "business" | "professional",
  extraAddressKeys?: Iterable<string>,
): SelfScanSignals {
  const selfId = String(self.id);
  const selfName = String(
    (self.display_name as string) || (self.name as string) || self.slug || "—",
  );
  const rawHost = websiteHost(self.website as string | null);
  const host = isSharedNonIdentityHost(rawHost) ? null : rawHost;
  const addr = addressKey(
    (self.address_line as string) ||
      (self.private_address_line as string) ||
      "",
  );
  const addressKeys = new Set<string>();
  if (addr) addressKeys.add(addr);
  if (extraAddressKeys) {
    for (const k of extraAddressKeys) if (k) addressKeys.add(k);
  }
  const identityNames = identityNamesFromCard(self);
  const descKey = normName(
    [self.description, self.short_description]
      .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      .join("\n"),
  );
  return {
    selfId,
    selfKind,
    selfName,
    selfFill: nonemptyCount(self, BIZ_PRO_FILL_KEYS),
    phone: phoneDigits((self.phone as string | null) || ""),
    email: emailNorm(self.email as string | null),
    ig: instagramHandle(self.instagram_url as string | null),
    tg: telegramKey(self.telegram_url as string | null),
    source: normUrl(self.source_url as string | null),
    host,
    addressKeys,
    nameKeys: new Set(identityNames.map(normName)),
    identityNames,
    descKey: descKey.length >= 40 ? descKey : "",
    city: (self.city as string | null) ?? null,
  };
}

function strengthRank(s: "exact" | "weak"): number {
  return s === "exact" ? 2 : 1;
}

/**
 * Compare one candidate row to self. Returns strongest match or null.
 * Collects ALL overlapping identity params for ranking (matchCount).
 */
export function compareBizProCandidate(
  signals: SelfScanSignals,
  candidate: Record<string, unknown>,
  candidateKind: "business" | "professional",
): LiveDuplicateHit | null {
  const id = String(candidate.id || "");
  if (!id || id === signals.selfId) return null;
  if ((candidate.status as string) === "archived") return null;

  const matched: Array<{ strength: "exact" | "weak"; param: string; reason: string }> =
    [];

  const consider = (
    strength: "exact" | "weak",
    param: string,
    reason: string,
  ) => {
    matched.push({ strength, param, reason });
  };

  const candPhone = phoneDigits((candidate.phone as string | null) || "");
  if (
    signals.phone.length >= 10 &&
    candPhone.length >= 10 &&
    candPhone === signals.phone
  ) {
    consider("exact", "phone", `phone:${signals.phone}`);
  }

  const candHost = websiteHost(candidate.website as string | null);
  if (
    signals.host &&
    candHost &&
    !isSharedNonIdentityHost(candHost) &&
    candHost === signals.host
  ) {
    consider("exact", "website", `website:${signals.host}`);
  }

  const candEmail = emailNorm(candidate.email as string | null);
  if (signals.email && candEmail && candEmail === signals.email) {
    consider("exact", "email", `email:${signals.email}`);
  }

  const candIg = instagramHandle(candidate.instagram_url as string | null);
  if (signals.ig && candIg && candIg === signals.ig) {
    consider("exact", "instagram", `instagram:@${signals.ig}`);
  }

  const candTg = telegramKey(candidate.telegram_url as string | null);
  if (signals.tg && candTg && candTg === signals.tg) {
    consider("exact", "telegram", `telegram:@${signals.tg}`);
  }

  const candSource = normUrl(candidate.source_url as string | null);
  if (signals.source && candSource && candSource === signals.source) {
    consider("exact", "source", `source_url:${signals.source}`);
  }

  if (signals.addressKeys.size > 0) {
    const candAddr = addressKey(
      String(
        candidate.address_line || candidate.private_address_line || "",
      ),
    );
    if (candAddr && signals.addressKeys.has(candAddr)) {
      consider("exact", "address", `address:${candAddr}`);
    }
  }

  // Common Russian first names/surnames repeat across every diaspora metro —
  // a name-only match against a card in a clearly different city is almost
  // always a coincidence, not a duplicate. Only gates the weak, name-derived
  // signals below; exact contact/address/description matches are unaffected.
  const candCityConflicts = citiesConflict(
    signals.city,
    (candidate.city as string | null) ?? null,
  );

  const candTitle = String(
    candidate.display_name || candidate.name || "",
  ).trim();
  const candTitleKey = normName(candTitle);
  let nameHit = false;
  let descNameHit = false;
  for (const display of signals.identityNames) {
    const key = normName(display);
    if (key.length < 4) continue;
    if (!nameHit && candTitleKey === key) {
      const strength = display === signals.selfName ? "weak" : "exact";
      if (strength === "weak" && candCityConflicts) {
        // Skip: name-only match, different cities — no other signal.
      } else {
        nameHit = true;
        consider(strength, "name", `name:${display}`);
      }
    }
    const blob = String(candidate.description || "");
    const blobKey = normName(blob);
    if (
      !descNameHit &&
      key.length >= 4 &&
      blobKey.includes(key) &&
      candTitleKey !== key &&
      !candCityConflicts
    ) {
      descNameHit = true;
      consider("weak", "description", `description:${display}`);
    }
  }

  if (signals.descKey) {
    const candDesc = normName(
      [candidate.description, candidate.short_description]
        .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
        .join("\n"),
    );
    if (candDesc.length >= 40 && candDesc === signals.descKey) {
      consider("exact", "description", "description:same");
    }
  }

  if (matched.length === 0) return null;

  const params = [...new Set(matched.map((m) => m.param))];
  const hasExact = matched.some((m) => m.strength === "exact");
  const bestReason = matched.sort(
    (a, b) => strengthRank(b.strength) - strengthRank(a.strength),
  )[0]!.reason;
  const fill = nonemptyCount(candidate, BIZ_PRO_FILL_KEYS);
  const name = String(
    (candidate.display_name as string) ||
      (candidate.name as string) ||
      candidate.slug ||
      "—",
  );
  const slug = (candidate.slug as string) || null;
  const keepSelf = preferKeepSelfByFill({
    selfKind: signals.selfKind,
    candidateKind,
    selfFill: signals.selfFill,
    candidateFill: fill,
  });

  return {
    kind: "catalog",
    strength: hasExact ? "exact" : "weak",
    reason: `${params.join("+")} · ${bestReason}`,
    id,
    entityType: candidateKind,
    slug,
    name,
    href: publicHrefFor(candidateKind, id, slug),
    fillScore: fill,
    suggestedKeepId: keepSelf ? signals.selfId : id,
    suggestedDropId: keepSelf ? id : signals.selfId,
    status: (candidate.status as string) || null,
    matchCount: params.length,
    matchParams: params,
  };
}

/** Other entity kinds (event/job/listings) — lighter signals. */
export type OtherSelfSignals = {
  selfId: string;
  selfKind: Exclude<LiveEntityKind, "business" | "professional">;
  selfName: string;
  selfFill: number;
  phone: string;
  source: string;
  nameKey: string;
  fillKeys: string[];
};

export function buildOtherSelfSignals(
  self: Record<string, unknown>,
  selfKind: Exclude<LiveEntityKind, "business" | "professional">,
): OtherSelfSignals {
  const fillKeys =
    selfKind === "event"
      ? [
          "phone",
          "registration_url",
          "source_url",
          "description",
          "city",
          "cover_image_url",
        ]
      : ["source_url", "description", "city"];
  const selfName = String((self.title as string) || self.slug || "—");
  return {
    selfId: String(self.id),
    selfKind,
    selfName,
    selfFill: nonemptyCount(self, fillKeys),
    phone: phoneDigits((self.phone as string | null) || ""),
    source: normUrl(self.source_url as string | null),
    nameKey: normName(selfName),
    fillKeys,
  };
}

export const OTHER_MATCH_SLOTS = 3;

export function compareOtherCandidate(
  signals: OtherSelfSignals,
  candidate: Record<string, unknown>,
): LiveDuplicateHit | null {
  const id = String(candidate.id || "");
  if (!id || id === signals.selfId) return null;
  const status = (candidate.status as string) || "";
  if (status === "archived" || status === "draft") return null;

  const matched: Array<{ strength: "exact" | "weak"; param: string; reason: string }> =
    [];
  const consider = (
    strength: "exact" | "weak",
    param: string,
    reason: string,
  ) => {
    matched.push({ strength, param, reason });
  };

  const candSource = normUrl(candidate.source_url as string | null);
  if (signals.source && candSource && candSource === signals.source) {
    consider("exact", "source", `source_url:${signals.source}`);
  }

  const candPhone = phoneDigits((candidate.phone as string | null) || "");
  if (
    signals.phone.length >= 10 &&
    candPhone.length >= 10 &&
    candPhone === signals.phone
  ) {
    consider("exact", "phone", `phone:${signals.phone}`);
  }

  const candName = normName(String(candidate.title || ""));
  if (
    signals.nameKey.length >= 6 &&
    candName.length >= 6 &&
    candName === signals.nameKey
  ) {
    consider("weak", "name", `name:${signals.selfName}`);
  }

  if (matched.length === 0) return null;

  const params = [...new Set(matched.map((m) => m.param))];
  const hasExact = matched.some((m) => m.strength === "exact");
  const bestReason = matched.sort(
    (a, b) => strengthRank(b.strength) - strengthRank(a.strength),
  )[0]!.reason;
  const fill = nonemptyCount(candidate, signals.fillKeys);
  const name = String((candidate.title as string) || candidate.slug || "—");
  const slug = (candidate.slug as string) || null;
  const keepSelf = signals.selfFill >= fill;

  return {
    kind: "catalog",
    strength: hasExact ? "exact" : "weak",
    reason: `${params.join("+")} · ${bestReason}`,
    id,
    entityType: signals.selfKind,
    slug,
    name,
    href: publicHrefFor(signals.selfKind, id, slug),
    fillScore: fill,
    suggestedKeepId: keepSelf ? signals.selfId : id,
    suggestedDropId: keepSelf ? id : signals.selfId,
    status: status || null,
    matchCount: params.length,
    matchParams: params,
  };
}

export function mergeHitMaps(
  map: Map<string, LiveDuplicateHit>,
  hit: LiveDuplicateHit,
) {
  const key = `${hit.entityType}:${hit.id}`;
  const prev = map.get(key);
  if (prev) {
    const prevCount = prev.matchCount ?? (prev.strength === "exact" ? 1 : 0);
    const nextCount = hit.matchCount ?? (hit.strength === "exact" ? 1 : 0);
    if (nextCount < prevCount) return;
    if (
      nextCount === prevCount &&
      strengthRank(prev.strength) >= strengthRank(hit.strength)
    ) {
      return;
    }
  }
  map.set(key, hit);
}
