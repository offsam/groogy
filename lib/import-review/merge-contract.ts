/**
 * Catalog merge contract (system rules — not one-offs):
 *
 * R01 fill-empty / union only — never overwrite non-empty keep fields.
 * R01 donor is destroyed (hard delete); archive only if FK blocks delete.
 * R01 merge never auto-publishes (archived → pending at most; Approve separate).
 *
 * R15 catalog target pick (merge-all / phone clusters):
 *   approved(+phone) ≫ approved ≫ pending ≫ archived
 *   Across business + professional candidates, pick ONE richest live target.
 *   Never prefer an archived business over an approved professional (same phone).
 *   Same score → prefer professional (ad/leasing lines often live as specialists).
 *
 * R16 public href:
 *   Only `approved` entities have a public /business|/professional URL.
 *   Pending/archived → no public redirect (avoids moderator 404 after merge).
 *
 * Shared-phone / ad accounts: one keeper absorbs donors (contacts, copy, media)
 * via fill-empty — do not mint parallel profiles for Katia/Viktor/Оксана masks.
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

/** Public catalog listing — only approved is on the open site. */
export function isPubliclyListedStatus(
  status: string | null | undefined,
): boolean {
  return String(status || "").trim() === "approved";
}

export type CatalogMergeKind = "business" | "professional";

export type CatalogMergeCandidate = {
  kind: CatalogMergeKind;
  id: string;
  title: string | null;
  slug: string | null;
  status: string;
  phone: string | null;
};

/**
 * Higher = better merge-all target.
 * Live approved always beats pending/archived so we do not resurrect ghosts.
 */
export function catalogMergeTargetScore(
  status: string | null | undefined,
  phone: string | null | undefined,
): number {
  const s = String(status || "").trim();
  const hasPhone = Boolean(String(phone || "").trim());
  if (s === "approved") return hasPhone ? 100 : 90;
  if (s === "pending") return hasPhone ? 50 : 40;
  if (s === "archived") return hasPhone ? 20 : 10;
  return 0;
}

/** Sort comparator: best target first. */
export function compareCatalogMergeTargets(
  a: CatalogMergeCandidate,
  b: CatalogMergeCandidate,
): number {
  const scoreDiff =
    catalogMergeTargetScore(b.status, b.phone) -
    catalogMergeTargetScore(a.status, a.phone);
  if (scoreDiff !== 0) return scoreDiff;
  if (a.kind !== b.kind) {
    return a.kind === "professional" ? -1 : 1;
  }
  return 0;
}

/** Pick the single catalog entity merge-all should enrich. */
export function pickBestCatalogMergeTarget(
  candidates: CatalogMergeCandidate[],
): CatalogMergeCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort(compareCatalogMergeTargets)[0] ?? null;
}

/**
 * UI / preview ordering for duplicate hits.
 * Lower = show first. Approved catalog before pending before archived.
 */
export function duplicateMatchListRank(input: {
  kind: string;
  status?: string | null;
}): number {
  const status = String(input.status || "").trim();
  if (input.kind === "business" || input.kind === "professional") {
    if (status === "approved") return 0;
    if (status === "pending") return 1;
    if (status === "archived") return 3;
    return 2;
  }
  if (input.kind === "import_item") return 4;
  if (input.kind === "recommendation") return 5;
  return 6;
}
