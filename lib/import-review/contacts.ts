import type { ImportReviewItem } from "@/types/import-review";
import { sanitizeInstagramHandles } from "@/lib/import-review/display-name";
import {
  isFacebookUrl,
  isInstagramUrl,
} from "@/lib/business/presence";

export type ContactLevel = "full" | "has_contact" | "telegram_only" | "none";

export const CONTACT_LEVEL_LABELS: Record<ContactLevel, string> = {
  full: "Контакты полные",
  has_contact: "Есть контакт",
  telegram_only: "Только Telegram",
  none: "Нет контактов",
};

export const CONTACT_LEVEL_STYLES: Record<ContactLevel, string> = {
  full: "bg-emerald-50 text-emerald-800 border-emerald-200",
  has_contact: "bg-sky-50 text-sky-800 border-sky-200",
  telegram_only: "bg-amber-50 text-amber-900 border-amber-200",
  none: "bg-slate-100 text-slate-600 border-slate-200",
};

function nonEmpty(values: string[] | null | undefined): string[] {
  return (values ?? []).map((v) => String(v).trim()).filter(Boolean);
}

function cleanUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/^@+/, "");
  return cleaned || null;
}

function mentionsWhatsapp(text: string | null | undefined): boolean {
  return /whats\s*app|ватсап|вацап|wa\.me/i.test(text || "");
}

export type ContactFlags = {
  phones: string[];
  whatsapp: string[];
  telegramUsername: string | null;
  emails: string[];
  websites: string[];
  instagram: string[];
  facebook: string[];
  sourceUrl: string | null;
  telegramUserId: string | null;
};

export function getContactFlags(
  item: Pick<
    ImportReviewItem,
    | "phone"
    | "whatsapp"
    | "telegram_username"
    | "email"
    | "website"
    | "instagram"
    | "source_url"
    | "telegram_user_id"
    | "source_author_username"
    | "description"
    | "source_text"
  >,
): ContactFlags {
  const phones = nonEmpty(item.phone);
  let whatsapp = nonEmpty(item.whatsapp);
  // If author wrote WhatsApp but only phone was extracted — still show WA icon.
  if (
    whatsapp.length === 0 &&
    phones.length > 0 &&
    mentionsWhatsapp(item.description || item.source_text)
  ) {
    whatsapp = [phones[0]!];
  }

  const websites = nonEmpty(item.website);
  const facebook = websites.filter((w) => isFacebookUrl(w));
  const plainWebsites = websites.filter(
    (w) => !isFacebookUrl(w) && !isInstagramUrl(w),
  );

  return {
    phones,
    whatsapp,
    telegramUsername:
      cleanUsername(item.telegram_username) ||
      cleanUsername(item.source_author_username),
    emails: nonEmpty(item.email),
    websites: plainWebsites,
    instagram: sanitizeInstagramHandles(item.instagram),
    facebook,
    sourceUrl: item.source_url?.trim() || null,
    telegramUserId: item.telegram_user_id?.trim() || null,
  };
}

export function computeContactPriorityScore(flags: ContactFlags): number {
  const hasPhone = flags.phones.length > 0;
  const hasWhatsapp = flags.whatsapp.length > 0;
  const hasTgUsername = Boolean(flags.telegramUsername);
  const hasEmail = flags.emails.length > 0;
  const hasWebsite = flags.websites.length > 0;
  const hasSocial = flags.instagram.length > 0 || flags.facebook.length > 0;
  const hasSourceUrl = Boolean(flags.sourceUrl);
  const hasTgUid = Boolean(flags.telegramUserId);

  const primaryTypes = [
    hasPhone,
    hasWhatsapp,
    hasTgUsername,
    hasEmail,
    hasWebsite,
    hasSocial,
  ].filter(Boolean).length;

  let score = 0;
  if (hasPhone) score += 100;
  if (hasWhatsapp) score += 90;
  if (hasTgUsername) score += 70;
  if (hasEmail) score += 60;
  if (hasWebsite) score += 50;
  if (hasSocial) score += 40;
  if (hasSourceUrl) score += 10;
  if (primaryTypes > 1) score += (primaryTypes - 1) * 20;

  if (
    !hasPhone &&
    !hasWhatsapp &&
    !hasTgUsername &&
    !hasEmail &&
    !hasWebsite &&
    !hasSocial &&
    !hasSourceUrl &&
    hasTgUid
  ) {
    score += 1;
  }

  return score;
}

