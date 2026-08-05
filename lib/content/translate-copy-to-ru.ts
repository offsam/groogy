/**
 * Translate entity title/description EN → RU for КРУГИ public cards.
 * Server-only; keeps originals behind «Показать оригинал».
 */
import "server-only";

import { completeJsonWithFailover } from "@/lib/ai/openrouter";

export type TranslatedCopy = {
  titleRu: string;
  descriptionRu: string | null;
  titleOriginal: string;
  descriptionOriginal: string | null;
  detectedLanguage: "en" | "ru" | "mixed" | "unknown";
  modelUsed: string;
};

/** @deprecated Prefer TranslatedCopy — same shape as the old event helper. */
export type TranslatedEventCopy = TranslatedCopy;

export function looksMostlyCyrillic(text: string): boolean {
  const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (letters.length < 8) return false;
  const cyr = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  return cyr / letters.length >= 0.55;
}

/**
 * True when the blob is Latin-heavy enough to need EN→RU
 * (or mixed / unknown non-Cyrillic). Short pure-Cyrillic skips LLM.
 * Short Latin titles («Latte», «Borscht») must still translate — public
 * cards are Russian-first for the КРУГИ audience.
 */
export function needsTranslationToRu(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const letters = trimmed.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (letters.length < 3) return false;
  const cyr = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  if (cyr / letters.length >= 0.55) return false;
  const lat = letters.length - cyr;
  return lat / letters.length >= 0.45;
}

/** Common menu board headers → RU (no LLM). */
const MENU_SECTION_RU: Record<string, string> = {
  breakfast: "Завтраки",
  brunch: "Бранч",
  lunch: "Обед",
  dinner: "Ужин",
  salads: "Салаты",
  salad: "Салаты",
  soups: "Супы",
  soup: "Супы",
  appetizers: "Закуски",
  starters: "Закуски",
  entrees: "Основные блюда",
  mains: "Основные блюда",
  sides: "Гарниры",
  desserts: "Десерты",
  drinks: "Напитки",
  beverages: "Напитки",
  coffee: "Кофе",
  "coffee hot/iced": "Кофе (горячий / со льдом)",
  tea: "Чай",
  wine: "Вино",
  beer: "Пиво",
  cocktails: "Коктейли",
  specials: "Специальные предложения",
  "traditional homemade favorites": "Традиционные домашние блюда",
};

export function translateMenuSectionToRu(
  section: string | null | undefined,
): string | null {
  const raw = (section || "").trim();
  if (!raw) return null;
  if (!needsTranslationToRu(raw)) return raw.slice(0, 80);
  const mapped = MENU_SECTION_RU[raw.toLowerCase()];
  if (mapped) return mapped;
  return raw.slice(0, 80); // batch offer translator may replace later
}

