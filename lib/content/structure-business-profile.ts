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
  /^(?:сайт|website|web|url|facebook)\s*[:：]?\s*\S+$/i;

const CONTACT_LINE_RE =
  /^(?:тел(?:ефон)?|phone|call|звон(?:и|ить)?|whatsapp|telegram|тг|email|e-mail|почта|instagram|инстаграм|facebook|fb|контакт)\s*[:：]/i;

const JOB_RE =
  /(?:ваканси|recruitment|hiring|now\s+hiring|we(?:'re|\s+are)?\s+hiring|job\s*listing|open\s+position|looking\s+for|seeking\s+(?:a\s+)?(?:tech|specialist|master|employee)|в\s+поисках|поиск\s+специалист|ищ(?:у|ем|ут)\s+(?:опытн\w*\s+)?(?:мастер|сотрудник|работник|специалист|парикмахер|маникюр|техник|декоратор|педагог|помощник|helper)|требуется\s+(?:мастер|сотрудник|специалист)|нуж(?:ен|ны)\s+(?:мастер|специалист|сотрудник)|приглашаем\s+(?:мастер|специалист|эксперт|педагог|сотрудник)|на\s+работу|compensation\s+package|требования\s*:|requirements\s*:|доход\s+от\s*\$|position\s*:)/i;

const PROMO_RE =
  /(?:скидк|акци[яи]|promo|discount|%\s*off|\$\s*\d+\s*off|для\s+новых\s+клиент|first[- ]time\s+client)/i;

const CTA_CONTACT_ONLY_RE =
  /^(?:📩|📞|📱|✉️)?\s*(?:пишите|напишите|звоните|call\s+me|dm\s+me|в\s+личные|личные\s+сообщения).{0,80}$/i;

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
    .replace(/(?:^|[\s])по\s+ссылке\s*:?\s*$/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .trim();
}

/**
 * Public surfaces (cards, guest profile, search): narrative only.
 * Phones, emails, socials, websites belong exclusively in the gated contacts block.
 */
export function redactContactsFromPublicText(
  text: string | null | undefined,
): string | null {
  if (text == null) return null;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isContactOnlyLine(line))
    .map((line) => stripInlineContacts(line))
    .filter((line) => line.length >= 3);
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out.length > 0 ? out : null;
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
  if (PHONE_RE.test(t) && withoutContacts.split(/\s+/).length <= 3) {
    return true;
  }

  if (FACEBOOK_RE.test(t) && withoutContacts.split(/\s+/).length <= 3) {
    return true;
  }

  if (INSTAGRAM_RE.test(t) && withoutContacts.split(/\s+/).length <= 3) {
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
      if (isContactOnlyLine(line)) continue;
      const cleaned = stripInlineContacts(line);
      if (!cleaned || cleaned.length < 3) continue;
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
