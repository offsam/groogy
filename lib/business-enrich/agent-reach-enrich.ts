/**
 * Business enrich via Agent-Reach upstream stack (not Google Places API).
 *
 * Agent-Reach itself is a capability installer; reading/search is done with
 * the same tools its SKILL.md documents:
 *   - search: Exa via `mcporter` when available, else Jina Search `s.jina.ai`
 *   - page read: Jina Reader `r.jina.ai` (same as agent_reach.channels.web)
 *
 * Fill-empty semantics — never invent contacts; parse only from fetched text.
 * Server-only — do not import from client components.
 */

import "server-only";

import type { OpeningHours, OpeningHoursDay } from "@/lib/business/opening-hours";

export type AgentReachBusinessInput = {
  id?: string | null;
  name: string;
  city?: string | null;
  stateCode?: string | null;
  addressLine?: string | null;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  openingHours?: OpeningHours | null;
};

/** Patch shape aligned with `businesses` / queue fill-empty columns. */
export type AgentReachBusinessPatch = {
  phone?: string;
  website?: string;
  email?: string;
  address_line?: string;
  city?: string;
  state_code?: string;
  postal_code?: string;
  opening_hours?: OpeningHours;
  google_maps_url?: string;
  source_note?: string;
};

export type AgentReachEnrichResult = {
  ok: boolean;
  query: string;
  patch: AgentReachBusinessPatch;
  /** Which fields were filled */
  filled: string[];
  sources: Partial<Record<keyof AgentReachBusinessPatch, string>>;
  searchHits: Array<{ title: string; url: string }>;
  error?: string;
};

const JUNK_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "yelp.com",
  "yellowpages.com",
  "maps.google",
  "google.com/maps",
  "google.com/search",
  "google.com/url",
  "googleapis.com",
  "gstatic.com",
  "apple.com/maps",
  "tripadvisor.",
  "wikipedia.org",
  "reddit.com",
  "tiktok.com",
  "linktr.ee",
  "t.me/",
  "wa.me",
  "duckduckgo.com",
];

