/**
 * Extract акции from free-text ads: discount blocks with optional date range.
 */

import type { QueuePromotion } from "@/types/promotion";

const PROMO_LINE_RE =
  /(?:скидк\p{L}*\s*(?:до\s*)?(\d{1,2})\s*%|(\d{1,2})\s*%\s*(?:скидк\p{L}*|off)|discount\s*(?:of\s*)?(\d{1,2})\s*%|(\d{1,2})\s*%\s*off)/iu;

/** «0% годовых (APR)», «1.9% APR» — financing offer, not a discount percent. */
const APR_RE = /(\d{1,2}(?:[.,]\d)?)\s*%\s*(?:apr|годовых)/iu;

const MONEY_OFF_RE =
  /\$\s?\d+\s*(?:off|скидк\p{L}*)|\d+\s*\$\s*(?:off|скидк\p{L}*)/iu;

/** Word-bounded so «реакции» / «экстракции» never read as «акция». */
const PROMO_NOUN_RE =
  /(?<![\p{L}])(?:акци[яию](?![\p{L}])|спецпредложен|специальн\p{L}*\s+предложен|special\s+offer|promo(?![\p{L}]))/iu;

/**
 * «доставка по Бишкеку БЕСПЛАТНАЯ!», «ВАЖНО: первая стрижка бесплатно».
 * Plain «бесплатная консультация» in normal case is a standing perk, so the
 * copy has to shout it — caps or an ВАЖНО / АКЦИЯ marker — to count as an offer.
 */
const FREE_SHOUT_RE =
  /(?<![\p{L}])(?:БЕСПЛАТН[А-ЯЁ]*|FREE)(?![\p{L}])|(?<![\p{L}])(?:ВАЖНО|АКЦИЯ|ONLY|NEW)\b[^\n]{0,80}?(?<![\p{L}])(?:бесплатн\p{L}*|free)(?![\p{L}])/u;

/** «сориентирует по актуальным акциям» promises info, it is not an offer. */
const INFO_PROMO_RE =
  /(?:по|об|о|про)\s+(?:наши\p{L}*\s+|актуальны\p{L}*\s+|текущи\p{L}*\s+)*акци\p{L}+|актуальны\p{L}*\s+акци\p{L}+|уточняйте\s+акци\p{L}+|следите\s+за\s+акци\p{L}+/giu;

/** A short line right above the offer usually carries its real name. */
const HEADING_HINT_RE = /предложен|акци|специальн|скидк|promo|offer|sale/iu;

const GREETING_PREFIX_RE =
  /^(?:всем\s+)?(?:привет|здравствуйте|добрый\s+день|добрый\s+вечер|друзья|дорогие\s+\p{L}+)[!,.\s—-]*/iu;

const PROMO_RANGE_RE =
  /с\s+(\d{1,2})\s*(?:по|-|–|—)\s*(\d{1,2})\s+([а-яё]+)/iu;

const PROMO_UNTIL_RE = /(?:до|по|к)\s+(\d{1,2})\s+([а-яё]+)/iu;

const PROMO_DATE_RE = /(\d{1,2})\s+([а-яё]+)/iu;

