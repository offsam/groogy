/**
 * Split messy imported business blurbs into display sections.
 * Contacts stay out of narrative copy — they belong in the sidebar.
 */

export type BusinessProfileSections = {
  /** Clean narrative for «О нас» / «О компании». */
  about: string | null;
  /** Short teaser for overview (first paragraphs of about). */
  aboutPreview: string | null;
  /** Hiring / job-posting copy. */
  jobs: string | null;
  /** Promo / discount copy. */
  promotions: string | null;
  /** Phones found in free text (for sidebar fallback only). */
  extractedPhones: string[];
  /** Emails found in free text (for sidebar fallback only). */
  extractedEmails: string[];
  /** Facebook page URLs found in free text. */
  extractedFacebookUrls: string[];
  /** Instagram profile URLs found in free text. */
  extractedInstagramUrls: string[];
  /** Non-social website URLs found in free text. */
  extractedWebsiteUrls: string[];
};

const SOURCE_FOOTER_RE =
  /(?:^|\n)\s*(?:Источник|Source|Original post)\s*[:：].*$/gim;

const PHONE_RE =
  /(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}|\d{3}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}|\d{10,11})/;

const PHONE_GLOBAL_RE = new RegExp(PHONE_RE.source, "g");

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

const EMAIL_GLOBAL_RE = new RegExp(EMAIL_RE.source, "g");

const FACEBOOK_RE =
  /(?:https?:\/\/)?(?:www\.)?facebook\.com\/[A-Za-z0-9._\-/]+/i;

const FACEBOOK_GLOBAL_RE = new RegExp(FACEBOOK_RE.source, "gi");

const INSTAGRAM_RE =
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._\-]+\/?/i;

const INSTAGRAM_GLOBAL_RE = new RegExp(INSTAGRAM_RE.source, "gi");

/** WhatsApp deep links. */
const WHATSAPP_URL_RE =
  /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s<>"'）)\]]+/gi;

