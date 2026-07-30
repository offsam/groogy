/**
 * One-shot: EN published events → RU description + keep original for toggle.
 * Usage: npx tsx scripts/events/backfill_event_translations.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { translateEventCopyToRu } from "@/lib/events/translate-event";

function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i);
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function mostlyLatin(text: string): boolean {
  const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (letters.length < 20) return false;
  const cyr = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  return cyr / letters.length < 0.35;
}

async function main() {
  loadEnvFile();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("events")
    .select(
      "id, slug, title, description, description_original, source_language",
    )
    .eq("status", "published")
    .limit(100);
  if (error) throw error;

  let done = 0;
  for (const row of data ?? []) {
    const desc = (row.description || "").trim();
    const orig = (row.description_original || "").trim();
    if (orig && orig !== desc) continue;
    if (!desc || !mostlyLatin(desc)) continue;

    console.log("translate", row.slug);
    const t = await translateEventCopyToRu({
      title: row.title,
      description: desc,
    });
    if (t.detectedLanguage === "ru") {
      console.log("  skip: detected ru");
      continue;
    }

    const { error: upErr } = await sb
      .from("events")
      .update({
        description: t.descriptionRu || desc,
        description_original: t.descriptionOriginal || desc,
        title: t.titleRu || row.title,
        title_original: t.titleOriginal || row.title,
        source_language:
          t.detectedLanguage === "unknown" ? "en" : t.detectedLanguage,
      })
      .eq("id", row.id);
    if (upErr) {
      console.error("  fail", upErr.message);
      continue;
    }
    done += 1;
    console.log("  ok", t.detectedLanguage, t.modelUsed);
  }
  console.log("translated", done);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
