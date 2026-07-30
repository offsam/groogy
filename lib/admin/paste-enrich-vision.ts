/**
 * Read the text printed on an uploaded photo (flyer, business card, storefront)
 * so paste-enrich can parse it with the same rules as pasted text.
 *
 * Transcription only — the model must not summarise or invent fields; whatever
 * it returns goes through parsePasteEnrichTextNormalized like any other paste.
 */
import "server-only";

import sharp from "sharp";

import { completeVisionWithFailover } from "@/lib/ai/openrouter";

/** Enough detail for signage text without sending a multi-MB original. */
const OCR_MAX_EDGE = 1600;
const OCR_JPEG_QUALITY = 82;
const OCR_MAX_CHARS = 4000;

const PROMPT = [
  "Прочитай изображение и выпиши весь видимый текст как есть.",
  "Сохрани порядок строк, названия, телефоны, адреса, e-mail, соцсети.",
  "Не переводи, не пересказывай, не добавляй ничего от себя.",
  "Если текста нет — верни пустую строку.",
].join(" ");

export type PasteEnrichImageText =
  | { ok: true; text: string; modelUsed: string }
  | { ok: false; message: string };

function stripModelChatter(raw: string): string {
  let text = raw.trim();
  // Models like to wrap transcriptions in a fence or announce the result.
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "");
  text = text.replace(
    /^(?:вот\s+)?(?:весь\s+)?(?:видимый\s+)?текст[^:\n]{0,40}:\s*/i,
    "",
  );
  if (/^(нет текста|текста нет|no text)\.?$/i.test(text.trim())) return "";
  return text.trim().slice(0, OCR_MAX_CHARS);
}

/** Transcribe an uploaded image. Never throws — callers show the message. */
export async function readPasteEnrichImageText(
  file: File,
): Promise<PasteEnrichImageText> {
  let dataUrl: string;
  try {
    const raw = Buffer.from(await file.arrayBuffer());
    const jpeg = await sharp(raw, { failOn: "none" })
      .rotate()
      .resize({
        width: OCR_MAX_EDGE,
        height: OCR_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: OCR_JPEG_QUALITY })
      .toBuffer();
    dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return { ok: false, message: "Не удалось прочитать изображение." };
  }

  try {
    const result = await completeVisionWithFailover(PROMPT, dataUrl);
    return {
      ok: true,
      text: stripModelChatter(result.content),
      modelUsed: result.modelUsed,
    };
  } catch {
    return { ok: false, message: "Не удалось распознать текст на фото." };
  }
}
