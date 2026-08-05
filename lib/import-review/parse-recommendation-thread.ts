/**
 * Parse a pasted Facebook (or similar) recommendation thread into clusters.
 * Used by admin «Вставить тред» — mirrors scripts/facebook-collector/extract_comment_recommendations.py
 * for FB pages, Maps links, and name-only tips.
 */

export type ParsedRecommendationCluster = {
  cluster_key: string;
  display_name: string | null;
  phones: string[];
  instagram: string[];
  websites: string[];
  mention_count: number;
  third_party_mention_count: number;
  self_ad_mention_count: number;
  comment_texts: string[];
  request_snippets: string[];
  recommender_names: string[];
  category_guess: string | null;
  city: string | null;
};

export type ParseRecommendationThreadResult = {
  requestText: string | null;
  clusters: ParsedRecommendationCluster[];
  skippedNoise: number;
};

const REQUEST_RE =
  /(подскаж|посоветуй|порекоменд|кто\s+знает|кто\s+может|нужен\s+|нужна\s+|ищ[уеи]\s+|recommend|looking\s+for|anyone\s+know|хорош(его|ую|ий|ей)\s+)/i;

const PHONE_RE =
  /(?:\+?1[-.\s]*)?\(?\d{3}\)?[-.\s]*\d{3}[-.\s]*\d{4}|\+\d{10,15}/g;

const URL_RE =
  /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|instagram\.com\/[^\s<>"']+|t\.me\/[^\s<>"']+/gi;

const IG_HANDLE_RE = /(?<!\w)@([A-Za-z0-9._]{3,30})/g;

const FB_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:facebook|fb)\.com\/(?:pages\/[^/\s?]+\/)?([A-Za-z0-9.][A-Za-z0-9._-]{1,80})(?:[/?#]|\s|$)/gi;

const FB_SKIP = new Set([
  "groups",
  "share",
  "story.php",
  "photo",
  "photos",
  "reel",
  "reels",
  "watch",
  "login",
  "marketplace",
  "events",
  "permalink.php",
  "profile.php",
  "people",
  "hashtag",
  "posts",
  "videos",
  "live",
  "stories",
  "home",
  "gaming",
]);

const MAPS_URL_RE =
  /https?:\/\/(?:maps\.app\.goo\.gl\/[A-Za-z0-9_-]+|goo\.gl\/maps\/[A-Za-z0-9_-]+|(?:www\.)?google\.(?:com|[a-z]{2})\/maps\/[^\s<>"']+)/gi;

const NOISE_RE =
  /(какая\s+у\s+вас\s+машин|смешанн\w*\s+брак|лиц\w*\s+славян|такое\s+сочетание\s+невозможно|^reply$|^edited$|^no\s+photo\s+description)/i;

const QUOTED_NAME_RE =
  /[«"“„]\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 .&'-]{1,48})\s*[»"”]/;

const NAME_RECOMMEND_RE =
  /(?:^|\b)(?:рекоменд\w*|советую|только|есть)\s+[«"“]?([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 .&'-]{1,40})[»"”]?/i;

const NAME_BEFORE_RECOMMEND_RE =
  /^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 .&'-]{1,40})\s+рекоменд\w*/i;

const PLACE_DOT_CITY_RE =
  /^([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 .&'-]{1,50})\s*[·•|]\s*([A-Za-zА-Яа-яЁё .'-]{2,40})(?:,|\s|$)/;

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/страхов\w*\s+(случа|оценк)|after\s+accident|auto\s+body|кузовн/i, "авто / страхование"],
  [
    /маляр|покраск\w*\s+авто|автосервис|механик|автомастер|ходов(ая|ой|ую)|collision|garage|подвеск/i,
    "автосервис",
  ],
  [/сантехник|plumber/i, "сантехник"],
  [/хэндимэн|handyman/i, "handyman"],
  [/нян|nanny/i, "няня"],
  [/масс[аa]ж/i, "массаж"],
  [/юрист|адвокат|immigration/i, "юрист"],
  [/бухгалтер|tax\b|нотариус/i, "бухгалтерия / нотариус"],
];

const CITY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Los\s*Angeles|LA\b|Лос[-\s]?Анджелес)/i, "Лос-Анджелес"],
  [/\b(San\s*Francisco|SF\b|Bay\s*Area)/i, "Сан-Франциско"],
  [/\b(Sacramento|Сакраменто)/i, "Сакраменто"],
  [
    /\b(Orange\s*County|Irvine|OC\b|Huntington\s*Beach|Costa\s*Mesa|Garden\s*Grove|Laguna\s*Niguel|Newport\s*Beach|Anaheim|Alhambra)/i,
    "Orange County",
  ],
  [/\b(San\s*Diego|Сан[-\s]?Диего)/i, "Сан-Диего"],
];

