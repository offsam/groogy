/**
 * Pull the first http(s) URL out of free text — used so a curator (or an
 * approved submission) can just paste "Скидка 20%! https://site.com/promo"
 * into the post body and still get a proper standalone "Ссылка" button on
 * the card, instead of a dead link buried in a paragraph.
 */
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_RE);
  if (!match) return null;
  // Trim common trailing punctuation that isn't part of the URL.
  return match[0].replace(/[.,;:!?]+$/, "");
}

/** Resolve the link to show on a coupon card: explicit field wins, else scan the body. */
export function resolveCouponLink(
  explicitLink: string | null | undefined,
  body: string | null | undefined,
): string | null {
  const explicit = explicitLink?.trim();
  if (explicit) return explicit;
  return extractFirstUrl(body);
}
