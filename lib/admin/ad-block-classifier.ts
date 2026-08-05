/**
 * Classify free-text ad copy into vacancy / event / promotion / update / service.
 * Used by published enrich finalize so price lines do not all become «услуги».
 */

import { hasDateSignal } from "@/lib/import-review/entity-routing";
import {
  isNewsUpdateTitle,
  UPDATE_SIGNAL_RE,
} from "@/lib/updates/extract";

export type AdIntent =
  | "vacancy"
  | "event"
  | "promotion"
  | "update"
  | "service"
  | "unknown";

/** Hiring post — same family as import-services VACANCY_TEXT_RE. */
export const VACANCY_AD_RE =
  /(?:ваканси\p{L}*|vacancies?|резюме|now\s+hiring|we\s+are\s+hiring|join\s+our\s+team|приглашаем\s+на\s+работу|мы\s+нанимаем|(?:требу[ею]тся?|ищ[еу]м?|нужны?|набира\p{L}+)[^\n]{0,40}?(?:мастер\p{L}*|сотрудник\p{L}*|специалист\p{L}*|работник\p{L}*|водител\p{L}*|повар\p{L}*|официант\p{L}*|помощник\p{L}*|нян[юяи]|бариста|парикмахер\p{L}*|команду|персонал\p{L}*)|ищем\s+(?:сотрудника|работника|provider|owner-?operator)|hiring|на\s+чек)/iu;

/**
 * Dated community / affiche nouns. Alone they are weak; with a date signal
 * the copy is an event, not a priced service.
 */
export const EVENT_NOUN_RE =
  /(?:мероприят|концерт|встреча|пикник|speed\s+dating|singles|анонсов|вечеринка|вылазк|афиш|фестивал|мастер-?класс|workshop|webinar|вебинар|open\s+mic|standup|стендап|лекция|кинопоказ|выставк|галяж|garage\s+sale\s+party|party\s+this|жаркую?\s+вечеринк|(?:торжественн\p{L}*\s+)?открыти\p{L}*|grand\s+opening|official\s+opening|opening\s+(?:day|party|celebration))/iu;

const PROMO_SIGNAL_RE =
  /(?<![\p{L}])(?:акци[яию](?![\p{L}])|спецпредложен|специальн\p{L}*\s+предложен|special\s+offer|promo(?![\p{L}]))|(?:скидк\p{L}*\s*(?:до\s*)?\d{1,2}\s*%|\d{1,2}\s*%\s*(?:скидк\p{L}*|off)|discount\s*(?:of\s*)?\d{1,2}\s*%)|\$\s?\d+\s*(?:off|скидк\p{L}*)|(?<![\p{L}])(?:БЕСПЛАТН[А-ЯЁ]*|FREE)(?![\p{L}])/iu;

const SERVICE_PRICE_RE =
  /(?:^|\n).{3,90}?\s*[-—–:]*\s*(?:от|from)?\s*[$₽]?\s*\d{1,5}(?:[.,]\d{2})?\s*(?:\$|usd|долл\p{L}*|руб\p{L}*)?\s*(?:$|\n)/imu;

export function isVacancyAdText(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return VACANCY_AD_RE.test(t);
}

/** Event = event noun + a date/time cue (or labeled «Когда:»). */
export function isEventAdText(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (!EVENT_NOUN_RE.test(t)) return false;
  if (hasDateSignal(t)) return true;
  if (/(?:когда|when|date|дата)\s*[:：]/i.test(t)) return true;
  // «7го Февраля», «7 February» without the shared date regex catching ordinals
  if (
    /\b\d{1,2}(?:го|е|ое)?\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function isPromotionAdText(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return PROMO_SIGNAL_RE.test(t);
}

export function isUpdateAdText(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (UPDATE_SIGNAL_RE.test(t)) return true;
  return isNewsUpdateTitle(t);
}

/**
 * Priority: vacancy → event → promotion → update → service → unknown.
 * Call on a single coherent ad block, not a glued multi-post blob.
 */
export function classifyAdIntent(text: string | null | undefined): AdIntent {
  const t = String(text || "").trim();
  if (!t) return "unknown";
  if (isVacancyAdText(t)) return "vacancy";
  if (isEventAdText(t)) return "event";
  if (isPromotionAdText(t)) return "promotion";
  if (isUpdateAdText(t)) return "update";
  if (SERVICE_PRICE_RE.test(t)) return "service";
  return "unknown";
}

/** Paragraphs (or the whole text) that classify as events. */
export function eventBlocksFromText(text: string | null | undefined): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parts = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const blocks = parts.length > 1 ? parts : [raw];
  const hit = blocks.filter((b) => isEventAdText(b));
  if (hit.length) return hit;
  // Collapsed one-liner party ad with no blank lines
  if (isEventAdText(raw)) return [raw];
  return [];
}

/** First usable title line for an event / vacancy draft. */
export function firstAdTitleLine(
  text: string | null | undefined,
  fallback: string,
): string {
  for (const line of String(text || "").split(/\n+/)) {
    const t = line
      .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "")
      .trim();
    if (t.length >= 8) return t.slice(0, 160);
  }
  return fallback;
}

/** Paragraphs that may become priced services (not vacancy / event / news). */
export function serviceEligibleAdBlocks(
  texts: (string | null | undefined)[] | null | undefined,
): string[] {
  if (isVacancyAdText((texts ?? []).join("\n"))) return [];
  const blocks: string[] = [];
  for (const raw of texts ?? []) {
    const body = String(raw || "").trim();
    if (!body) continue;
    // Prefer paragraph split so a glued party+price-list ad still yields services.
    const parts = body
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);
    const candidates = parts.length > 1 ? parts : [body];
    for (const block of candidates) {
      if (isEventAdText(block) || isVacancyAdText(block)) continue;
      if (isPromotionAdText(block) || isUpdateAdText(block)) continue;
      if (isNewsUpdateTitle(block)) continue;
      blocks.push(block);
    }
  }
  return blocks;
}