function stripInvisible(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\ufe0e\ufe0f\ufeff]/g, "")
    .replace(/[\u0300-\u036f\u0483-\u0489]/g, "");
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function normalizeInstagram(raw: string): string | null {
  const fromUrl = raw.match(/instagram\.com\/([A-Za-z0-9._]{3,30})/i);
  if (fromUrl) {
    const h = fromUrl[1].replace(/\/+$/, "").toLowerCase();
    if (!h || ["reel", "p", "stories", "explore", "accounts"].includes(h)) {
      return null;
    }
    return h;
  }
  const fromAt = raw.match(/^@([A-Za-z0-9._]{3,30})$/);
  if (fromAt) return fromAt[1].toLowerCase();
  return null;
}

function facebookPageSlug(href: string): string | null {
  const low = href.toLowerCase();
  if (!low.includes("facebook.com") && !low.includes("fb.com")) return null;
  FB_URL_RE.lastIndex = 0;
  const m = FB_URL_RE.exec(href);
  if (!m) return null;
  const slug = m[1].replace(/^\.+|\.+$/g, "");
  if (!slug || FB_SKIP.has(slug.toLowerCase())) return null;
  return slug;
}

function mapsToken(href: string): string | null {
  const low = href.toLowerCase();
  if (
    !low.includes("maps.app.goo.gl") &&
    !low.includes("goo.gl/maps") &&
    !low.includes("/maps/")
  ) {
    return null;
  }
  const place = href.match(/google\.(?:com|[a-z]{2})\/maps\/place\/([^/?#]+)/i);
  if (place) {
    try {
      const name = decodeURIComponent(place[1].replace(/\+/g, " ")).trim();
      if (name.length >= 3) return `place:${name.toLowerCase().slice(0, 60)}`;
    } catch {
      /* ignore */
    }
  }
  const short = href.match(
    /(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/([A-Za-z0-9_-]+)/i,
  );
  if (short) return `short:${short[1].toLowerCase()}`;
  return `url:${href.split("?")[0].slice(-24)}`;
}

function cleanDisplayName(raw: string | null | undefined): string | null {
  let name = (raw || "").trim();
  if (!name) return null;
  if (name.length > 80) name = name.slice(0, 80);
  if (/^(lavender|thoughtful|gentle|cheerful|productive)\w*\d+$/i.test(name)) {
    return null;
  }
  if (/^\+?\d[\d\s\-()]{6,}$/.test(name)) return null;
  if (/mibextid|id\s+\d+/i.test(name)) return null;
  if (name.length < 2) return null;
  return name;
}

function guessCategory(text: string): string | null {
  for (const [re, label] of CATEGORY_HINTS) {
    if (re.test(text)) return label;
  }
  return null;
}

function guessCity(text: string): string | null {
  for (const [re, label] of CITY_PATTERNS) {
    if (re.test(text.slice(0, 1200))) return label;
  }
  return null;
}

function guessBusinessName(text: string): string | null {
  const raw = stripInvisible(text).trim();
  if (!raw || NOISE_RE.test(raw)) return null;
  for (const re of [QUOTED_NAME_RE, NAME_BEFORE_RECOMMEND_RE, NAME_RECOMMEND_RE]) {
    const m = raw.match(re);
    if (m) {
      const c = cleanDisplayName(m[1]);
      if (c) return c;
    }
  }
  for (const line of raw.split(/\n+/)) {
    const t = line.trim();
    if (!t || /^(reply|edited|facebook|google\.com)$/i.test(t)) continue;
    const place = t.match(PLACE_DOT_CITY_RE);
    if (place) {
      const c = cleanDisplayName(place[1]);
      if (c) return c;
    }
    if (
      t.length >= 3 &&
      t.length <= 60 &&
      !URL_RE.test(t) &&
      !PHONE_RE.test(t) &&
      /[A-Za-zА-Яа-яЁё]/.test(t) &&
      !NOISE_RE.test(t) &&
      (/\b(collision|garage|auto|llc|inc|center|studio|shop)\b/i.test(t) ||
        /[A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+){0,4}/.test(t))
    ) {
      const words = t.split(/\s+/);
      if (words.length >= 1 && words.length <= 6) {
        const c = cleanDisplayName(t);
        if (c) return c;
      }
    }
  }
  return null;
}

type Contacts = {
  phones: string[];
  instagram: string[];
  websites: string[];
  facebook_pages: string[];
  maps_urls: string[];
  name: string | null;
};

function extractContacts(text: string): Contacts {
  const phones: string[] = [];
  const instagram: string[] = [];
  const websites: string[] = [];
  const facebook_pages: string[] = [];
  const maps_urls: string[] = [];

  for (const raw of text.match(PHONE_RE) || []) {
    const n = normalizePhone(raw);
    if (n && !phones.includes(n)) phones.push(n);
  }

  for (const raw of text.match(MAPS_URL_RE) || []) {
    const href = raw.replace(/[).,;"']+$/, "");
    const clean = href.split("?")[0].slice(0, 300);
    if (!maps_urls.includes(clean)) maps_urls.push(clean);
    if (!websites.includes(clean)) websites.push(clean);
  }

  for (const raw of text.match(URL_RE) || []) {
    const href = (raw.toLowerCase().startsWith("http") ? raw : `https://${raw}`).replace(
      /[).,;"']+$/,
      "",
    );
    const ig = normalizeInstagram(href);
    if (ig && !instagram.includes(ig)) {
      instagram.push(ig);
      continue;
    }
    const low = href.toLowerCase();
    if (low.includes("instagram.com")) continue;
    const fb = facebookPageSlug(href);
    if (fb) {
      if (!facebook_pages.some((x) => x.toLowerCase() === fb.toLowerCase())) {
        facebook_pages.push(fb);
      }
      const cleanFb = `https://www.facebook.com/${fb}`;
      if (!websites.includes(cleanFb)) websites.push(cleanFb);
      continue;
    }
    if (
      low.includes("maps.app.goo.gl") ||
      low.includes("goo.gl/maps") ||
      low.includes("/maps/")
    ) {
      continue;
    }
    if (
      low.includes("t.me/") ||
      low.includes("telegram.me/") ||
      low.includes("wa.me") ||
      low.includes("facebook.com") ||
      low.includes("fb.com") ||
      low.includes("tiktok.com") ||
      low.includes("youtube.com")
    ) {
      continue;
    }
    try {
      const host = new URL(href).hostname.replace(/^www\./, "");
      if (host.includes(".")) {
        const clean = href.split("?")[0].slice(0, 200);
        if (!websites.includes(clean)) websites.push(clean);
      }
    } catch {
      /* ignore */
    }
  }

  for (const m of text.matchAll(IG_HANDLE_RE)) {
    const ig = normalizeInstagram(m[1]);
    if (ig && !instagram.includes(ig)) instagram.push(ig);
  }

  return {
    phones,
    instagram,
    websites,
    facebook_pages,
    maps_urls,
    name: guessBusinessName(text),
  };
}

function clusterKey(c: Contacts): string | null {
  if (c.phones[0]) return `phone:${c.phones[0]}`;
  if (c.instagram[0]) return `ig:${c.instagram[0].toLowerCase()}`;
  if (c.facebook_pages[0]) return `fb:${c.facebook_pages[0].toLowerCase()}`;
  if (c.maps_urls[0]) {
    const tok = mapsToken(c.maps_urls[0]);
    if (tok) return `maps:${tok}`;
  }
  for (const w of c.websites) {
    const fb = facebookPageSlug(w);
    if (fb) return `fb:${fb.toLowerCase()}`;
    const tok = mapsToken(w);
    if (tok) return `maps:${tok}`;
    try {
      const host = new URL(w).hostname.replace(/^www\./, "").toLowerCase();
      if (
        host &&
        !["facebook.com", "instagram.com", "t.me", "google.com"].some(
          (h) => host === h || host.endsWith(`.${h}`),
        )
      ) {
        return `web:${host}`;
      }
    } catch {
      /* ignore */
    }
  }
  const name = (c.name || "").trim();
  if (name.length >= 3 && !NOISE_RE.test(name)) {
    const norm = name.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "");
    if (norm.length >= 4) return `name:${norm.slice(0, 48)}`;
  }
  return null;
}

function isNoise(text: string): boolean {
  const t = stripInvisible(text).trim();
  if (!t || t.length < 2) return true;
  if (NOISE_RE.test(t)) return true;
  if (/^(reply|edited|facebook|google\.com)$/i.test(t)) return true;
  return false;
}

/**
 * Split pasted FB thread into comment-ish chunks.
 * Handles «Author · text Reply» dumps and blank-line blocks.
 */
export function splitRecommendationThread(raw: string): {
  requestText: string | null;
  comments: Array<{ author: string | null; text: string }>;
} {
  const text = stripInvisible(raw).replace(/\r\n/g, "\n");
  // Split on Reply / Edited markers and dense author separators
  const parts = text
    .split(/\n(?=Reply\b)|(?<=\bReply)\n+|\n(?=Edited\b)|(?<=\bEdited)\n+/i)
    .map((p) => p.replace(/^\s*(Reply|Edited)\s*$/gim, "").trim())
    .filter(Boolean);

  let requestText: string | null = null;
  const comments: Array<{ author: string | null; text: string }> = [];

  for (const part of parts) {
    const lines = part
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "·" && l !== "•");
    if (!lines.length) continue;

    let author: string | null = null;
    let bodyLines = lines;
    // Author often first short line before ·
    if (
      lines.length >= 2 &&
      lines[0].length <= 60 &&
      !URL_RE.test(lines[0]) &&
      !PHONE_RE.test(lines[0]) &&
      /[A-Za-zА-Яа-яЁё]/.test(lines[0])
    ) {
      author = cleanDisplayName(lines[0]);
      bodyLines = lines.slice(1);
    }
    const body = bodyLines.join("\n").trim();
    if (!body) continue;

    if (!requestText && REQUEST_RE.test(body)) {
      requestText = body;
      continue;
    }
    // Group header / meta lines before first request
    if (!requestText && /Fun for Mom|Orange County|California/i.test(body) && body.length < 200) {
      continue;
    }
    comments.push({ author, text: body });
  }

  // Fallback: whole paste is one blob — still try to find request + remainder
  if (!requestText && REQUEST_RE.test(text)) {
    requestText = text.slice(0, 900);
  }

  return { requestText, comments };
}

export function parseRecommendationThread(
  raw: string,
): ParseRecommendationThreadResult {
  const { requestText, comments } = splitRecommendationThread(raw);
  const cat = requestText ? guessCategory(requestText) : null;
  const cityFromRequest = requestText ? guessCity(requestText) : null;
  const map = new Map<string, ParsedRecommendationCluster>();
  let skippedNoise = 0;

  for (const c of comments) {
    if (isNoise(c.text)) {
      skippedNoise += 1;
      continue;
    }
    const contacts = extractContacts(c.text);
    const key = clusterKey(contacts);
    if (!key) {
      skippedNoise += 1;
      continue;
    }
    const display =
      cleanDisplayName(contacts.name) ||
      (contacts.instagram[0] ? `@${contacts.instagram[0]}` : null) ||
      (contacts.facebook_pages[0] ? contacts.facebook_pages[0] : null) ||
      null;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        cluster_key: key,
        display_name: display,
        phones: [...contacts.phones],
        instagram: [...contacts.instagram],
        websites: [...contacts.websites],
        mention_count: 1,
        third_party_mention_count: 1,
        self_ad_mention_count: 0,
        comment_texts: [c.text.slice(0, 500)],
        request_snippets: requestText ? [requestText.slice(0, 280)] : [],
        recommender_names: c.author ? [c.author] : [],
        category_guess: cat || guessCategory(c.text),
        city: guessCity(`${c.text}\n${requestText || ""}`) || cityFromRequest,
      });
      continue;
    }
    existing.mention_count += 1;
    existing.third_party_mention_count += 1;
    if (c.text && existing.comment_texts.length < 8) {
      existing.comment_texts.push(c.text.slice(0, 500));
    }
    if (c.author && !existing.recommender_names.includes(c.author)) {
      existing.recommender_names.push(c.author);
    }
    for (const p of contacts.phones) {
      if (!existing.phones.includes(p)) existing.phones.push(p);
    }
    for (const ig of contacts.instagram) {
      if (!existing.instagram.includes(ig)) existing.instagram.push(ig);
    }
    for (const w of contacts.websites) {
      if (!existing.websites.includes(w)) existing.websites.push(w);
    }
    if (!existing.display_name && display) existing.display_name = display;
    if (!existing.city) {
      existing.city =
        guessCity(`${c.text}\n${requestText || ""}`) || cityFromRequest;
    }
    if (!existing.category_guess) {
      existing.category_guess = cat || guessCategory(c.text);
    }
  }

  const clusters = [...map.values()].sort(
    (a, b) => b.mention_count - a.mention_count,
  );
  return { requestText, clusters, skippedNoise };
}
