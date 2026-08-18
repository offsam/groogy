import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  catalogCardSlug,
  hasCyrillic,
  nextAvailableSlug,
  slugHasSourceNoise,
} from "@/lib/routing/ascii-slug";
import { mergeSlugAlias } from "@/lib/routing/slug-lookup";

type Kind = "business" | "professional" | "church" | "event" | "job";

const TABLES: Record<
  Kind,
  { table: string; nameCol: string; fallback: string }
> = {
  business: { table: "businesses", nameCol: "name", fallback: "business" },
  professional: {
    table: "professionals",
    nameCol: "display_name",
    fallback: "professional",
  },
  church: { table: "churches", nameCol: "name", fallback: "church" },
  event: { table: "events", nameCol: "title", fallback: "event" },
  job: { table: "jobs", nameCol: "title", fallback: "job" },
};

function hasWebsiteCol(kind: Kind): boolean {
  return kind === "business" || kind === "professional" || kind === "church";
}

function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as unknown as SupabaseClient<any>;
}

export type RelatinizeSlugsResult = {
  kind: Kind;
  scanned: number;
  updated: number;
  skipped: number;
  samples: Array<{ id: string; from: string; to: string }>;
};

export async function relatinizeKindSlugs(
  client: SupabaseClient,
  kind: Kind,
): Promise<RelatinizeSlugsResult> {
  const meta = TABLES[kind];
  const db = untyped(client);
  const websiteCol = hasWebsiteCol(kind) ? ", website" : "";
  const { data, error } = await db
    .from(meta.table)
    .select(`id, slug, ${meta.nameCol}${websiteCol}, slug_aliases`)
    .limit(20_000);
  if (error) throw new Error(error.message);

  // The select string is built dynamically (per-kind column name), so the
  // postgrest-js literal-string select parser can't infer a real row type
  // here and produces a ParserError type — go through `unknown` first, same
  // as the untyped() cast above already does for the client itself.
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    slug: string;
    website?: string | null;
    slug_aliases?: string[] | null;
    [key: string]: unknown;
  }>;

  const taken = new Set(
    rows.map((r) => String(r.slug || "").trim()).filter(Boolean),
  );
  const samples: RelatinizeSlugsResult["samples"] = [];
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const current = String(row.slug || "").trim();
    if (!current || (!hasCyrillic(current) && !slugHasSourceNoise(current))) {
      skipped += 1;
      continue;
    }
    const name = String(row[meta.nameCol] || "").trim();
    const desired = catalogCardSlug({
      name,
      currentSlug: current,
      website: row.website ?? null,
      fallback: meta.fallback,
    });
    taken.delete(current);
    const next = nextAvailableSlug(desired, taken, current);
    taken.add(next);
    if (next === current) {
      skipped += 1;
      continue;
    }
    const aliases = mergeSlugAlias(row.slug_aliases, current, next);
    const { error: updError } = await db
      .from(meta.table)
      .update({
        slug: next,
        slug_aliases: aliases,
      })
      .eq("id", row.id);
    if (updError) throw new Error(updError.message);
    updated += 1;
    if (samples.length < 12) {
      samples.push({ id: row.id, from: current, to: next });
    }
  }

  return {
    kind,
    scanned: rows.length,
    updated,
    skipped,
    samples,
  };
}

export async function relatinizeAllPublishedSlugs(
  client: SupabaseClient,
): Promise<RelatinizeSlugsResult[]> {
  const kinds: Kind[] = [
    "business",
    "professional",
    "church",
    "event",
    "job",
  ];
  const out: RelatinizeSlugsResult[] = [];
  for (const kind of kinds) {
    out.push(await relatinizeKindSlugs(client, kind));
  }
  return out;
}