/** Telegram deep links. */
const TELEGRAM_URL_RE =
  /https?:\/\/(?:t\.me|telegram\.me|telegram\.org)\/[^\s<>"'）)\]]+/gi;

/** Full http(s) URLs — used to extract website/social links from copy. */
const HTTP_URL_RE = /https?:\/\/[^\s<>"'）)\]]+/gi;

const WWW_URL_RE = /\bwww\.[^\s<>"'）)\]]+/gi;

const BARE_HANDLE_RE = /(?:^|[\s(,])@[A-Za-z0-9._]{3,30}\b/g;

const BARE_URL_LINE_RE = /^https?:\/\/\S+$/i;

const URL_LINE_RE =
  /^(?:сайт|website|web|url|facebook|форма|form)\s*[:：]?\s*\S+$/i;

const CONTACT_LINE_RE =
  /^(?:📩|📞|📱|✉️)?\s*(?:наш\s+)?(?:тел(?:ефон)?|phone|call|звон(?:и|ить)?|whatsapp|telegram|тг|email|e-mail|почта|instagram|инстаграм|facebook|fb|контакт(?:ы)?|contacts?|форма|form|регистрац|registration|сайт|website|web|url)(?:\s+для\s+\p{L}+)?\s*[:：]?\s*/iu;

const ADDRESS_LINE_RE =
  /^(?:[📍🏠🗺]\s*)?(?:наш\s+)?(?:адрес|address|где|where|локаци[яи]|location|venue|место\s+проведен)\s*[:：]?$/iu;

/** Bare locality left after the street was moved to the address block. */
const CITY_STATE_ONLY_RE =
  /^(?:[📍🏠🗺]\s*)?[A-Za-z][A-Za-z .'-]{1,40},\s*(?:CA|California|WA|Washington|NY|New\s*York|FL|Florida|OR|Oregon|TX|Texas|CO|Colorado)\s*$/iu;

const CTA_CONTACT_ONLY_RE =
  /^(?:📩|📞|📱|✉️)?\s*(?:пишите|напишите|звоните|call\s+me|dm\s+me|в\s+личные|личные\s+сообщения|write\s+(?:us|me)|text\s+(?:us|me)|contact\s+(?:us|me)).{0,80}$/i;

/** US street + optional city / state / ZIP tail. */
const STREET_ADDRESS_WITH_TAIL_RE =
  /\b\d{1,5}\s+[A-Za-z0-9][A-Za-z0-9 .#'-]{2,40}\s(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|place|pl|highway|hwy|parkway|pkwy|suite|ste|unit|apt|room|#)\.?(?:\s*,\s*[A-Za-z][A-Za-z .'-]{1,40})?(?:\s*,?\s*(?:CA|California))?(?:\s*\d{5}(?:-\d{4})?)?/gi;

const STREET_ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z0-9][A-Za-z0-9 .#'-]{2,40}\s(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|place|pl|highway|hwy|parkway|pkwy|suite|ste|unit|apt|room|#)\b/i;

/** Prefer CA ZIP / «City, CA 92630» — avoid bare 5-digit false positives. */
const ZIP_CITY_TAIL_RE =
  /\b[A-Za-z][A-Za-z .'-]{1,40},\s*(?:CA|California)\s*\d{5}(?:-\d{4})?\b|\b(?:CA|California)\s*\d{5}(?:-\d{4})?\b/gi;

const JOB_RE =
  /(?:ваканси|recruitment|hiring|now\s+hiring|we(?:'re|\s+are)?\s+hiring|job\s*listing|open\s+position|looking\s+for|seeking\s+(?:a\s+)?(?:tech|specialist|master|employee)|в\s+поисках|поиск\s+специалист|ищ(?:у|ем|ут)\s+(?:опытн\w*\s+)?(?:мастер|сотрудник|работник|специалист|парикмахер|маникюр|техник|декоратор|педагог|помощник|helper)|требуется\s+(?:мастер|сотрудник|специалист)|нуж(?:ен|ны)\s+(?:мастер|специалист|сотрудник)|приглашаем\s+(?:мастер|специалист|эксперт|педагог|сотрудник)|на\s+работу|compensation\s+package|требования\s*:|requirements\s*:|доход\s+от\s*\$|position\s*:)/i;

const PROMO_RE =
  /(?:скидк|акци[яи]|promo|discount|%\s*off|\$\s*\d+\s*off|для\s+новых\s+клиент|first[- ]time\s+client)/i;

/** Labeled social handles — must NOT match inside https://www.instagram.com/... */
const LABELED_SOCIAL_RE =
  /(?:^|[\s(,])(?:instagram|инстаграм|whatsapp|telegram|тг)\s*[:：]?\s*@?[A-Za-z0-9._]+/gi;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return raw.trim();
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[.,;:!?)]+$/, "");
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function isInstagramUrl(url: string): boolean {
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return /instagram\.com/i.test(url);
  }
}

function isFacebookUrl(url: string): boolean {
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return (
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "fb.com" ||
      host.endsWith(".fb.com")
    );
  } catch {
    return /facebook\.com|fb\.com/i.test(url);
  }
}

function isYelpUrl(url: string): boolean {
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host === "yelp.com" || host.endsWith(".yelp.com");
  } catch {
    return /yelp\.com/i.test(url);
  }
}

function stripInlineContacts(text: string): string {
  return text
    .replace(EMAIL_GLOBAL_RE, " ")
    .replace(PHONE_GLOBAL_RE, " ")
    .replace(WHATSAPP_URL_RE, " ")
    .replace(TELEGRAM_URL_RE, " ")
    .replace(FACEBOOK_GLOBAL_RE, " ")
    .replace(INSTAGRAM_GLOBAL_RE, " ")
    .replace(LABELED_SOCIAL_RE, " ")
    .replace(HTTP_URL_RE, " ")
    .replace(WWW_URL_RE, " ")
    .replace(BARE_HANDLE_RE, " ")
    .replace(STREET_ADDRESS_WITH_TAIL_RE, " ")
    .replace(STREET_ADDRESS_RE, " ")
    .replace(ZIP_CITY_TAIL_RE, " ")
    .replace(/(?:^|[\s])по\s+ссылке\s*:?\s*$/gi, " ")
    .replace(
      /(?:^|[.!?]\s+|,\s*)(?:пишите|напишите|звоните|call|text|dm|contact\s+us|write\s+(?:us|me))(?:\s+в)?(?:\s+\w+)?\s*[.,:;!?…]*$/gi,
      "",
    )
    .replace(/\b(?:whatsapp|telegram|instagram|инстаграм)\b/gi, " ")
    .replace(
      /(?:^|[^\p{L}\p{N}])(?:тел(?:ефон)?|phone|call|email|e-?mail|почта|контакт(?:ы)?|contacts?)(?![\p{L}\p{N}])\s*[:：]?\s*/giu,
      " ",
    )
    .replace(/\b(?:located\s+at|по\s+адресу)\b/gi, " ")
    .replace(/\bat\s*,/gi, " ")
    .replace(/\bat\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:?)])/g, "$1")
    .replace(/^[,\s:;]+|[,\s:;]+$/g, "")
    .replace(/\.\s*\./g, ".")
    .trim();
}

/**
 * Public surfaces (cards, guest profile, search): narrative only.
 * Phones, emails, socials, websites, street addresses belong in dedicated
 * contacts / location blocks — never in «Описание» / «О нас».
 */
export function redactContactsFromPublicText(
  text: string | null | undefined,
): string | null {
  if (text == null) return null;
  const outLines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (outLines.length && outLines[outLines.length - 1] !== "") {
        outLines.push("");
      }
      continue;
    }
    if (isContactOnlyLine(line) || isAddressOnlyLine(line)) continue;
    const cleaned = stripInlineContacts(line);
    if (cleaned.length < 3) continue;
    if (isContactOnlyLine(cleaned) || isAddressOnlyLine(cleaned)) continue;
    outLines.push(cleaned);
  }
  const out = outLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out.length > 0 ? out : null;
}

