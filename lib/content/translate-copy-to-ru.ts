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
 */
export function needsTranslationToRu(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (looksMostlyCyrillic(trimmed)) return false;
  const letters = trimmed.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (letters.length < 8) return false;
  return true;
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
