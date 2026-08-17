import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractEmailsFromText,
  extractInstagramFromText,
  extractPhonesFromText,
  extractWebsitesFromText,
} from "@/lib/admin/paste-enrich";
import { pythonSpawnEnv, resolvePythonBin } from "@/lib/admin/resolve-python";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { EnrichResourceState } from "@/lib/import-review/enrich-progress";
import { cleanAdminStreetAddress } from "@/lib/geo/geocode-street";

const FREE_EMAIL_HOSTS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "mail.ru",
  "yandex.ru",
  "yandex.com",
  "bk.ru",
  "list.ru",
  "inbox.ru",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "msn.com",
]);

/** Directory / gov / social noise that should not become the card website. */
const JUNK_WEBSITE_HOSTS = new Set([
  "t.me",
  "telegram.me",
  "instagram.com",
  "facebook.com",
  "fb.com",
  "yelp.com",
  "wa.me",
  "whatsapp.com",
  "linktr.ee",
  "bit.ly",
  "egov.uscis.gov",
  "my.uscis.gov",
  "first.uscis.gov",
  "uscis.gov",
  "acis.eoir.justice.gov",
  "ereg.eoir.justice.gov",
  "justice.gov",
  "locator.ice.gov",
  "ice.gov",
  "cbp.gov",
  "www.cbp.gov",
  "www.ice.gov",
]);

export type RecommendationEnrichPatch = {
  phones?: string[];
  instagram?: string[];
  websites?: string[];
  notes?: string;
  city?: string;
  cover_image_url?: string;
  address_line?: string;
  request_snippets?: string[];
  state_code?: string;
  latitude?: number;
  longitude?: number;
};

export type RecommendationEnrichResult = {
  patch: RecommendationEnrichPatch;
  filled: string[];
  discovered: {
    website: string | null;
    email: string | null;
  };
  resources: EnrichResourceState[];
};

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

function setNoteField(
  notes: string | null | undefined,
  key: string,
  value: string,
): string {
  const parts = (notes || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !p.toLowerCase().startsWith(`${key.toLowerCase()}:`));
  parts.push(`${key}: ${value}`);
  return parts.join("; ");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isJunkWebsite(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (JUNK_WEBSITE_HOSTS.has(host)) return true;
  if (host.endsWith(".gov") || host.endsWith(".mil")) return true;
  return false;
}

function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let v = raw.trim();
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function websiteFromEmail(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;
  if (FREE_EMAIL_HOSTS.has(domain)) return null;
  if (JUNK_WEBSITE_HOSTS.has(domain)) return null;
  return `https://${domain}`;
}

/** «Avagyan Law» → avagyanlaw.com candidates. */
function websiteCandidatesFromName(name: string | null | undefined): string[] {
  const compact = (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  if (compact.length < 5 || compact.length > 40) return [];
  return [`https://${compact}.com`, `https://www.${compact}.com`];
}

function mergeUnique(existing: string[], next: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...existing, ...next]) {
    const t = String(raw || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function preferUsefulWebsites(urls: string[]): string[] {
  const good: string[] = [];
  const junk: string[] = [];
  for (const u of urls) {
    if (isJunkWebsite(u)) junk.push(u);
    else good.push(u);
  }
  return [...good, ...junk];
}

function hasUsefulWebsite(urls: string[]): boolean {
  return urls.some((u) => !isJunkWebsite(u));
}

async function probeWebsite(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "KrugiRecommendationEnrich/1.0 (+https://krugi.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.includes("html") && !ct.includes("text")) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function textBlob(item: CommentRecommendation): string {
  return [
    item.display_name,
    item.notes,
    item.city,
    item.category_guess,
    ...(item.request_snippets || []),
    ...(item.comment_texts || []),
  ]
    .filter(Boolean)
    .join("\n");
}

function parseCityState(cityRaw: string | null | undefined): {
  city: string | null;
  stateHint: string | null;
} {
  const raw = (cityRaw || "").trim();
  if (!raw) return { city: null, stateHint: null };
  const m = raw.match(
    /^(.+?)\s*,\s*(CA|California|NY|FL|TX|AZ|OR|WA|NV|IL|NJ)\s*$/i,
  );
  if (m) {
    return { city: m[1].trim(), stateHint: m[2].toUpperCase() };
  }
  return { city: raw, stateHint: null };
}

type WebsiteProfileJson = {
  status?: string;
  url?: string;
  error?: string;
  name?: string | null;
  description?: string | null;
  logo?: string | null;
  phone?: string | string[] | null;
  email?: string | string[] | null;
  address?: string | null;
  social_links?: string[] | null;
};

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function igFromSocial(links: string[]): string[] {
  const out: string[] = [];
  for (const link of links) {
    const m = link.match(
      /(?:instagram\.com\/)([A-Za-z0-9._]+)/i,
    );
    if (m?.[1] && !/^(p|reel|stories|explore)$/i.test(m[1])) {
      out.push(m[1].toLowerCase());
    }
  }
  return out;
}

/** Homepage scrape via shared Python web_enrichment (same as published). */
async function fetchWebsiteProfile(
  url: string,
): Promise<{ profile: WebsiteProfileJson | null; error: string | null }> {
  const root = process.cwd();
  const script = path.join(
    root,
    "scripts",
    "import-review",
    "fetch_website_profile.py",
  );
  const python = resolvePythonBin(root);

  return new Promise((resolve) => {
    const child = spawn(python, [script, "--url", url], {
      cwd: root,
      env: pythonSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ profile: null, error: "timeout" });
    }, 25_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ profile: null, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          profile: null,
          error: stderr.trim().slice(0, 200) || `exit ${code}`,
        });
        return;
      }
      try {
        const profile = JSON.parse(stdout.trim()) as WebsiteProfileJson;
        resolve({ profile, error: null });
      } catch {
        resolve({ profile: null, error: "bad_json" });
      }
    });
  });
}

