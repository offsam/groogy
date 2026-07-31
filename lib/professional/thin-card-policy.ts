/**
 * Thin / junk professional card policy.
 * Used by approve gates and cleanup scripts (keep in sync with Python audit).
 */

const WEAK_NAME_RE =
  /^(?:юля|юлия|оля|ольга|ілля|илья|илья|анна|аня|марина|кристина|сергей|mila|anna|olya|ilya|usa|reel|llc|smm|профи|специалист)$/iu;

const MULTI_SPACE_RE = /\s+/g;

export function normalizePersonName(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(MULTI_SPACE_RE, " ")
    .trim();
}

/** First-name-only / stub display names that need a real contact to publish. */
export function isWeakProfessionalName(
  raw: string | null | undefined,
): boolean {
  const n = normalizePersonName(raw);
  if (!n || n.length < 3) return true;
  const parts = n.split(" ").filter(Boolean);
  if (parts.length === 1) {
    if (n.length <= 8) return true;
    if (WEAK_NAME_RE.test(n)) return true;
  }
  if (WEAK_NAME_RE.test(n)) return true;
  return false;
}

/** Identity contact — not Telegram post URL / channel id alone. */
export function hasRealProfessionalContact(input: {
  phone?: string | null | string[] | null;
  email?: string | null | string[] | null;
  website?: string | null | string[] | null;
  instagram?: string | null | string[] | null;
  whatsapp?: string | null | string[] | null;
  instagram_url?: string | null;
}): boolean {
  const first = (v: string | string[] | null | undefined) => {
    if (Array.isArray(v)) return (v.find((x) => String(x || "").trim()) || "")
      .trim();
    return (v || "").trim();
  };
  return Boolean(
    first(input.phone) ||
      first(input.email) ||
      first(input.website) ||
      first(input.instagram) ||
      first(input.whatsapp) ||
      first(input.instagram_url),
  );
}

export type ThinCardPublishBlock =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Gate before publishing a specialist:
 * weak first-name cards need a real contact (phone/IG/site/email).
 */
export function evaluateThinProfessionalPublish(input: {
  displayName: string | null | undefined;
  phone?: string | null | string[] | null;
  email?: string | null | string[] | null;
  website?: string | null | string[] | null;
  instagram?: string | null | string[] | null;
  whatsapp?: string | null | string[] | null;
}): ThinCardPublishBlock {
  const hasContact = hasRealProfessionalContact(input);
  if (!hasContact) {
    return {
      ok: false,
      message:
        "Для специалиста нужен реальный контакт: телефон, Instagram, сайт или email (одной ссылки на пост Telegram недостаточно).",
    };
  }
  if (isWeakProfessionalName(input.displayName) && !hasContact) {
    return {
      ok: false,
      message:
        "Имя слишком короткое (только «Юля» / «Оля»…). Добавьте фамилию или реальный контакт.",
    };
  }
  // Weak name WITH contact is allowed (MilaTax ok; «Юля»+phone ok).
  return { ok: true };
}
