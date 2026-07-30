import {
  IMPORT_PREVIEW_KIND_HINTS,
  IMPORT_PREVIEW_KIND_LABELS,
  type ImportPreviewKind,
} from "@/lib/import-review/preview-section";

/** Chip above an admin preview card: which public section it will land in. */
export function PreviewSectionBadge({ kind }: { kind: ImportPreviewKind }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-brand-blue/20 bg-brand-blue/5 px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep">
        {IMPORT_PREVIEW_KIND_LABELS[kind]}
      </span>
      <span className="text-[11px] text-slate-500">
        {IMPORT_PREVIEW_KIND_HINTS[kind]}
      </span>
    </div>
  );
}