const PHONE_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const US_ADDR_RE =
  /\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Hwy|Highway|Pkwy|Parkway)\.?(?:\s*,?\s*(?:Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?\b/i;
const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
const CITY_STATE_RE =
  /\b([A-Za-z .'-]{2,40}),\s*(CA|California|NY|TX|FL|WA|AZ|NV|OR|IL|NJ|PA)\b/i;

const DAY_MAP: Record<string, OpeningHoursDay["day"]> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function empty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return !v.trim();
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isJunkUrl(url: string): boolean {
  const low = url.toLowerCase();
  return JUNK_HOSTS.some((h) => low.includes(h));
}

function buildQuery(input: AgentReachBusinessInput): string {
  const parts = [input.name.trim()];
  if (input.city?.trim()) parts.push(input.city.trim());
  if (input.stateCode?.trim()) {
    parts.push(input.stateCode.replace(/^US-/, "").trim());
  } else {
    parts.push("California");
  }
  parts.push("phone address hours");
  return parts.filter(Boolean).join(" ");
}

async function fetchText(url: string, timeoutMs = 25_000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/plain, text/markdown, application/json, */*",
      "User-Agent": "KrugiAgentReachEnrich/1.0 (+https://krugi.app)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  }
  return res.text();
}

/** Jina Reader — same endpoint Agent-Reach WebChannel uses. */
export async function readPageViaJina(url: string): Promise<string> {
  const clean = url.startsWith("http") ? url : `https://${url}`;
  return fetchText(`https://r.jina.ai/${clean}`);
}

type SearchHit = { title: string; url: string };

async function searchViaMcporterExa(query: string): Promise<SearchHit[]> {
  const { spawnSync } = await import("node:child_process");
  const call = `exa.web_search_exa(query: ${JSON.stringify(query)}, numResults: 5)`;
  const r = spawnSync("mcporter", ["call", call], {
    encoding: "utf8",
    timeout: 45_000,
    env: process.env,
  });
  if (r.status !== 0 || !r.stdout?.trim()) return [];
  const text = r.stdout;
  const hits: SearchHit[] = [];
  const urlRe = /https?:\/\/[^\s"'<>]+/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = urlRe.exec(text)) && hits.length < 8) {
    const url = m[0].replace(/[),.]+$/, "");
    if (isJunkUrl(url) || seen.has(url)) continue;
    seen.add(url);
    hits.push({ title: hostOf(url) || url, url });
  }
  return hits;
}

/** Jina Search — zero-config fallback when mcporter/Exa is not installed. */
async function searchViaJina(query: string): Promise<SearchHit[]> {
  const text = await fetchText(
    `https://s.jina.ai/${encodeURIComponent(query)}`,
  );
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  // Typical Jina search lines: [title](url) or Title\nURL
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(text)) && hits.length < 8) {
    const title = m[1]!.trim();
    const url = m[2]!.trim();
    if (isJunkUrl(url) || seen.has(url)) continue;
    seen.add(url);
    hits.push({ title, url });
  }
  if (hits.length === 0) {
    const bare = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
    for (const raw of bare) {
      const url = raw.replace(/[),.]+$/, "");
      if (isJunkUrl(url) || seen.has(url)) continue;
      seen.add(url);
      hits.push({ title: hostOf(url) || url, url });
      if (hits.length >= 8) break;
    }
  }
  return hits;
}

/** DuckDuckGo HTML — last-resort search when Exa/Jina Search unavailable. */
async function searchViaDuckDuckGo(query: string): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`;
  const html = await fetchText(url);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const re =
    /uddg=([^&"]+)|class="result__a"[^>]*href="(https?:\/\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 8) {
    const raw = m[1] || m[2] || "";
    const link = decodeURIComponent(raw);
    if (!link.startsWith("http")) continue;
    if (isJunkUrl(link) || link.includes("duckduckgo.com") || seen.has(link)) {
      continue;
    }
    seen.add(link);
    hits.push({ title: hostOf(link) || link, url: link });
  }
  return hits;
}

export async function searchBusinessWeb(
  query: string,
): Promise<{ hits: SearchHit[]; backend: string }> {
  try {
    const viaExa = await searchViaMcporterExa(query);
    if (viaExa.length > 0) return { hits: viaExa, backend: "mcporter_exa" };
  } catch {
    // fall through
  }
  try {
    const viaJina = await searchViaJina(query);
    if (viaJina.length > 0) return { hits: viaJina, backend: "jina_search" };
  } catch {
    // fall through
  }
  try {
    const viaDdg = await searchViaDuckDuckGo(query);
    if (viaDdg.length > 0) return { hits: viaDdg, backend: "duckduckgo_html" };
  } catch {
    // fall through
  }
  // Last resort: read Google SERP via Jina Reader (Agent-Reach web pattern).
  try {
    const serpUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&num=5`;
    const md = await readPageViaJina(serpUrl);
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    const bare = md.match(/https?:\/\/[^\s"'<>]+/g) || [];
    for (const raw of bare) {
      const url = raw.replace(/[),.]+$/, "");
      if (
        isJunkUrl(url) ||
        url.includes("google.") ||
        url.includes("gstatic.") ||
        seen.has(url)
      ) {
        continue;
      }
      seen.add(url);
      hits.push({ title: hostOf(url) || url, url });
      if (hits.length >= 8) break;
    }
    return { hits, backend: "jina_google_serp" };
  } catch {
    return { hits: [], backend: "none" };
  }
}

function parseHoursBlob(text: string): OpeningHours | null {
  const weekly: OpeningHoursDay[] = [];
  const lineRe =
    /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[a-z]*\s*[:\-–]\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)?)\s*[-–to]+\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)?)/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  while ((m = lineRe.exec(text)) && weekly.length < 7) {
    const dayKey = m[1]!.toLowerCase().slice(0, 3);
    const day =
      DAY_MAP[m[1]!.toLowerCase()] ??
      DAY_MAP[dayKey] ??
      null;
    if (day == null || seen.has(day)) continue;
    seen.add(day);
    weekly.push({
      day,
      open: to24h(m[2]!),
      close: to24h(m[3]!),
    });
  }
  if (weekly.length === 0) return null;
  return { timezone: "America/Los_Angeles", weekly };
}

