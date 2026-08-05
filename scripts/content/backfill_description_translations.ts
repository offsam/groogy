/**
 * EN → RU backfill for published entities + pending import_review_items.
 * Self-contained (no server-only imports) so it runs under `npx tsx`.
 *
 * Usage:
 *   npx tsx scripts/content/backfill_description_translations.ts --dry-run
 *   npx tsx scripts/content/backfill_description_translations.ts --apply --limit=50
 *   npx tsx scripts/content/backfill_description_translations.ts --apply --only=import_review_items
 *   npx tsx scripts/content/backfill_description_translations.ts --apply --id=c87cfdb6-034d-4db2-8af0-e3f9192840a7
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

type Target =
  | "businesses"
  | "professionals"
  | "jobs"
  | "listings"
  | "events"
  | "import_review_items";

const ALL_TARGETS: Target[] = [
  "import_review_items",
  "professionals",
  "businesses",
  "jobs",
  "listings",
  "events",
];

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

function parseArgs(argv: string[]) {
  let apply = false;
  let limit = 40;
  let only: Target | null = null;
  let id: string | null = null;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a.startsWith("--limit="))
      limit = Math.max(1, Number(a.slice(8)) || 40);
    else if (a.startsWith("--only=")) only = a.slice(7) as Target;
    else if (a.startsWith("--id=")) id = a.slice(5);
  }
  return { apply, limit, only, id };
}

function looksMostlyCyrillic(text: string): boolean {
  const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (letters.length < 8) return false;
  const cyr = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  return cyr / letters.length >= 0.55;
}

function needsTranslationToRu(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (looksMostlyCyrillic(trimmed)) return false;
  const letters = trimmed.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  return letters.length >= 8;
}

async function translateCopyToRu(input: {
  title: string;
  description: string | null;
}): Promise<{
  titleRu: string;
  descriptionRu: string | null;
  titleOriginal: string;
  descriptionOriginal: string | null;
  detectedLanguage: "en" | "ru" | "mixed" | "unknown";
  modelUsed: string;
}> {
  const title = input.title.trim().slice(0, 200);
  const description = (input.description || "").trim().slice(0, 4000) || null;
  const blob = [title, description].filter(Boolean).join("\n");
  if (!blob) {
    return {
      titleRu: title,
      descriptionRu: description,
      titleOriginal: title,
      descriptionOriginal: description,
      detectedLanguage: "unknown",
      modelUsed: "none",
    };
  }
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

  const system = [
    "You translate directory listings for a Russian-speaking California community app (КРУГИ).",
    'Return ONLY JSON: {"titleRu":"...","descriptionRu":"..."|null,"detectedLanguage":"en"|"ru"|"mixed"|"unknown"}.',
    "Translate title and description into natural Russian. Keep proper nouns, brand names, venue names, street addresses, prices ($), and URLs unchanged.",
    "Do not add phones, emails, or calls-to-action that were not in the source.",
    "descriptionRu must be narrative only (no contact dump). If description is empty, return null.",
  ].join(" ");
  const user = JSON.stringify({ title: title || "—", description });

  async function callOpenRouter(model: string) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://krugi.app",
        "X-Title": "KRUGI translate backfill",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 180)}`);
    return { body, model };
  }

  async function callOpenAI(model: string) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY missing");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body.slice(0, 180)}`);
    return { body, model };
  }

  let raw = "";
  let modelUsed = "";
  const errors: string[] = [];
  for (const model of [
    process.env.OPENROUTER_TRANSLATE_MODEL || "openai/gpt-4.1-nano",
    "google/gemini-2.5-flash-lite",
  ]) {
    try {
      const r = await callOpenRouter(model);
      raw = r.body;
      modelUsed = r.model;
      break;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (!raw) {
    for (const model of ["gpt-4.1-nano", "gpt-4o-mini"]) {
      try {
        const r = await callOpenAI(model);
        raw = r.body;
        modelUsed = `openai-direct:${r.model}`;
        break;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }
  if (!raw) {
    throw new Error(`All translate providers failed: ${errors.join(" | ")}`);
  }

  const json = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const content = json.choices?.[0]?.message?.content || "{}";
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
    modelUsed: json.model || modelUsed,
  };
}

function titleOf(row: Record<string, unknown>, table: Target): string {
  if (table === "professionals") return String(row.display_name || "—");
  if (table === "businesses") return String(row.name || "—");
  if (table === "import_review_items") {
    return String(row.person_name || row.business_name || row.title || "—");
  }
  return String(row.title || "—");
}

function translateTitleFor(table: Target): boolean {
  return table === "events" || table === "jobs" || table === "listings";
}

async function processTable(
  sb: ReturnType<typeof createClient>,
  table: Target,
  opts: { apply: boolean; limit: number; id: string | null },
) {
  const selectCols =
    table === "professionals"
      ? "id, slug, display_name, description, description_original, status"
      : table === "businesses"
        ? "id, slug, name, description, description_original, status"
        : table === "import_review_items"
          ? "id, title, person_name, business_name, description, description_original, source_language, review_status, target_collection"
          : table === "events"
            ? "id, slug, title, description, description_original, title_original, source_language, status"
            : table === "listings"
              ? "id, title, description, description_original, status, listing_type"
              : "id, slug, title, description, description_original, status";

  let done = 0;
  let skipped = 0;
  const pageSize = Math.min(200, Math.max(opts.limit, 50));
  let offset = 0;

  while (done < opts.limit) {
    let q = sb.from(table).select(selectCols).range(offset, offset + pageSize - 1);
    if (opts.id) {
      q = sb.from(table).select(selectCols).eq("id", opts.id);
    } else if (table === "import_review_items") {
      q = q.in("review_status", [
        "pending",
        "in_review",
        "needs_more_info",
        "ready_to_publish",
      ]);
    } else if (table === "professionals" || table === "businesses") {
      q = q.eq("status", "approved").order("updated_at", { ascending: false });
    } else if (table === "events" || table === "jobs") {
      q = q.eq("status", "published").order("updated_at", { ascending: false });
    } else if (table === "listings") {
      q = q.eq("status", "active").order("updated_at", { ascending: false });
    }

    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (done >= opts.limit) break;

      const desc = String(row.description || "").trim();
      const orig = String(row.description_original || "").trim();
      if (orig && orig !== desc && !needsTranslationToRu(desc)) {
        skipped += 1;
        continue;
      }
      if (!desc || !needsTranslationToRu(desc)) {
        skipped += 1;
        continue;
      }

      const title = titleOf(row, table);
      console.log(
        `[${table}] translate`,
        opts.id || row.slug || row.id,
        title.slice(0, 40),
      );

      const t = await translateCopyToRu({ title, description: desc });
      const outDesc = (t.descriptionRu || desc).trim();
      if (
        t.detectedLanguage === "ru" &&
        looksMostlyCyrillic(desc) &&
        looksMostlyCyrillic(outDesc)
      ) {
        console.log("  skip: already ru");
        skipped += 1;
        continue;
      }
      if (!outDesc || outDesc === desc) {
        console.log("  skip: translator returned same text");
        skipped += 1;
        continue;
      }

      const patch: Record<string, unknown> = {
        description: outDesc,
        description_original: t.descriptionOriginal || desc,
      };
      if (table === "import_review_items") {
        patch.source_language =
          t.detectedLanguage === "unknown" ? "en" : t.detectedLanguage;
      }
      if (table === "events" && translateTitleFor(table)) {
        patch.title = t.titleRu || title;
        patch.title_original = t.titleOriginal || title;
        patch.source_language =
          t.detectedLanguage === "unknown" ? "en" : t.detectedLanguage;
      }
      if ((table === "jobs" || table === "listings") && translateTitleFor(table)) {
        patch.title = t.titleRu || title;
      }
      if (table === "professionals" || table === "businesses") {
        const ru = String(t.descriptionRu || desc);
        patch.short_description = ru.slice(0, table === "businesses" ? 240 : 280);
      }

      if (!opts.apply) {
        console.log("  dry-run", t.detectedLanguage, t.modelUsed);
        console.log("  ru preview:", String(t.descriptionRu || "").slice(0, 120));
        done += 1;
        continue;
      }

      const { error: upErr } = await sb.from(table).update(patch).eq("id", row.id);
      if (upErr) {
        console.error("  fail", upErr.message);
        continue;
      }
      done += 1;
      console.log("  ok", t.detectedLanguage, t.modelUsed);
    }

    if (opts.id) break;
    offset += pageSize;
    if (rows.length < pageSize) break;
  }

  console.log(`[${table}] done=${done} skipped=${skipped}`);
  return { done, skipped };
}

async function main() {
  loadEnvFile();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const opts = parseArgs(process.argv.slice(2));
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const targets = opts.only
    ? [opts.only]
    : opts.id
      ? ALL_TARGETS
      : ALL_TARGETS;

  console.log(
    opts.apply ? "APPLY" : "DRY-RUN",
    "targets=",
    targets.join(","),
    "limit=",
    opts.limit,
  );

  let total = 0;
  for (const table of targets) {
    if (opts.id) {
      const { data } = await sb
        .from(table)
        .select("id")
        .eq("id", opts.id)
        .maybeSingle();
      if (!data) continue;
    }
    const r = await processTable(sb, table, opts);
    total += r.done;
    if (opts.id && r.done + r.skipped > 0) break;
  }
  console.log("total translated/candidates", total);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