export function contactLevelFromFlags(flags: ContactFlags): ContactLevel {
  const hasPrimary =
    flags.phones.length > 0 ||
    flags.whatsapp.length > 0 ||
    Boolean(flags.telegramUsername) ||
    flags.emails.length > 0 ||
    flags.websites.length > 0 ||
    flags.instagram.length > 0 ||
    flags.facebook.length > 0 ||
    Boolean(flags.sourceUrl) ||
    Boolean(flags.telegramUserId);

  if (hasPrimary) {
    const score = computeContactPriorityScore(flags);
    // Source post / Telegram ID alone → telegram_only; richer contacts → has_contact/full
    if (
      !flags.phones.length &&
      !flags.whatsapp.length &&
      !flags.telegramUsername &&
      !flags.emails.length &&
      !flags.websites.length &&
      !flags.instagram.length &&
      !flags.facebook.length &&
      (flags.sourceUrl || flags.telegramUserId)
    ) {
      return "telegram_only";
    }
    return score >= 180 ? "full" : "has_contact";
  }
  return "none";
}

export function contactLevelFromScore(score: number): ContactLevel {
  if (score >= 180) return "full";
  if (score <= 0) return "none";
  if (score <= 11) return "telegram_only";
  return "has_contact";
}

export function getContactLevel(item: ImportReviewItem): ContactLevel {
  return contactLevelFromFlags(getContactFlags(item));
}

export type DisplayContact = {
  kind:
    | "phone"
    | "whatsapp"
    | "telegram"
    | "email"
    | "website"
    | "instagram"
    | "facebook"
    | "source"
    | "telegram_no_username";
  label: string;
  href: string | null;
};

/** Public contact chips in priority order. Never links numeric Telegram IDs. */
export function getDisplayContacts(item: ImportReviewItem): DisplayContact[] {
  const flags = getContactFlags(item);
  const out: DisplayContact[] = [];

  for (const phone of flags.phones.slice(0, 2)) {
    out.push({
      kind: "phone",
      label: phone,
      href: `tel:${phone.replace(/[^\d+]/g, "")}`,
    });
  }
  for (const wa of flags.whatsapp.slice(0, 1)) {
    const digits = wa.replace(/[^\d]/g, "");
    out.push({
      kind: "whatsapp",
      label: wa,
      href: digits ? `https://wa.me/${digits}` : null,
    });
  }
  if (flags.telegramUsername) {
    out.push({
      kind: "telegram",
      label: `@${flags.telegramUsername}`,
      href: `https://t.me/${flags.telegramUsername}`,
    });
  } else if (flags.telegramUserId) {
    out.push({
      kind: "telegram_no_username",
      label: `id:${flags.telegramUserId}`,
      href: null,
    });
  }
  for (const email of flags.emails.slice(0, 1)) {
    out.push({
      kind: "email",
      label: email,
      href: `mailto:${email}`,
    });
  }
  for (const site of flags.websites.slice(0, 1)) {
    const href = /^https?:\/\//i.test(site) ? site : `https://${site}`;
    out.push({ kind: "website", label: site, href });
  }
  for (const ig of flags.instagram.slice(0, 1)) {
    out.push({
      kind: "instagram",
      label: `@${ig}`,
      href: `https://instagram.com/${ig}`,
    });
  }
  for (const fb of flags.facebook.slice(0, 1)) {
    const href = /^https?:\/\//i.test(fb) ? fb : `https://${fb}`;
    out.push({ kind: "facebook", label: "Facebook", href });
  }

  // Source is a separate «Источник» block — never mixed into contacts.

  return out;
}