const MONTHS_RU: Record<string, number> = {
  января: 1,
  январяя: 1,
  январь: 1,
  февраля: 2,
  февраль: 2,
  марта: 3,
  март: 3,
  апреля: 4,
  апрель: 4,
  мая: 5,
  май: 5,
  июня: 6,
  июнь: 6,
  июля: 7,
  июль: 7,
  августа: 8,
  август: 8,
  сентября: 9,
  сентябрь: 9,
  октября: 10,
  октябрь: 10,
  ноября: 11,
  ноябрь: 11,
  декабря: 12,
  декабрь: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/** Keep the current year unless the date is far behind (next-year promo). */
function resolveYear(month: number, day: number, now: Date): number {
  const iso = isoDate(now.getUTCFullYear(), month, day);
  if (!iso) return now.getUTCFullYear();
  const delta = (Date.parse(`${iso}T00:00:00Z`) - now.getTime()) / 86_400_000;
  return delta < -300 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

function parseRuRange(
  text: string,
  now = new Date(),
): { from: string | null; until: string | null } {
  const range = text.match(PROMO_RANGE_RE);
  if (range) {
    const month = MONTHS_RU[(range[3] || "").toLowerCase()];
    if (month) {
      const year = resolveYear(month, Number(range[2]), now);
      return {
        from: isoDate(year, month, Number(range[1])),
        until: isoDate(year, month, Number(range[2])),
      };
    }
  }
  const until = text.match(PROMO_UNTIL_RE) ?? text.match(PROMO_DATE_RE);
  if (until) {
    const month = MONTHS_RU[(until[2] || "").toLowerCase()];
    if (month) {
      const year = resolveYear(month, Number(until[1]), now);
      return { from: null, until: isoDate(year, month, Number(until[1])) };
    }
  }
  return { from: null, until: null };
}

function hasPromoNoun(text: string): boolean {
  return PROMO_NOUN_RE.test(text.replace(INFO_PROMO_RE, " "));
}

/** True when the block announces an offer, not just mentions акции exist. */
function isOffer(block: string): boolean {
  if (PROMO_LINE_RE.test(block) || MONEY_OFF_RE.test(block)) return true;
  if (FREE_SHOUT_RE.test(block)) return true;
  const apr = block.match(APR_RE);
  if (apr) {
    // 0% APR is an offer by itself; any other rate just describes market terms
    // unless the copy frames it as an акция.
    if (Number(apr[1].replace(",", ".")) === 0 || hasPromoNoun(block)) return true;
  }
  return hasPromoNoun(block);
}

/** Keep the offer itself, not the whole self-introduction around it. */
function narrowToOffer(block: string): string {
  if (block.length <= 280) return block;
  const lines = block.split("\n").filter((l) => l.trim());
  if (lines.length > 1) {
    const hits = lines
      .map((line, i) => (isOffer(line) ? i : -1))
      .filter((i) => i >= 0);
    if (hits.length) {
      const lo = hits[0];
      let hi = hits[hits.length - 1];
      // «Действует акция:» — the terms follow on the next lines.
      if (lines[hi].trimEnd().endsWith(":")) {
        while (hi + 1 < lines.length && hi - lo < 6) hi += 1;
      }
      for (let i = 0; i < 2; i += 1) {
        const next = hi + 1;
        if (
          next < lines.length &&
          lines[next].length <= 90 &&
          /\d|до\s|скидк|акци/i.test(lines[next])
        ) {
          hi = next;
        } else {
          break;
        }
      }
      const narrowed = lines.slice(lo, hi + 1).join("\n").trim();
      if (narrowed) block = narrowed;
    }
  }
  if (block.length <= 280) return block;
  const picked = block.split(/(?<=[.!?])\s+/).filter((s) => isOffer(s));
  return picked.length ? picked.join(" ").trim() : block;
}

function discountFromText(text: string): {
  percent: number | null;
  label: string | null;
} {
  const m = text.match(PROMO_LINE_RE);
  if (m) {
    const percent = Number(m[1] || m[2] || m[3] || m[4]);
    if (Number.isFinite(percent) && percent > 0 && percent <= 90) {
      return { percent, label: `−${percent}%` };
    }
  }
  const apr = text.match(APR_RE);
  if (apr) {
    return { percent: null, label: `${apr[1].replace(",", ".")}% APR` };
  }
  return { percent: null, label: null };
}

function firstMeaningfulLine(block: string): string {
  for (const line of block.split("\n")) {
    const t = line
      .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "")
      .replace(GREETING_PREFIX_RE, "")
      .trim();
    if (t.length < 8) continue;
    // A flattened post keeps the whole paragraph on one line — the offer is
    // the first sentence, the rest is «пишите нам» chatter.
    const sentence = t.split(/(?<=[.!?…])\s+/, 1)[0]?.trim() || t;
    return (sentence.length >= 8 ? sentence : t).slice(0, 160);
  }
  return "Акция";
}

/**
 * Pull promo blocks from an ad. One block per contiguous promo paragraph.
 */
export function promotionsFromAdText(
  text: string | null | undefined,
  now = new Date(),
): QueuePromotion[] {
  if (!text?.trim()) return [];
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: QueuePromotion[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < blocks.length; index += 1) {
    let block = blocks[index];
    if (block.length > 600 || !isOffer(block)) continue;
    const { percent, label } = discountFromText(block);
    let range = parseRuRange(block, now);
    if (!range.until) {
      // The deadline often sits in the neighbouring line.
      range = parseRuRange(
        blocks.slice(Math.max(0, index - 1), index + 2).join("\n"),
        now,
      );
    }
    block = narrowToOffer(block);
    const heading = index ? blocks[index - 1] : "";
    let title: string;
    if (heading && heading.length <= 120 && HEADING_HINT_RE.test(heading)) {
      title = firstMeaningfulLine(heading);
      block = `${heading}\n\n${block}`;
    } else {
      title = firstMeaningfulLine(block);
    }
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      body: block.slice(0, 2000),
      discount_label: label,
      discount_percent: percent,
      valid_from: range.from,
      valid_until: range.until,
    });
    if (out.length >= 3) break;
  }
  return out;
}

/** True when a promotion is still showable on a public profile. */
export function isPromotionActive(
  promo: Pick<QueuePromotion, "valid_until"> & { status?: string },
  today = new Date(),
): boolean {
  if (promo.status && promo.status !== "active") return false;
  if (!promo.valid_until) return true;
  const until = Date.parse(`${promo.valid_until}T23:59:59Z`);
  if (Number.isNaN(until)) return true;
  return until >= today.getTime();
}
