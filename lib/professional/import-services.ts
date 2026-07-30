import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isJunkImportTitle } from "@/lib/import-review/display-name";
import { isNewsUpdateTitle } from "@/lib/updates/extract";

/** One offer of a specialist, ready to become a `professional_services` row. */
export type ImportedOffer = {
  title: string;
  description?: string | null;
  priceAmount?: number | null;
  /** `from` for «от 50$» wording, `fixed` for a plain price. */
  priceMode?: "fixed" | "from" | "contact";
};

const MAX_TITLE = 80;
const MAX_DESCRIPTION = 2000;
const MAX_OFFERS_PER_IMPORT = 12;

const NOISE_PATTERNS = [
  /https?:\/\/\S+|www\.\S+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /\+?\d[\d\-\s().]{8,}\d/g,
  /#[\p{L}\p{N}_]+/gu,
];

// Greetings and vocatives open half of the posts — never part of an offer name.
const GREETING_RE =
  /^(?:всем\s+)?(?:здравствуйте|здравствуй|привет(?:ствую)?|добрый\s+день|добрый\s+вечер|доброе\s+утро|доброго\s+времени(?:\s+суток)?|добро\s+пожаловать|hello|hi|hey|good\s+(?:morning|afternoon|evening)|welcome)[\s,!.:;—–-]*/iu;

const VOCATIVE_RE =
  /^(?:дорог\p{L}+\s+)?(?:девочк\p{L}+|девушк\p{L}+|дам\p{L}+|мамочки|мамы|родители|друзья|ребят\p{L}+|коллеги|соседи|земляки|народ|всем)[\s,!.:;—–-]+/iu;

const LETTER_RE = /\p{L}/gu;

function letterCount(value: string): number {
  return (value.match(LETTER_RE) || []).length;
}

/** Case / spacing / punctuation insensitive key: one offer per profile. */
export function serviceTitleKey(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Noise / greetings out, length untouched — callers judge the real length. */
function offerTitleText(raw: string): string {
  let text = raw;
  for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, " ");
  text = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i += 1) {
    const stripped = text
      .replace(GREETING_RE, "")
      .replace(VOCATIVE_RE, "")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .trim();
    if (stripped === text) break;
    text = stripped;
  }
  return text.replace(/[^\p{L}\p{N})»"']+$/u, "").trim();
}

function cleanOfferTitle(raw: string): string {
  let text = offerTitleText(raw);
  if (text.length > MAX_TITLE) {
    text = text
      .slice(0, MAX_TITLE)
      .replace(/\s+\S*$/, "")
      .replace(/[\s,.;:!?—–-]+$/, "");
  }
  return text.trim();
}

function firstSentence(line: string): string {
  const head = line.split(/(?<=[.!?…])\s+/, 1)[0]?.trim() || line;
  return letterCount(head) >= 6 ? head : line;
}

function acceptable(title: string): boolean {
  return (
    Boolean(title) &&
    letterCount(title) >= 3 &&
    !isJunkImportTitle(title) &&
    !isNewsUpdateTitle(title)
  );
}

/** «у нас Aetna», «Алекс мой сын у него стрижется» — chatter, not a service. */
const PERSONAL_CLAUSE_RE =
  /(?:^|\s)(?:я|мы|вы|ты|он|она|они|мне|нам|вам|тебе|нас|вас|меня|тебя|им|их|ему|ей|мой|моя|моё|мое|мои|наш\p{L}*|ваш\p{L}*|сво[йяёеиух]\p{L}*|у\s+нас|у\s+меня)(?:[\s,]|$)/iu;

/** «Начни сегодня», «Не упусти момент» — a call to action, not a service. */
const CALL_TO_ACTION_RE =
  /^(?:не\s+)?(?:начни\p{L}*|представь\p{L}*|упусти\p{L}*|успей\p{L}*|спеши\p{L}*|звони\p{L}*|пиши\p{L}*|жми\p{L}*|переходи\p{L}*|записывай\p{L}*|подписывай\p{L}*|сохраняй\p{L}*|делись|делитесь|приходи\p{L}*|заказывай\p{L}*|получи\p{L}*|узнай\p{L}*|смотри\p{L}*|советую|рекомендую)\b/iu;