/**
 * Fill-empty enrich for a recommendation queue card.
 * Mines texts, discovers website from email/name when missing, then crawls
 * the card website (same homepage extract as published enrich) for photo /
 * email / IG / description gaps.
 */
export async function buildRecommendationEnrichPatch(
  item: CommentRecommendation,
): Promise<RecommendationEnrichResult> {
  const blob = textBlob(item);
  const patch: RecommendationEnrichPatch = {};
  let notes = item.notes;
  const filled: string[] = [];
  const resources: EnrichResourceState[] = [];

  const phones = mergeUnique(
    item.phones || [],
    extractPhonesFromText(blob).map((p) =>
      p.startsWith("+") ? p : `+${p.replace(/\D/g, "")}`,
    ),
  );
  if (phones.length > (item.phones || []).length) {
    patch.phones = phones;
    filled.push("телефоны");
  }

  const ig = mergeUnique(
    (item.instagram || []).map((h) => h.replace(/^@/, "").toLowerCase()),
    extractInstagramFromText(blob).map((h) => h.replace(/^@/, "").toLowerCase()),
  );
  if (ig.length > (item.instagram || []).length) {
    patch.instagram = ig;
    filled.push("instagram");
  }

  const emailsFromText = extractEmailsFromText(blob);
  const emailsFromNotes = (noteField(notes, "emails") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let emails = mergeUnique(
    emailsFromNotes,
    emailsFromText.map((e) => e.toLowerCase()),
  );
  if (emails.length > emailsFromNotes.length) {
    notes = setNoteField(notes, "emails", emails.join(", "));
    patch.notes = notes;
    filled.push("email");
  }

  let websites = mergeUnique(
    item.websites || [],
    extractWebsitesFromText(blob),
  );

  let discoveredWebsite: string | null = null;
  if (!hasUsefulWebsite(websites)) {
    const candidates: string[] = [];
    for (const email of emails) {
      const fromEmail = websiteFromEmail(email);
      if (fromEmail) candidates.push(fromEmail);
    }
    candidates.push(...websiteCandidatesFromName(item.display_name));
    for (const cand of candidates) {
      const normalized = normalizeWebsite(cand);
      if (!normalized || isJunkWebsite(normalized)) continue;
      // eslint-disable-next-line no-await-in-loop -- sequential probe
      if (await probeWebsite(normalized)) {
        discoveredWebsite = normalized;
        break;
      }
    }
    if (discoveredWebsite) {
      websites = mergeUnique([discoveredWebsite], websites);
    }
  }

  websites = preferUsefulWebsites(websites);
  if (
    websites.join("\n").toLowerCase() !==
    (item.websites || []).join("\n").toLowerCase()
  ) {
    patch.websites = websites.slice(0, 20);
    if (discoveredWebsite || hasUsefulWebsite(websites)) {
      if (!filled.includes("сайт")) filled.push("сайт");
    }
  }

  const { city } = parseCityState(item.city);
  if (city && city !== item.city?.trim()) {
    patch.city = city;
    filled.push("город");
  }

  const address = noteField(notes, "address");
  if (address && !item.address_line?.trim()) {
    patch.address_line = address.slice(0, 200);
    filled.push("адрес");
  }

  const crawlUrl =
    normalizeWebsite(
      websites.find((w) => !isJunkWebsite(w)) || discoveredWebsite || null,
    ) || null;

  if (crawlUrl) {
    const { profile, error } = await fetchWebsiteProfile(crawlUrl);
    if (!profile || profile.status === "unavailable" || error) {
      resources.push({
        url: crawlUrl,
        kind: "website",
        status: "done",
        outcome: "error",
        error: error || profile?.error || "unavailable",
      });
    } else {
      const siteFields: string[] = [];
      const logo = (profile.logo || "").trim();
      if (logo && !item.cover_image_url?.trim()) {
        patch.cover_image_url = logo;
        filled.push("фото");
        siteFields.push("фото");
      }

      const sitePhones = asStringList(profile.phone).map((p) =>
        p.startsWith("+") ? p : `+${p.replace(/\D/g, "")}`,
      );
      const nextPhones = mergeUnique(patch.phones || item.phones || [], sitePhones);
      if (nextPhones.length > (item.phones || []).length) {
        patch.phones = nextPhones;
        if (!filled.includes("телефоны")) filled.push("телефоны");
        siteFields.push("телефоны");
      }

      const siteEmails = asStringList(profile.email).map((e) => e.toLowerCase());
      const nextEmails = mergeUnique(emails, siteEmails);
      if (nextEmails.length > emails.length) {
        emails = nextEmails;
        notes = setNoteField(notes, "emails", emails.join(", "));
        patch.notes = notes;
        if (!filled.includes("email")) filled.push("email");
        siteFields.push("email");
      }

      const siteIg = igFromSocial(profile.social_links || []);
      const nextIg = mergeUnique(patch.instagram || item.instagram || [], siteIg);
      if (nextIg.length > (item.instagram || []).length) {
        patch.instagram = nextIg;
        if (!filled.includes("instagram")) filled.push("instagram");
        siteFields.push("instagram");
      }

      const siteDesc = (profile.description || "").trim();
      const existingDesc = [
        ...(item.request_snippets || []),
        ...(item.comment_texts || []),
      ]
        .map((s) => s.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] || "";
      if (siteDesc.length >= 80 && siteDesc.length > existingDesc.length + 40) {
        patch.request_snippets = [
          siteDesc.slice(0, 1200),
          ...(item.request_snippets || []).filter(
            (s) => s.trim() && s.trim() !== siteDesc.trim(),
          ),
        ].slice(0, 5);
        if (!filled.includes("описание")) filled.push("описание");
        siteFields.push("описание");
      }

      if (profile.address?.trim() && !item.address_line?.trim() && !patch.address_line) {
        patch.address_line = profile.address.trim().slice(0, 200);
        if (!filled.includes("адрес")) filled.push("адрес");
        siteFields.push("адрес");
      }

      resources.push({
        url: crawlUrl,
        kind: "website",
        status: "done",
        outcome: siteFields.length ? "ok" : "empty",
        fields: siteFields,
      });
    }
  }

  // Scrub + peel + geocode — recommendations have lat/lng columns.
  {
    const notesAddr = noteField(item.notes, "address");
    const notesRegion = noteField(item.notes, "region");
    const notesZip =
      noteField(item.notes, "zip") ||
      noteField(item.notes, "postal") ||
      noteField(item.notes, "postal_code");
    const street =
      (typeof patch.address_line === "string"
        ? patch.address_line
        : item.address_line) ||
      notesAddr ||
      null;
    if (street?.trim()) {
      const cleaned = await cleanAdminStreetAddress(
        {
          addressLine: street,
          city:
            (typeof patch.city === "string" ? patch.city : item.city) || null,
          stateCode:
            (typeof patch.state_code === "string" ? patch.state_code : null) ||
            item.state_code ||
            notesRegion ||
            null,
          postalCode: notesZip,
        },
        { withGeo: true },
      );
      if (cleaned.changed || cleaned.latitude != null) {
        if (cleaned.addressLine) {
          patch.address_line = cleaned.addressLine;
          if (!filled.includes("адрес")) filled.push("адрес");
        }
        if (cleaned.city) patch.city = cleaned.city;
        if (cleaned.stateCode) patch.state_code = cleaned.stateCode;
        if (cleaned.postalCode) {
          // ZIP lives in notes for some directory rows.
          const nextNotes = setNoteField(
            typeof patch.notes === "string" ? patch.notes : item.notes,
            "zip",
            cleaned.postalCode,
          );
          if (nextNotes) patch.notes = nextNotes;
        }
        if (cleaned.latitude != null && cleaned.longitude != null) {
          patch.latitude = cleaned.latitude;
          patch.longitude = cleaned.longitude;
          if (!filled.includes("карта")) filled.push("карта");
        }
      }
    }
  }

  return {
    patch,
    filled,
    discovered: {
      website: discoveredWebsite || crawlUrl,
      email: emails[0] ?? null,
    },
    resources,
  };
}

/**
 * After queue enrich (Python crawl): peel crooked street dumps + geocode.
 * Same address cleanup as buildRecommendationEnrichPatch — without re-crawling.
 */
export async function peelRecommendationQueueAddress(
  supabase: SupabaseClient,
  recommendationId: string,
): Promise<string[]> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from("import_comment_recommendations")
    .select("id, address_line, city, state_code, notes, latitude, longitude")
    .eq("id", recommendationId)
    .maybeSingle();
  if (error || !data) return [];

  const row = data as {
    address_line?: string | null;
    city?: string | null;
    state_code?: string | null;
    notes?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  const notes = row.notes ?? null;
  const street =
    row.address_line?.trim() || noteField(notes, "address") || null;
  if (!street) return [];

  const cleaned = await cleanAdminStreetAddress(
    {
      addressLine: street,
      city: row.city ?? null,
      stateCode: row.state_code || noteField(notes, "region"),
      postalCode:
        noteField(notes, "zip") ||
        noteField(notes, "postal") ||
        noteField(notes, "postal_code"),
    },
    { withGeo: true },
  );

  const missingGeo =
    row.latitude == null ||
    row.longitude == null ||
    !Number.isFinite(Number(row.latitude)) ||
    !Number.isFinite(Number(row.longitude));
  if (!cleaned.changed && !(missingGeo && cleaned.latitude != null)) {
    return [];
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const found: string[] = [];
  if (cleaned.addressLine) {
    patch.address_line = cleaned.addressLine;
    found.push("address_line");
  }
  if (cleaned.city) {
    patch.city = cleaned.city;
    found.push("city");
  }
  if (cleaned.stateCode) {
    patch.state_code = cleaned.stateCode;
    found.push("state_code");
  }
  if (cleaned.postalCode) {
    patch.notes = setNoteField(notes, "zip", cleaned.postalCode);
    found.push("postal_code");
  }
  if (cleaned.latitude != null && cleaned.longitude != null) {
    patch.latitude = cleaned.latitude;
    patch.longitude = cleaned.longitude;
    found.push("geo");
  }
  if (found.length === 0) return [];

  const { error: updError } = await (supabase as unknown as SupabaseClient)
    .from("import_comment_recommendations")
    .update(patch)
    .eq("id", recommendationId);
  if (updError) return [];
  return found;
}