export async function translateCopyToRu(input: {
  title: string;
  description?: string | null;
}): Promise<TranslatedCopy> {
  const title = input.title.trim().slice(0, 200);
  const description = (input.description || "").trim().slice(0, 4000) || null;

  if (!title && !description) {
    return {
      titleRu: title,
      descriptionRu: description,
      titleOriginal: title,
      descriptionOriginal: description,
      detectedLanguage: "unknown",
      modelUsed: "none",
    };
  }

  const blob = [title, description].filter(Boolean).join("\n");
  if (looksMostlyCyrillic(blob)) {
    return {
      titleRu: title,
      descriptionRu: description,
      titleOriginal: title,
      descriptionOriginal: description,
      detectedLanguage: "ru",
      modelUsed: "none",
    };
  }

  const { content, modelUsed } = await completeJsonWithFailover([
    {
      role: "system",
      content: [
        "You translate directory listings for a Russian-speaking California community app (КРУГИ).",
        "Return ONLY JSON: {\"titleRu\":\"...\",\"descriptionRu\":\"...\"|null,\"detectedLanguage\":\"en\"|\"ru\"|\"mixed\"|\"unknown\"}.",
        "Translate title and description into natural Russian. Keep proper nouns, brand names, venue names, street addresses, prices ($), and URLs unchanged.",
        "Do not add phones, emails, or calls-to-action that were not in the source.",
        "descriptionRu must be narrative only (no contact dump). If description is empty, return null.",
        "Applies to businesses, professionals, jobs, marketplace/services listings, lechu/transfers, and events.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({ title: title || "—", description }),
    },
  ]);

  let parsed: {
    titleRu?: unknown;
    descriptionRu?: unknown;
    detectedLanguage?: unknown;
  } = {};
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    parsed = {};
  }

  const titleRu =
    typeof parsed.titleRu === "string" && parsed.titleRu.trim()
      ? parsed.titleRu.trim().slice(0, 200)
      : title;
  const descriptionRu =
    typeof parsed.descriptionRu === "string" && parsed.descriptionRu.trim()
      ? parsed.descriptionRu.trim().slice(0, 4000)
      : description;
  const detected =
    parsed.detectedLanguage === "en" ||
    parsed.detectedLanguage === "ru" ||
    parsed.detectedLanguage === "mixed" ||
    parsed.detectedLanguage === "unknown"
      ? parsed.detectedLanguage
      : "en";

  return {
    titleRu,
    descriptionRu,
    titleOriginal: title,
    descriptionOriginal: description,
    detectedLanguage: detected,
    modelUsed,
  };
}

/** Back-compat alias used by event approve / recommendation paths. */
export const translateEventCopyToRu = translateCopyToRu;

export type PublishNarrative = {
  title: string;
  description: string | null;
  descriptionOriginal: string | null;
  sourceLanguage: string | null;
};

/**
 * Prepare RU public copy + EN original for publish / queue.
 * When `translateTitle` is false (people / brand names), only the description moves.
 */
export async function resolvePublishNarrative(input: {
  title: string;
  description: string | null | undefined;
  descriptionOriginal?: string | null;
  sourceLanguage?: string | null;
  /** Default true. Set false for specialist/business display names. */
  translateTitle?: boolean;
}): Promise<PublishNarrative> {
  const title = input.title.trim();
  const description = (input.description || "").trim() || null;
  const existingOrig = (input.descriptionOriginal || "").trim() || null;
  const translateTitle = input.translateTitle !== false;

  if (
    existingOrig &&
    description &&
    existingOrig !== description &&
    !needsTranslationToRu(description)
  ) {
    return {
      title,
      description,
      descriptionOriginal: existingOrig,
      sourceLanguage: input.sourceLanguage || "en",
    };
  }

  const blob = [translateTitle ? title : "", description]
    .filter(Boolean)
    .join("\n");
  if (!blob || !needsTranslationToRu(blob)) {
    return {
      title,
      description,
      descriptionOriginal: existingOrig && existingOrig !== description ? existingOrig : null,
      sourceLanguage:
        input.sourceLanguage ||
        (description && looksMostlyCyrillic(description) ? "ru" : null),
    };
  }

  try {
    const translated = await translateCopyToRu({
      title: title || "—",
      description,
    });
    // Trust Cyrillic heuristics over the model's language label — models
    // sometimes return detectedLanguage=ru for clearly Latin copy and then
    // the caller would skip writing an original.
    const outDesc = translated.descriptionRu || description;
    const outLooksRu = Boolean(outDesc && looksMostlyCyrillic(outDesc));
    if (
      translated.detectedLanguage === "ru" &&
      looksMostlyCyrillic(blob) &&
      outLooksRu
    ) {
      return {
        title,
        description,
        descriptionOriginal: null,
        sourceLanguage: "ru",
      };
    }
    return {
      title: translateTitle ? translated.titleRu || title : title,
      description: outDesc,
      descriptionOriginal:
        translated.descriptionOriginal || description || null,
      sourceLanguage:
        translated.detectedLanguage === "ru" && !outLooksRu
          ? "en"
          : translated.detectedLanguage,
    };
  } catch {
    return {
      title,
      description,
      descriptionOriginal: null,
      sourceLanguage: input.sourceLanguage ?? null,
    };
  }
}