/** «И эта сделка получилась особенной» — a continuation of the story above. */
const CONTINUATION_RE =
  /^(?:и|а|но|зато|поэтому|потому|также|тоже|ещё|еще|тогда|кстати|после|перед|если|когда|пока|чтобы|поскольку|несмотря)\s/iu;

/** A hiring post sells a job, not a service — its perks are not our offers. */
const VACANCY_TEXT_RE =
  /(?:ваканси\p{L}*|резюме|now\s+hiring|we\s+are\s+hiring|join\s+our\s+team|приглашаем\s+на\s+работу|мы\s+нанимаем|(?:требу[ею]тся?|ищ[еу]м?|нужны?|набира\p{L}+)[^\n]{0,40}?(?:мастер\p{L}*|сотрудник\p{L}*|специалист\p{L}*|работник\p{L}*|водител\p{L}*|повар\p{L}*|официант\p{L}*|помощник\p{L}*|нян[юяи]|бариста|парикмахер\p{L}*|команду|персонал\p{L}*))/iu;

function dedupeOffers(offers: ImportedOffer[]): ImportedOffer[] {
  const seen = new Map<string, number>();
  const out: ImportedOffer[] = [];
  for (const offer of offers) {
    const key = serviceTitleKey(offer.title);
    if (!key || seen.has(key)) continue;
    // The same ad reaches us twice (card copy + source post) with slightly
    // different wording: «Zoom — $70» and «Zoom/телефон — $70». Keep the fuller.
    const near = out.findIndex(
      (kept) =>
        kept.priceAmount === offer.priceAmount &&
        (() => {
          const a = serviceTitleKey(kept.title);
          return a.startsWith(key) || key.startsWith(a);
        })(),
    );
    if (near >= 0) {
      if (offer.title.length > out[near].title.length) out[near] = offer;
      seen.set(key, near);
      continue;
    }
    seen.set(key, out.length);
    out.push(offer);
    if (out.length >= MAX_OFFERS_PER_IMPORT) break;
  }
  return out;
}

/** Queue `services[]` — already short names, keep them as offer titles. */
export function offersFromServiceNames(
  names: (string | null | undefined)[] | null | undefined,
): ImportedOffer[] {
  const offers: ImportedOffer[] = [];
  for (const raw of names ?? []) {
    const title = cleanOfferTitle(String(raw || "").trim());
    if (acceptable(title)) offers.push({ title });
  }
  return dedupeOffers(offers);
}

/** «Ламинирование ресниц - 110$», «Массаж — от $80», «Маникюр: 50 долларов». */
const PRICE_LINE_RE =
  /^(.{3,90}?)\s*[-—–:]*\s*(от|from)?\s*[$₽]?\s*(\d{1,5})(?:[.,]\d{2})?\s*(?:\$|usd|долл\p{L}*|руб\p{L}*)?\s*$/iu;

/** «$70 — Zoom», «$120-$150 — сопровождение» — price written before the name. */
const PRICE_FIRST_RE =
  /^(от|from)?\s*[$₽]\s*(\d{1,5})(?:[.,]\d{2})?\s*(?:[-–—]\s*[$₽]?\s*(\d{1,5})(?:[.,]\d{2})?)?\s*(?:\$|usd|долл\p{L}*|руб\p{L}*)?\s*[-—–:]\s*(.{3,90})$/iu;

/** «Россия, Беларусь $18 / 1 кг = 16–21 дней» — price per unit tariff. */
const UNIT_PRICE_RE =
  /^(.{3,90}?)\s*[-—–:]*\s*(от|from)?\s*\$\s*(\d{1,5})(?:[.,]\d{2})?\s*(?:\/|за)\s*(\d{0,3}\s*(?:кг|kg|фунт\p{L}*|lb|шт|час|hour|день|day|мес\p{L}*|month))(?![\p{L}])/iu;

const DURATION_TITLE_RE =
  /^(?:сеанс|session|массаж)?\s*(\d{2,3})\s*(?:мин|min|минут\p{L}*)\s*$/iu;

const SERVICE_LIST_HEADER_RE =
  /^(?:виды?\s+(?:массажа|услуг|сеансов|работ)|услуги|услуги\s*:|services?|что\s+входит|меню\s+услуг)\s*[:：]?\s*$/iu;

