export type ImportSourceStats = {
  imported: number;
  inReview: number;
  approved: number;
  rejected: number;
  error: number;
  /** Max created_at / updated_at among rows for this source */
  lastActivityAt: string | null;
  /** Derived pipeline status for display */
  importStatus: "idle" | "in_review" | "complete" | "has_errors";
};

export const IMPORT_STATUS_LABELS: Record<
  ImportSourceStats["importStatus"],
  string
> = {
  idle: "Нет данных",
  in_review: "Есть в Inbox",
  complete: "Просмотрено",
  has_errors: "Есть ошибки",
};

export function emptyImportSourceStats(): ImportSourceStats {
  return {
    imported: 0,
    inReview: 0,
    approved: 0,
    rejected: 0,
    error: 0,
    lastActivityAt: null,
    importStatus: "idle",
  };
}

export function deriveImportStatus(
  stats: Omit<ImportSourceStats, "importStatus">,
): ImportSourceStats["importStatus"] {
  if (stats.error > 0) return "has_errors";
  if (stats.inReview > 0) return "in_review";
  if (stats.imported > 0 && stats.inReview === 0) return "complete";
  return "idle";
}
