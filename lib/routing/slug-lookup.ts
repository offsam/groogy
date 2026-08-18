import { normalizeRouteSlug } from "@/lib/routing/normalize-route-slug";

type QueryClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Current slug first, then slug_aliases (old Cyrillic URLs after relatinize).
 */
export async function fetchRowBySlugOrAlias<T>(input: {
  client: QueryClient;
  table: string;
  select: string;
  slug: string;
  extraEq?: Array<[string, string]>;
}): Promise<T | null> {
  const normalized = normalizeRouteSlug(input.slug);
  if (!normalized) return null;

  let q = input.client.from(input.table).select(input.select).eq("slug", normalized);
  for (const [col, val] of input.extraEq ?? []) q = q.eq(col, val);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) return data as T;

  try {
    let aliasQ = input.client
      .from(input.table)
      .select(input.select)
      .contains("slug_aliases", [normalized]);
    for (const [col, val] of input.extraEq ?? []) aliasQ = aliasQ.eq(col, val);
    const alias = await aliasQ.maybeSingle();
    if (alias.error) return null;
    return (alias.data as T | null) ?? null;
  } catch {
    return null;
  }
}

export async function resolveCanonicalSlug(
  client: QueryClient,
  table: string,
  slug: string,
): Promise<string | null> {
  const normalized = normalizeRouteSlug(slug);
  if (!normalized) return null;
  const { data } = await client
    .from(table)
    .select("slug")
    .eq("slug", normalized)
    .maybeSingle();
  if (data?.slug) return String(data.slug);
  try {
    const alias = await client
      .from(table)
      .select("slug")
      .contains("slug_aliases", [normalized])
      .maybeSingle();
    return alias.data?.slug ? String(alias.data.slug) : null;
  } catch {
    return null;
  }
}

export function mergeSlugAlias(
  currentAliases: unknown,
  previousSlug: string | null | undefined,
  nextSlug: string,
): string[] {
  const aliases = Array.isArray(currentAliases)
    ? currentAliases.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const prev = String(previousSlug || "").trim();
  if (prev && prev !== nextSlug && !aliases.includes(prev)) aliases.push(prev);
  return [...new Set(aliases.filter((a) => a !== nextSlug))];
}