/**
 * «✅ Перевод документов», «• Стрижка», «- Массаж». Ads rarely use the headers
 * above; a run of same-marked lines is the list, whatever the header says.
 * Decorative leads (🔹 📑 💵) stay out — they mark sections, not items.
 */
const BULLET_LINE_RE = /^(?:[✅✔☑✓•▪▫◾◽‣∙·*]|[-–—]\s)\s*/u;

/** A dash also opens dialogue and prose, so it needs a longer run to count. */
const DASH_BULLET_RE = /^[-–—]\s/u;

/** «985 Valencia St» — the address block, wherever it is bulleted. */
const STREET_LINE_RE =
  /^\d{1,6}[\p{L}]?\s+[\p{L}][\p{L}\s.'’-]{2,40}\s*(?:st|str|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|pkwy|suite|ste|apt|unit|#)\b/iu;

const EMOJI_PREFIX_RE =
  /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u;

function priceOffersFromText(body: string): ImportedOffer[] {
  const offers: ImportedOffer[] = [];
  for (const line of body.split("\n")) {
    const bare = line.trim().replace(EMOJI_PREFIX_RE, "").trim();
    const first = bare.match(PRICE_FIRST_RE);
    if (first) {
      const title = cleanOfferTitle(first[4] || "");
      const amount = Number(first[2]);
      if (acceptable(title) && Number.isFinite(amount) && amount > 0) {
        offers.push({
          title,
          priceAmount: amount,
          // A range quotes the floor, same as «от 120$».
          priceMode: first[1] || first[3] ? "from" : "fixed",
        });
        continue;
      }
    }
    const unit = line.trim().match(UNIT_PRICE_RE);
    if (unit) {
      const title = cleanOfferTitle(unit[1] || "");
      const amount = Number(unit[3]);
      const per = unit[4].replace(/\s+/g, " ").trim();
      if (acceptable(title) && Number.isFinite(amount) && amount > 0) {
        offers.push({
          title: `${title} — $${amount} / ${per}`.slice(0, MAX_TITLE),
          priceAmount: amount,
          priceMode: unit[2] ? "from" : "fixed",
        });
        continue;
      }
    }
    const match = line.trim().match(PRICE_LINE_RE);
    if (!match) continue;
    const hasCurrency = /[$₽]|usd|долл|руб/i.test(line);
    if (!hasCurrency) continue;
    let title = cleanOfferTitle(match[1] || "");
    const duration = title.match(DURATION_TITLE_RE);
    if (duration) {
      title = `Сеанс ${duration[1]} мин`;
    }
    const amount = Number(match[3]);
    if (!acceptable(title) || !Number.isFinite(amount) || amount <= 0) continue;
    offers.push({
      title,
      priceAmount: amount,
      priceMode: match[2] ? "from" : "fixed",
    });
  }
  return offers;
}

/** Bullet lines — under a «Виды массажа:» header or as a run of their own. */
function namedServiceOffersFromText(body: string): ImportedOffer[] {
  const lines = body.split("\n");
  const offers: ImportedOffer[] = [];
  let inList = false;
  let blankStreak = 0;
  let run: string[] = [];
  let runIsDashed = false;

  const add = (text: string) => {
    const title = cleanOfferTitle(text);
    if (acceptable(title)) offers.push({ title });
  };
  // One bulleted line is decoration («✅ Работаю по записи»); a run is a list.
  // Story bullets («И при этом оставил машину себе») are not list items.
  const flushRun = () => {
    const items = run.filter(
      (text) =>
        !PERSONAL_CLAUSE_RE.test(text) &&
        !CONTINUATION_RE.test(text) &&
        !CALL_TO_ACTION_RE.test(text) &&
        !STREET_LINE_RE.test(text),
    );
    if (items.length >= (runIsDashed ? 3 : 2)) items.forEach(add);
    run = [];
    runIsDashed = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      blankStreak += 1;
      // One blank between bullets is normal; two ends the list.
      if (blankStreak >= 2) {
        flushRun();
        inList = false;
      }
      continue;
    }
    blankStreak = 0;

    // Checked before the emoji strip — ✅ and friends are pictographs too.
    if (BULLET_LINE_RE.test(line)) {
      const text = line.replace(BULLET_LINE_RE, "").trim();
      // A bullet that is itself a header («✅ Услуги:») opens nothing.
      if (
        text &&
        !/[:：]$/.test(text) &&
        letterCount(text) <= 90 &&
        !PRICE_LINE_RE.test(text)
      ) {
        if (DASH_BULLET_RE.test(line)) runIsDashed = true;
        run.push(text);
      } else {
        flushRun();
      }
      continue;
    }
    flushRun();

    const bare = line.replace(EMOJI_PREFIX_RE, "").trim();
    if (SERVICE_LIST_HEADER_RE.test(bare)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    // Stop the list on labeled sections / price blocks / narrative resume.
    if (
      /^(?:длительность|результат|доступные\s+даты|контакты|адрес|когда|где|цена|стоимость|это\s+не\s+просто|из\s+усталости)\b/i.test(
        bare,
      ) ||
      PRICE_LINE_RE.test(line)
    ) {
      inList = false;
      continue;
    }
    // Skip obvious non-service sentences that slipped between bullets.
    if (/^(?:это\s+|из\s+)/i.test(bare) || letterCount(line) > 90) {
      inList = false;
      continue;
    }
    add(bare);
  }
  flushRun();
  return offers;
}

/**
 * Free-text self-ads: services come from the named list and the price list.
 * An ad without either states no services — guessing one from the opening
 * line put «Группа привет» and «Пишите в личку» on live cards.
 */
export function offersFromAdTexts(
  texts: (string | null | undefined)[] | null | undefined,
): ImportedOffer[] {
  const offers: ImportedOffer[] = [];
  // The card copy and the source post are the same ad: if either one says
  // «вакансия», the whole thing is a hiring post and sells no services.
  if (VACANCY_TEXT_RE.test((texts ?? []).join("\n"))) return [];

  for (const raw of texts ?? []) {
    const body = String(raw || "").trim();
    if (!body) continue;
    // Greeting + news posts without a price list are updates, not services.
    if (isNewsUpdateTitle(body) || isNewsUpdateTitle(firstSentence(body))) {
      continue;
    }
    offers.push(...namedServiceOffersFromText(body), ...priceOffersFromText(body));
  }
  return dedupeOffers(offers);
}

/** Queue `services[]` string labels from parsed offers (titles, with price when known). */
export function serviceLabelsFromOffers(offers: ImportedOffer[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const offer of offers) {
    const label =
      offer.priceAmount != null
        ? `${offer.title} — ${offer.priceMode === "from" ? "от " : ""}$${offer.priceAmount}`
        : offer.title;
    const key = serviceTitleKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

/**
 * Add offers the profile does not have yet. Same person keeps one card; every
 * new ad of theirs becomes another service inside it, never a repeat.
 */
export async function addMissingProfessionalServices(
  client: SupabaseClient,
  professionalId: string,
  offers: ImportedOffer[],
): Promise<number> {
  if (!offers.length) return 0;
  const db = client as unknown as SupabaseClient;

  const { data: existingRows } = await db
    .from("professional_services")
    .select("title, sort_order")
    .eq("professional_id", professionalId);

  const existing = (existingRows ?? []) as Array<{
    title: string | null;
    sort_order: number | null;
  }>;
  const taken = new Set(existing.map((row) => serviceTitleKey(row.title)));
  const nextSort = existing.reduce(
    (max, row) => Math.max(max, Number(row.sort_order ?? 0)),
    0,
  );

  const rows = offers
    .filter((offer) => {
      const key = serviceTitleKey(offer.title);
      if (!key || taken.has(key)) return false;
      taken.add(key);
      return true;
    })
    .map((offer, index) => {
      const priceMode = offer.priceAmount ? offer.priceMode ?? "fixed" : "contact";
      return {
        professional_id: professionalId,
        title: offer.title.slice(0, 160),
        description: offer.description?.trim().slice(0, MAX_DESCRIPTION) || null,
        price_mode: priceMode,
        price_amount: priceMode === "contact" ? null : offer.priceAmount,
        currency: "USD",
        is_active: true,
        sort_order: nextSort + index + 1,
      };
    });

  // Row by row: the unique title index must not drop the whole batch.
  let added = 0;
  for (const row of rows) {
    const { error } = await db.from("professional_services").insert(row);
    if (!error) added += 1;
  }
  return added;
}