function to24h(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  const ampm = t.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = ampm[2] || "00";
    const ap = ampm[3];
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}`;
  }
  const plain = t.match(/^(\d{1,2}):(\d{2})$/);
  if (plain) {
    return `${plain[1]!.padStart(2, "0")}:${plain[2]}`;
  }
  const hourOnly = t.match(/^(\d{1,2})$/);
  if (hourOnly) return `${hourOnly[1]!.padStart(2, "0")}:00`;
  return raw.trim();
}

function parseFieldsFromText(text: string): AgentReachBusinessPatch {
  const patch: AgentReachBusinessPatch = {};
  const phones = [...text.matchAll(PHONE_RE)]
    .map((m) => normalizePhone(m[0]!))
    .filter((p): p is string => Boolean(p));
  if (phones[0]) patch.phone = phones[0];

  const emails = [...text.matchAll(EMAIL_RE)].map((m) => m[0]!.toLowerCase());
  if (emails[0] && !emails[0].includes("example.com")) {
    patch.email = emails[0];
  }

  const urls = [...text.matchAll(URL_RE)]
    .map((m) => m[0]!.replace(/[),.]+$/, ""))
    .filter((u) => !isJunkUrl(u) && !u.includes("jina.ai"));
  if (urls[0]) patch.website = urls[0];

  const addr = text.match(US_ADDR_RE);
  if (addr) patch.address_line = addr[0]!.replace(/\s+/g, " ").trim();

  const cityState = text.match(CITY_STATE_RE);
  if (cityState) {
    patch.city = cityState[1]!.trim();
    const st = cityState[2]!.toUpperCase();
    patch.state_code = st === "CALIFORNIA" ? "US-CA" : `US-${st.slice(0, 2)}`;
  }

  const zip = text.match(ZIP_RE);
  if (zip) patch.postal_code = zip[1];

  const hours = parseHoursBlob(text);
  if (hours) patch.opening_hours = hours;

  const maps = text.match(
    /https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.app\.goo\.gl)[^\s"'<>]*/i,
  );
  if (maps) patch.google_maps_url = maps[0]!.replace(/[),.]+$/, "");

  return patch;
}

function mergeFillEmpty(
  input: AgentReachBusinessInput,
  found: AgentReachBusinessPatch,
  source: string,
): {
  patch: AgentReachBusinessPatch;
  filled: string[];
  sources: AgentReachEnrichResult["sources"];
} {
  const patch: AgentReachBusinessPatch = {};
  const filled: string[] = [];
  const sources: AgentReachEnrichResult["sources"] = {};

  const take = <K extends keyof AgentReachBusinessPatch>(
    key: K,
    current: unknown,
  ) => {
    const next = found[key];
    if (next == null || next === "") return;
    if (!empty(current)) return;
    (patch as Record<string, unknown>)[key] = next;
    filled.push(String(key));
    sources[key] = source;
  };

  take("phone", input.phone);
  take("website", input.website);
  take("email", input.email);
  take("address_line", input.addressLine);
  take("city", input.city);
  take("state_code", input.stateCode);
  take("postal_code", null);
  take("opening_hours", input.openingHours);
  take("google_maps_url", null);

  return { patch, filled, sources };
}

/**
 * Search the public web for a business and extract fill-empty contact/location fields.
 * Does not write to the database.
 */
export async function enrichBusinessWithAgentReach(
  input: AgentReachBusinessInput,
): Promise<AgentReachEnrichResult> {
  const name = (input.name || "").trim();
  if (!name) {
    return {
      ok: false,
      query: "",
      patch: {},
      filled: [],
      sources: {},
      searchHits: [],
      error: "missing_name",
    };
  }

  const query = buildQuery(input);
  try {
    const { hits, backend } = await searchBusinessWeb(query);
    if (hits.length === 0) {
      return {
        ok: false,
        query,
        patch: {},
        filled: [],
        sources: {},
        searchHits: [],
        error: "no_search_hits",
      };
    }

    // Prefer official-looking site: name tokens in host, else first non-junk.
    const nameToken = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 4)[0];
    const ranked = [...hits].sort((a, b) => {
      const ah = hostOf(a.url);
      const bh = hostOf(b.url);
      const as = nameToken && ah.includes(nameToken) ? 0 : 1;
      const bs = nameToken && bh.includes(nameToken) ? 0 : 1;
      return as - bs;
    });

    const mergedFound: AgentReachBusinessPatch = {};
    const pagesRead: string[] = [];

    for (const hit of ranked.slice(0, 3)) {
      try {
        const md = await readPageViaJina(hit.url);
        pagesRead.push(hit.url);
        const parsed = parseFieldsFromText(`${hit.title}\n${hit.url}\n${md}`);
        // First successful high-rank page wins empty slots.
        if (!mergedFound.website && !isJunkUrl(hit.url)) {
          mergedFound.website = hit.url.split("?")[0];
        }
        for (const key of Object.keys(parsed) as Array<
          keyof AgentReachBusinessPatch
        >) {
          if (mergedFound[key] == null && parsed[key] != null) {
            (mergedFound as Record<string, unknown>)[key] = parsed[key];
          }
        }
        if (
          mergedFound.phone &&
          mergedFound.address_line &&
          (mergedFound.opening_hours || mergedFound.website)
        ) {
          break;
        }
      } catch {
        continue;
      }
    }

    const { patch, filled, sources } = mergeFillEmpty(
      input,
      mergedFound,
      `agent_reach:${backend}`,
    );
    if (filled.length) {
      patch.source_note = `agent-reach via ${backend}; pages=${pagesRead.length}`;
    }

    return {
      ok: filled.length > 0,
      query,
      patch,
      filled,
      sources,
      searchHits: hits,
    };
  } catch (err) {
    return {
      ok: false,
      query,
      patch: {},
      filled: [],
      sources: {},
      searchHits: [],
      error: err instanceof Error ? err.message : "enrich_failed",
    };
  }
}
