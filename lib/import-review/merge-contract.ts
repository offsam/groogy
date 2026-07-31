/**
 * Catalog merge contract (R01):
 * - fill-empty / union only — never overwrite non-empty keep fields
 * - donor is destroyed (hard delete), not left as archived public ghost
 * - merge never auto-publishes (status stays; approve is separate)
 */

export function isEmptyMergeValue(v: unknown): boolean {
  return v == null || (typeof v === "string" && !v.trim());
}

/** Copy drop → keep only when keep is empty. */
export function fillEmptyField(
  keep: Record<string, unknown>,
  drop: Record<string, unknown>,
  keepKey: string,
  dropKey: string = keepKey,
): unknown | undefined {
  const cur = keep[keepKey];
  const next = drop[dropKey];
  if (isEmptyMergeValue(cur) && !isEmptyMergeValue(next)) return next;
  return undefined;
}

/** Prefer longer non-empty text without replacing a shorter keep if keep exists. */
export function preferLongerText(
  keep: string | null | undefined,
  drop: string | null | undefined,
): string | undefined {
  const k = (keep || "").trim();
  const d = (drop || "").trim();
  if (!k && d) return d;
  return undefined;
}
