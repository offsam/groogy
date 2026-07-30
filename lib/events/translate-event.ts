/**
 * Translate event title/description EN → RU for affiche publish.
 * Server-only; keeps originals on the recommendation / event row.
 */
import "server-only";

import { completeJsonWithFailover } from "@/lib/ai/openrouter";

export type TranslatedEventCopy = {
  titleRu: string;
  descriptionRu: string | null;
  titleOriginal: string;
  descriptionOriginal: string | null;
  detectedLanguage: "en" | "ru" | "mixed" | "unknown";
  modelUsed: string;
};

function looksMostlyCyrillic(text: string): boolean {
  const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (letters.length < 8) return false;
  const cyr = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  return cyr / letters.length >= 0.55;
}

export async function translateEventCopyToRu(input: {
  title: string;
  description?: string | null;
}): Promise<TranslatedEventCopy> {
  const title = input.title.trim().slice(0, 200);
  const description = (input.description || "").trim().slice(0, 4000) || null;

  if (!title) {
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
        "You translate event listings for a Russian-speaking California community app (КРУГИ).",
        "Return ONLY JSON: {\"titleRu\":\"...\",\"descriptionRu\":\"...\"|null,\"detectedLanguage\":\"en\"|\"ru\"|\"mixed\"|\"unknown\"}.",
        "Translate title and description into natural Russian. Keep proper nouns, venue names, street addresses, prices ($), and URLs unchanged.",
        "Do not add phones, emails, or calls-to-action that were not in the source.",
        "descriptionRu must be narrative only (no contact dump). If description is empty, return null.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({ title, description }),
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