type OfferLike = {
  title: string;
  description?: string | null;
  menuSection?: string | null;
};

/**
 * Hard gate: public offer / service / menu titles+descriptions on cards
 * must be Russian. Latin-heavy rows go through one batched LLM call.
 * Menu section headers use a dictionary first.
 */
export async function ensureOffersCopyRu<T extends OfferLike>(
  offers: T[],
): Promise<T[]> {
  if (!offers.length) return offers;

  const withSections = offers.map((o) => ({
    ...o,
    menuSection: o.menuSection
      ? translateMenuSectionToRu(o.menuSection)
      : o.menuSection ?? null,
  }));

  const needTranslate = withSections.some((o) =>
    needsTranslationToRu(
      [o.title, o.description, o.menuSection].filter(Boolean).join("\n"),
    ),
  );
  if (!needTranslate) return withSections;

  const payload = withSections.map((o, i) => ({
    i,
    title: o.title.slice(0, 160),
    description: (o.description || "").trim().slice(0, 800) || null,
    section: (o.menuSection || "").trim().slice(0, 80) || null,
  }));

  try {
    const { content } = await completeJsonWithFailover([
      {
        role: "system",
        content: [
          "You translate a restaurant/service catalog for КРУГИ — a Russian-speaking California community app.",
          "Return ONLY JSON: {\"items\":[{\"i\":0,\"titleRu\":\"...\",\"descriptionRu\":\"...\"|null,\"sectionRu\":\"...\"|null}]}",
          "Translate every Latin title/description/section into natural Russian. Keep prices, brands, and proper nouns.",
          "Do not invent dishes or services. If already Russian, keep as-is.",
          "sectionRu is the menu section header (Завтраки, Салаты, Кофе…). Null when section is null.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({ items: payload }),
      },
    ]);

    let parsed: {
      items?: Array<{
        i?: unknown;
        titleRu?: unknown;
        descriptionRu?: unknown;
        sectionRu?: unknown;
      }>;
    } = {};
    try {
      parsed = JSON.parse(content) as typeof parsed;
    } catch {
      parsed = {};
    }

    const byIndex = new Map<
      number,
      { titleRu?: string; descriptionRu?: string | null; sectionRu?: string | null }
    >();
    for (const row of parsed.items ?? []) {
      if (typeof row.i !== "number") continue;
      byIndex.set(row.i, {
        titleRu:
          typeof row.titleRu === "string" && row.titleRu.trim()
            ? row.titleRu.trim().slice(0, 160)
            : undefined,
        descriptionRu:
          typeof row.descriptionRu === "string" && row.descriptionRu.trim()
            ? row.descriptionRu.trim().slice(0, 8000)
            : row.descriptionRu === null
              ? null
              : undefined,
        sectionRu:
          typeof row.sectionRu === "string" && row.sectionRu.trim()
            ? row.sectionRu.trim().slice(0, 80)
            : row.sectionRu === null
              ? null
              : undefined,
      });
    }

    return withSections.map((o, i) => {
      const hit = byIndex.get(i);
      if (!hit) return o;
      return {
        ...o,
        title: hit.titleRu || o.title,
        description:
          hit.descriptionRu !== undefined ? hit.descriptionRu : o.description,
        menuSection:
          hit.sectionRu !== undefined ? hit.sectionRu : o.menuSection,
      };
    });
  } catch {
    return withSections;
  }
}

/** Single title+body for jobs / events / updates before public insert. */
export async function ensureTitleBodyRu(input: {
  title: string;
  body?: string | null;
}): Promise<{ title: string; body: string | null }> {
  const title = input.title.trim();
  const body = (input.body || "").trim() || null;
  const blob = [title, body].filter(Boolean).join("\n");
  if (!needsTranslationToRu(blob)) {
    return { title, body };
  }
  try {
    const t = await translateCopyToRu({ title, description: body });
    return {
      title: t.titleRu || title,
      body: t.descriptionRu ?? body,
    };
  } catch {
    return { title, body };
  }
}