/** Alias — same strict narrative cleaner for every public entity card. */
export const publicNarrativeText = redactContactsFromPublicText;

/** Channels we strip from narrative — used for the pointer line and fill-empty. */
export type NarrativeContactChannel =
  | "phone"
  | "email"
  | "instagram"
  | "telegram"
  | "whatsapp"
  | "website"
  | "address";

export type NarrativeWithContactPointer = {
  /** Clean story, optionally ending with one «… в блоке «Контакты»» line. */
  text: string | null;
  /** Which contact kinds were present in the raw text and removed. */
  removedChannels: NarrativeContactChannel[];
};

const CHANNEL_LABEL_RU: Record<NarrativeContactChannel, string> = {
  phone: "телефон",
  email: "почта",
  instagram: "Instagram",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  website: "сайт",
  address: "адрес",
};

function detectRemovedChannels(
  raw: string,
): NarrativeContactChannel[] {
  const found: NarrativeContactChannel[] = [];
  if (raw.match(PHONE_GLOBAL_RE)) found.push("phone");
  if (raw.match(EMAIL_GLOBAL_RE)) found.push("email");
  if (
    raw.match(INSTAGRAM_GLOBAL_RE) ||
    /(?:instagram|инстаграм)\s*[:：]?\s*@?/i.test(raw) ||
    /(?:^|[\s(,])@[A-Za-z0-9._]{3,30}\b/.test(raw)
  ) {
    found.push("instagram");
  }
  if (
    /https?:\/\/(?:t\.me|telegram\.me|telegram\.org)\//i.test(raw) ||
    /(?:telegram|телеграм|тг)\s*[:：]?\s*@?/i.test(raw)
  ) {
    found.push("telegram");
  }
  if (
    /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\//i.test(raw) ||
    /\bwhatsapp\b/i.test(raw)
  ) {
    found.push("whatsapp");
  }
  if (
    /https?:\/\//i.test(raw) ||
    /\bwww\./i.test(raw) ||
    /(?:сайт|website|web|url)\s*[:：]/i.test(raw)
  ) {
    const withoutSocial = raw
      .replace(INSTAGRAM_GLOBAL_RE, " ")
      .replace(FACEBOOK_GLOBAL_RE, " ")
      .replace(/https?:\/\/(?:t\.me|telegram\.me|telegram\.org|wa\.me|api\.whatsapp\.com)\/[^\s<>"']+/gi, " ");
    if (/https?:\/\//i.test(withoutSocial) || /\bwww\./i.test(withoutSocial)) {
      found.push("website");
    }
  }
  if (
    /(?:адрес|address|где|where|локаци[яи]|location|venue|наш\s+адрес|located\s+at|по\s+адресу)\s*[:：]/i.test(
      raw,
    ) ||
    STREET_ADDRESS_RE.test(raw)
  ) {
    found.push("address");
  }
  return found;
}

function contactPointerLine(channels: NarrativeContactChannel[]): string | null {
  const contactChannels = channels.filter((c) => c !== "address");
  const hasAddress = channels.includes("address");
  if (!contactChannels.length && !hasAddress) return null;

  if (contactChannels.length && hasAddress) {
    const labels = contactChannels.map((c) => CHANNEL_LABEL_RU[c]);
    const contactPart =
      labels.length === 1
        ? labels[0]
        : labels.length === 2
          ? `${labels[0]} и ${labels[1]}`
          : `${labels.slice(0, -1).join(", ")} и ${labels[labels.length - 1]}`;
    return `${contactPart[0]!.toUpperCase()}${contactPart.slice(1)} и адрес — в блоках «Контакты» и «Адрес»`;
  }
  if (hasAddress) {
    return "Адрес — в блоке «Адрес»";
  }
  const labels = contactChannels.map((c) => CHANNEL_LABEL_RU[c]);
  const contactPart =
    labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} и ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")} и ${labels[labels.length - 1]}`;
  return `${contactPart![0]!.toUpperCase()}${contactPart!.slice(1)} — в блоке «Контакты»`;
}

/**
 * Strip contacts/addresses from narrative and append one pointer line that
 * sends the reader to the dedicated contacts / address blocks.
 * Used for every public entity card type (business, professional, event, …).
 */
export function narrativeWithContactPointer(
  text: string | null | undefined,
): NarrativeWithContactPointer {
  if (text == null || !String(text).trim()) {
    return { text: null, removedChannels: [] };
  }
  const raw = String(text);
  const removedChannels = detectRemovedChannels(raw);
  const cleaned = redactContactsFromPublicText(raw);
  if (!cleaned) {
    return { text: null, removedChannels };
  }
  const pointer = contactPointerLine(removedChannels);
  if (!pointer) {
    return { text: cleaned, removedChannels };
  }
  // Avoid duplicating the pointer if we already cleaned this text once.
  if (/в блоке «Контакты»|в блоках «Контакты»/i.test(cleaned)) {
    return { text: cleaned, removedChannels };
  }
  return {
    text: `${cleaned}\n\n${pointer}`,
    removedChannels,
  };
}

const GREETING_OPEN_RE =
  /^(?:всем\s+)?(?:здравствуйте|здравствуй|привет(?:ствую)?|добрый\s+день|добрый\s+вечер|доброе\s+утро|доброго\s+времени(?:\s+суток)?|друзья[,\s!.]*приветствую|hello|hi|hey|welcome)[\s,!.:;—–-]*/iu;

/**
 * First meaningful line of a cleaned narrative — no greeting, no promo opener.
 * Used for short_description / card blurbs.
 */
export function shortNarrativeTeaser(
  text: string | null | undefined,
  maxChars = 160,
): string | null {
  const cleaned = redactContactsFromPublicText(text);
  if (!cleaned) return null;
  for (const rawLine of cleaned.split(/\n+/)) {
    let line = rawLine.trim().replace(GREETING_OPEN_RE, "").trim();
    line = line.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    if (line.length < 12) continue;
    // Skip promo openers for the teaser — they belong in «Акции».
    if (PROMO_RE.test(line)) continue;
    if (line.length > maxChars) {
      line = line
        .slice(0, maxChars)
        .replace(/\s+\S*$/, "")
        .replace(/[\s,.;:!?—–-]+$/, "");
    }
    return line || null;
  }
  return null;
}

function isAddressOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (ADDRESS_LINE_RE.test(t)) return true;
  if (CITY_STATE_ONLY_RE.test(t)) return true;
  if (!STREET_ADDRESS_RE.test(t)) return false;
  const without = stripInlineContacts(t)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Street-heavy line with almost no narrative left after stripping the address.
  return without.length < 12 || without.split(/\s+/).filter(Boolean).length <= 2;
}

function isContactOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (CONTACT_LINE_RE.test(t) || URL_LINE_RE.test(t) || BARE_URL_LINE_RE.test(t)) {
    return true;
  }
  if (CTA_CONTACT_ONLY_RE.test(t)) return true;
  if (INSTAGRAM_RE.test(t) && stripInlineContacts(t).length < 8) return true;
  if (
    /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\//i.test(t) &&
    stripInlineContacts(t).length < 8
  ) {
    return true;
  }
  if (
    /https?:\/\/(?:t\.me|telegram\.me|telegram\.org)\//i.test(t) &&
    stripInlineContacts(t).length < 8
  ) {
    return true;
  }

  const withoutContacts = stripInlineContacts(t)
    .replace(/[@#]/g, " ")
    .replace(/[📞📱📩✉️🌐🏠📍]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Line was mostly a phone/email/handle
  if (
    withoutContacts.length < 8 &&
    (PHONE_RE.test(t) || EMAIL_RE.test(t) || FACEBOOK_RE.test(t) || INSTAGRAM_RE.test(t))
  ) {
    return true;
  }

  // "949-701-7980 Валентина" / name after phone only
  if (
    PHONE_RE.test(t) &&
    withoutContacts.length < 12 &&
    withoutContacts.split(/\s+/).filter(Boolean).length <= 2
  ) {
    return true;
  }

  if (
    FACEBOOK_RE.test(t) &&
    withoutContacts.length < 12 &&
    withoutContacts.split(/\s+/).filter(Boolean).length <= 2
  ) {
    return true;
  }

  if (
    INSTAGRAM_RE.test(t) &&
    withoutContacts.length < 12 &&
    withoutContacts.split(/\s+/).filter(Boolean).length <= 2
  ) {
    return true;
  }

  return false;
}

function classifyBlock(block: string): "about" | "jobs" | "promotions" | "drop" {
  const t = block.trim();
  if (!t) return "drop";
  if (isContactOnlyLine(t)) return "drop";
  if (JOB_RE.test(t)) return "jobs";
  if (PROMO_RE.test(t) && t.length < 600) return "promotions";
  return "about";
}

function previewFromAbout(about: string | null, maxChars = 420): string | null {
  if (!about) return null;
  if (about.length <= maxChars) return about;
  const cut = about.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf(". "));
  const soft = lastBreak > maxChars * 0.45 ? cut.slice(0, lastBreak + 1) : cut;
  return `${soft.trim()}…`;
}

/**
 * Parse free-text business description into categorized profile sections.
 */
export function structureBusinessProfileCopy(
  description: string | null | undefined,
  shortDescription?: string | null,
): BusinessProfileSections {
  const raw = [description, shortDescription]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join("\n\n");

  if (!raw.trim()) {
    return {
      about: null,
      aboutPreview: null,
      jobs: null,
      promotions: null,
      extractedPhones: [],
      extractedEmails: [],
      extractedFacebookUrls: [],
      extractedInstagramUrls: [],
      extractedWebsiteUrls: [],
    };
  }

  let working = raw.replace(SOURCE_FOOTER_RE, "").trim();

  // Explicit edit-mode markers take priority over heuristic split.
  let markedJobs: string | null = null;
  let markedPromos: string | null = null;
  working = working.replace(
    /<<<JOBS>>>\s*([\s\S]*?)\s*<<<END>>>/gi,
    (_, body: string) => {
      markedJobs = body.trim() || null;
      return "\n\n";
    },
  );
  working = working.replace(
    /<<<PROMOS>>>\s*([\s\S]*?)\s*<<<END>>>/gi,
    (_, body: string) => {
      markedPromos = body.trim() || null;
      return "\n\n";
    },
  );
  let withoutFooter = working.replace(/\n{3,}/g, "\n\n").trim();
  // Remove ---FB_ENTITY_...--- JSON only; keep any human text after the dump.
  withoutFooter = withoutFooter.replace(
    /\n?---FB_ENTITY_[\w-]+---\s*\{[\s\S]*?\n\}/gi,
    "",
  );
  withoutFooter = withoutFooter.replace(/\n{3,}/g, "\n\n").trim();

  const phones = unique(
    [...withoutFooter.matchAll(PHONE_GLOBAL_RE)].map((m) => normalizePhone(m[0])),
  );
  const emails = unique(
    [...withoutFooter.matchAll(EMAIL_GLOBAL_RE)].map((m) => m[0]),
  );
  const facebookUrls = unique(
    [...withoutFooter.matchAll(FACEBOOK_GLOBAL_RE)].map((m) => {
      return normalizeHttpUrl(m[0]);
    }),
  );
  const allHttpUrls = unique(
    [...withoutFooter.matchAll(HTTP_URL_RE)].map((m) => normalizeHttpUrl(m[0])),
  );
  const instagramUrls = unique([
    ...[...withoutFooter.matchAll(INSTAGRAM_GLOBAL_RE)].map((m) =>
      normalizeHttpUrl(m[0]),
    ),
    ...allHttpUrls.filter(isInstagramUrl),
  ]);
  const websiteUrls = allHttpUrls.filter(
    (url) => !isInstagramUrl(url) && !isFacebookUrl(url) && !isYelpUrl(url),
  );

  const blocks = withoutFooter
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const aboutParts: string[] = [];
  const jobParts: string[] = [];
  const promoParts: string[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const aboutLines: string[] = [];
    const jobLines: string[] = [];

    for (const line of lines) {
      if (isContactOnlyLine(line) || isAddressOnlyLine(line)) continue;
      const cleaned = stripInlineContacts(line);
      if (!cleaned || cleaned.length < 3) continue;
      if (isContactOnlyLine(cleaned) || isAddressOnlyLine(cleaned)) continue;
      if (/^[-–—•*]+\s*$/.test(cleaned)) continue;
      if (JOB_RE.test(cleaned) || /^recruitment\b/i.test(cleaned)) {
        jobLines.push(cleaned);
      } else {
        aboutLines.push(cleaned);
      }
    }

    if (jobLines.length > 0) {
      jobParts.push(jobLines.join("\n"));
    }
    if (aboutLines.length > 0) {
      const cleanedBlock = aboutLines.join("\n");
      const kind = classifyBlock(cleanedBlock);
      if (kind === "about") aboutParts.push(cleanedBlock);
      else if (kind === "jobs") jobParts.push(cleanedBlock);
      else if (kind === "promotions") promoParts.push(cleanedBlock);
    }
  }

  // If entire description was a job ad, keep it in jobs even if classifier mixed
  if (aboutParts.length === 0 && jobParts.length === 0 && JOB_RE.test(withoutFooter)) {
    const fallback = stripInlineContacts(
      withoutFooter
        .split("\n")
        .filter((l) => !isContactOnlyLine(l))
        .join("\n"),
    );
    if (fallback) jobParts.push(fallback);
  }

  const about = aboutParts.length > 0 ? aboutParts.join("\n\n").trim() : null;
  const jobs =
    markedJobs ||
    (jobParts.length > 0 ? jobParts.join("\n\n").trim() : null);
  const promotions =
    markedPromos ||
    (promoParts.length > 0 ? promoParts.join("\n\n").trim() : null);

  return {
    about,
    aboutPreview: previewFromAbout(about),
    jobs,
    promotions,
    extractedPhones: phones,
    extractedEmails: emails,
    extractedFacebookUrls: facebookUrls,
    extractedInstagramUrls: instagramUrls,
    extractedWebsiteUrls: websiteUrls,
  };
}

/** Compose description from about / jobs / promotions sections with markers. */
export function composeBusinessDescription(input: {
  about: string;
  jobs: string;
  promotions: string;
}): string {
  const parts: string[] = [];
  const about = input.about.trim();
  const jobs = input.jobs.trim();
  const promotions = input.promotions.trim();
  if (about) parts.push(about);
  if (jobs) parts.push(`<<<JOBS>>>\n${jobs}\n<<<END>>>`);
  if (promotions) parts.push(`<<<PROMOS>>>\n${promotions}\n<<<END>>>`);
  return parts.join("\n\n");
}

/**
 * Split legacy free-text so job blocks become Job rows and leave the business
 * description without hiring copy.
 */
export function extractJobsAndCleanDescription(
  description: string | null | undefined,
  shortDescription?: string | null,
): {
  jobsText: string | null;
  cleanedDescription: string | null;
  cleanedShortDescription: string | null;
} {
  const sections = structureBusinessProfileCopy(description, shortDescription);
  const jobsText = sections.jobs?.trim() || null;
  if (!jobsText) {
    return {
      jobsText: null,
      cleanedDescription: description?.trim() || null,
      cleanedShortDescription: shortDescription?.trim() || null,
    };
  }

  const cleanedDescription =
    composeBusinessDescription({
      about: sections.about ?? "",
      jobs: "",
      promotions: sections.promotions ?? "",
    }).trim() || null;

  // Short description often duplicated hiring blurbs — prefer about preview.
  const cleanedShortDescription =
    sections.aboutPreview?.trim() ||
    sections.about?.trim().slice(0, 280) ||
    null;

  return {
    jobsText,
    cleanedDescription,
    cleanedShortDescription,
  };
}
