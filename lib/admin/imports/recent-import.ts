/** Treat an import row as "new" when created within the last N days. */
export const RECENT_IMPORT_DAYS = 3;

export function isRecentlyImported(
  createdAt: string | null | undefined,
  days: number = RECENT_IMPORT_DAYS,
  nowMs: number = Date.now(),
): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= days * 24 * 60 * 60 * 1000;
}

export function formatImportPulledAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
