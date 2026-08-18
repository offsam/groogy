/**
 * Public catalog URLs stay Latin/English — never Cyrillic in the address bar.
 * Person names are transliterated; common catalog words map to English.
 */

const CYR_MAP: Record<string, string> = {
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

/** Frequent catalog tokens → English. Unknown tokens are transliterated. */
const RU_SLUG_WORDS: Record<string, string> = {
  адвокат: "attorney",
  авто: "auto",
  апостиль: "apostille",
  ателье: "atelier",
  булочная: "bakery",
  бутик: "boutique",
  врач: "doctor",
  грузовик: "truck",
  доверенность: "power-of-attorney",
  иммиграционный: "immigration",
  иммиграционныи: "immigration",
  иммиграция: "immigration",
  кафе: "cafe",
  клиника: "clinic",
  консультант: "consultant",
  лос: "los",
  анджелес: "angeles",
  анджелесе: "angeles",
  магазин: "store",
  мастер: "specialist",
  нотариус: "notary",
  нотариальные: "notary",
  няня: "nanny",
  парикмахер: "hairdresser",
  перевод: "translation",
  переводчик: "translator",
  переводчика: "translator",
  переводы: "translations",
  пекарня: "bakery",
  репетитор: "tutor",
  ресторан: "restaurant",
  риелтор: "realtor",
  ремонт: "repair",
  салон: "salon",
  специалист: "specialist",
  стоматолог: "dentist",
  студия: "studio",
  услуги: "services",
  услуга: "service",
  цветы: "flowers",
  юрист: "lawyer",
};

const GENERIC_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "yelp.com",
  "google.com",
  "maps.google.com",
  "goo.gl",
  "bit.ly",
  "linktr.ee",
  "t.me",
  "telegram.me",
  "wa.me",
  "wixsite.com",
  "squarespace.com",
  "wordpress.com",
  "blogspot.com",
  "sites.google.com",
  "linktree.com",
  // Directories we import from — never a card's public slug.
  "svoi.us",
  "russianorangepages.com",
  "bostonrussianpages.com",
  "to4ka.us",
  "api.to4ka.us",
  "echoru.com",
  "zerkalomn.com",
  "ruspagesusa.com",
  "slavicseattle.com",
  "ourtx.com",
  "russianseattle.com",
  "yellowpages.com",
  "kroogy.com",
]);

const GENERIC_HOST_LABELS = new Set([
  "www",
  "m",
  "web",
  "sites",
  "home",
  "linktr",
  "instagram",
  "facebook",
  "yelp",
  "google",
  "maps",
  "t",
  "wa",
  "svoi",
  "to4ka",
  "echoru",
  "zerkalo",
  "ruspagesusa",
  "kroogy",
  "krugi",
]);

/** Leading tokens that are import sources, not the business name. */
const DIRECTORY_SLUG_PREFIX_RE =
  /^(?:svoi|rop|to4ka|echoru|zerkalo|zerkalomn|ruspagesusa|ruspages|kroogy|krugi|orange-pages|yellow-pages|boston-pages|russian-seattle|slavic-seattle|our-texas)-/i;

const DIRECTORY_SLUG_EXACT = new Set([
  "svoi",
  "rop",
  "to4ka",
  "echoru",
  "zerkalo",
  "zerkalomn",
  "ruspages",
  "ruspagesusa",
  "kroogy",
  "krugi",
  "orange-pages",
  "yellow-pages",
]);

export function hasCyrillic(value: string | null | undefined): boolean {
  return /[а-яё]/i.test(String(value || ""));
}

export function transliterateCyrillic(raw: string): string {
  let out = "";
  for (const ch of raw.toLowerCase()) {
    if (CYR_MAP[ch] != null) {
      out += CYR_MAP[ch];
      continue;
    }
    out += ch;
  }
  return out;
}

function translateSlugToken(token: string): string {
  const lower = token.toLowerCase();
  if (RU_SLUG_WORDS[lower]) return RU_SLUG_WORDS[lower];
  const latin = transliterateCyrillic(lower);
  return RU_SLUG_WORDS[latin] || latin;
}

/** Drop leading import-source labels (svoi, to4ka, …) from a public slug. */
export function stripDirectorySlugNoise(slug: string): string {
  let s = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  while (s && DIRECTORY_SLUG_PREFIX_RE.test(s)) {
    s = s.replace(DIRECTORY_SLUG_PREFIX_RE, "").replace(/^-+|-+$/g, "");
  }
  if (!s || DIRECTORY_SLUG_EXACT.has(s)) return "";
  return s;
}

/** True when a live slug still carries a directory/source prefix. */
export function slugHasSourceNoise(slug: string | null | undefined): boolean {
  const current = String(slug || "")
    .trim()
    .toLowerCase();
  if (!current) return false;
  return stripDirectorySlugNoise(current) !== current;
}

export type AsciiSlugOptions = {
  maxLength?: number;
  fallback?: string;
};

/** Latin slug from any name / existing slug. Never emits Cyrillic. */
export function asciiSlug(
  raw: string | null | undefined,
  options?: AsciiSlugOptions,
): string {
  const maxLength = options?.maxLength ?? 72;
  const fallback = options?.fallback ?? "card";
  const source = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`´]/g, "");
  const tokens = source
    .split(/[^\p{L}\p{N}]+/gu)
    .map((t) => translateSlugToken(t))
    .map((t) => t.replace(/[^a-z0-9]+/g, "-"))
    .filter(Boolean);
  const joined = tokens
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cleaned = stripDirectorySlugNoise(joined)
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return cleaned || fallback;
}

export function slugFromWebsiteHost(
  website: string | null | undefined,
): string | null {
  const raw = String(website || "").trim();
  if (!raw) return null;
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || GENERIC_HOSTS.has(host)) return null;
    const parts = host.split(".").filter(Boolean);
    if (parts.length < 2) return null;
    const label = parts[0] ?? "";
    if (GENERIC_HOST_LABELS.has(label) || label.length < 4) return null;
    if (/^\d+$/.test(label)) return null;
    const slug = asciiSlug(label, { maxLength: 48, fallback: "" });
    return slug.length >= 4 ? slug : null;
  } catch {
    return null;
  }
}

export function catalogCardSlug(input: {
  name?: string | null;
  currentSlug?: string | null;
  website?: string | null;
  fallback?: string;
  maxLength?: number;
}): string {
  const fallback = input.fallback ?? "card";
  const maxLength = input.maxLength ?? 72;
  const fromHost = slugFromWebsiteHost(input.website);
  if (fromHost) return fromHost.slice(0, maxLength);
  const fromName = asciiSlug(input.name, { maxLength, fallback: "" });
  if (fromName) return fromName;
  const fromSlug = asciiSlug(input.currentSlug, { maxLength, fallback: "" });
  return fromSlug || fallback;
}

export function nextAvailableSlug(
  desired: string,
  taken: Set<string>,
  keep?: string | null,
): string {
  const base = asciiSlug(desired, { fallback: "card" });
  if (keep && base === keep) return keep;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 80; n += 1) {
    const candidate = `${base}-${n}`;
    if (keep && candidate === keep) return keep;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}
