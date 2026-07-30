/**
 * Restore paragraph breaks in ad copy that arrived as one long line.
 *
 * Telegram / Facebook imports sometimes lose every newline, and all block
 * parsers here are structural: promotions split on blank lines, the price list
 * reads line by line. On a flattened blob they see nothing at all. This puts
 * the boundaries back at the markers the author actually used — leading emoji
 * and «Заголовок:» section labels.
 */

/** Emoji or flag that starts a new fragment, e.g. «📍 Пункты приёма: …». */
const EMOJI_FRAGMENT_RE =
  /\s+(?=[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}](?:\uFE0F|\u200D[\p{Extended_Pictographic}]|\s?[\u{1F1E6}-\u{1F1FF}])*\s*[\p{L}\p{N}])/gu;

/**
 * «Тарифы и сроки доставки:» after a finished sentence or a word. Digits are
 * excluded so a ZIP or street number cannot pull the break to the wrong spot.
 */
const SECTION_LABEL_RE =
  /(?<=[.!?…»)\p{L}\p{N}])\s+(?=[A-ZА-ЯЁ][^:\n\d]{2,40}:\s)/gu;

const MIN_LENGTH = 160;

/** True when the text lost its structure and parsers cannot read it. */
export function looksCollapsed(text: string): boolean {
  if (text.length < MIN_LENGTH) return false;
  const breaks = (text.match(/\n/g) ?? []).length;
  // Roughly one break per 300 chars means the layout is already usable.
  return breaks < Math.floor(text.length / 300);
}

/**
 * Split a collapsed blob into paragraphs. Text that already has a usable
 * layout is returned untouched.
 */
export function resegmentCollapsedText(
  text: string | null | undefined,
): string {
  const source = String(text ?? "");
  if (!source.trim() || !looksCollapsed(source)) return source;
  const split = source
    .replace(EMOJI_FRAGMENT_RE, "\n\n")
    .replace(SECTION_LABEL_RE, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // A run of flags or icons is a marker of the next fragment, not a fragment.
  const merged: string[] = [];
  for (const part of split.split(/\n{2,}/)) {
    const chunk = part.trim();
    if (!chunk) continue;
    if (merged.length && !/[\p{L}\p{N}]/u.test(merged[merged.length - 1])) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${chunk}`;
      continue;
    }
    merged.push(chunk);
  }
  return merged.join("\n\n");
}
