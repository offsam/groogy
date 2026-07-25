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

const URL_LINE_RE =
  /^(?:сайт|website|web|url|facebook)\s*[:：]?\s*\S+$/i;

const CONTACT_LINE_RE =
  /^(?:тел(?:ефон)?|phone|call|звон(?:и|ить)?|whatsapp|telegram|тг|email|e-mail|почта|instagram|инстаграм|facebook|fb|контакт)\s*[:：]/i;

const JOB_RE =
  /(?:ваканси|ищем\s+(?:мастер|сотрудник|работник|специалист|парикмахер|маникюр)|требуется\s+(?:мастер|сотрудник)|hiring|job\s*listing|position\s*:|приглашаем\s+мастер|на\s+работу|compensation\s+package|требования\s*:|requirements\s*:|доход\s+от\s*\$)/i;

const PROMO_RE =
  /(?:скидк|акци[яи]|promo|discount|%\s*off|\$\s*\d+\s*off|для\s+новых\s+клиент|first[- ]time\s+client)/i;

const CTA_CONTACT_ONLY_RE =
  /^(?:📩|📞|📱|✉️)?\s*(?:пишите|напишите|звоните|call\s+me|dm\s+me|в\s+личные|личные\s+сообщения).{0,80}$/i;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return raw.trim();
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

function stripInlineContacts(text: string): string {
  return text
    .replace(EMAIL_GLOBAL_RE, " ")
    .replace(PHONE_GLOBAL_RE, " ")
    .replace(FACEBOOK_GLOBAL_RE, " ")
    .replace(
      /(?:instagram|инстаграм|whatsapp|telegram|тг)\s*[:：]?\s*@?[\w./-]+/gi,
      " ",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .trim();
}

function isContactOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (CONTACT_LINE_RE.test(t) || URL_LINE_RE.test(t)) return true;
  if (CTA_CONTACT_ONLY_RE.test(t)) return true;

  const withoutContacts = stripInlineContacts(t)
    .replace(/[@#]/g, " ")
    .replace(/[📞📱📩✉️🌐🏠📍]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Line was mostly a phone/email/handle
  if (
    withoutContacts.length < 8 &&
    (PHONE_RE.test(t) || EMAIL_RE.test(t) || FACEBOOK_RE.test(t))
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
  const withoutFooter = working.replace(/\n{3,}/g, "\n\n").trim();

  const phones = unique(
    [...withoutFooter.matchAll(PHONE_GLOBAL_RE)].map((m) => normalizePhone(m[0])),
  );
  const emails = unique(
    [...withoutFooter.matchAll(EMAIL_GLOBAL_RE)].map((m) => m[0]),
  );
  const facebookUrls = unique(
    [...withoutFooter.matchAll(FACEBOOK_GLOBAL_RE)].map((m) => {
      const rawUrl = m[0];
      return rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    }),
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

    const keptLines: string[] = [];
    for (const line of lines) {
      if (isContactOnlyLine(line)) continue;
      const cleaned = stripInlineContacts(line);
      if (!cleaned || cleaned.length < 3) continue;
      // Drop lines that became empty noise after contact strip
      if (/^[-–—•*]+\s*$/.test(cleaned)) continue;
      keptLines.push(cleaned);
    }

    if (keptLines.length === 0) continue;

    const cleanedBlock = keptLines.join("\n");
    const kind = classifyBlock(cleanedBlock);
    if (kind === "about") aboutParts.push(cleanedBlock);
    else if (kind === "jobs") jobParts.push(cleanedBlock);
    else if (kind === "promotions") promoParts.push(cleanedBlock);
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
