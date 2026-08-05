"use client";

import { useEffect, useState, useTransition } from "react";
import { Tags } from "lucide-react";
import { SectionEditDialog } from "@/components/business/profile/edit/SectionEditDialog";
import { cn } from "@/lib/utils";
import type { ReviewCategoryOption } from "@/lib/import-review/category-options";

type Props = {
  categories: ReviewCategoryOption[];
  /** Current category slug on the queue row. */
  currentSlug: string | null;
  disabled?: boolean;
  onSave: (slug: string | null) => Promise<{ ok: boolean; message?: string }>;
  className?: string;
};

/**
 * Same chip + dialog as live AdminChangeCategoryButton, but writes the
 * queue row (slug) instead of a published business id.
 */
export function AdminQueueCategoryButton({
  categories,
  currentSlug,
  disabled = false,
  onSave,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(currentSlug ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSlug(currentSlug ?? "");
      setError(null);
    }
  }, [open, currentSlug]);

  if (categories.length === 0) return null;

  function save() {
    const next = slug.trim() || null;
    if (next === (currentSlug ?? null)) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setError(result.message || "Не удалось сохранить");
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50",
          className,
        )}
        disabled={disabled}
        type="button"
        onClick={() => setOpen(true)}
      >
        <Tags aria-hidden="true" className="size-3.5" />
        Категория
      </button>

      <SectionEditDialog
        error={error}
        open={open}
        pending={pending}
        title="Сменить категорию"
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        onSave={save}
      >
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Категория каталога</span>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-blue"
            disabled={pending}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            <option value="">Без категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-slate-500">
            После публикации карточка попадёт в эту категорию.
          </span>
        </label>
      </SectionEditDialog>
    </>
  );
}
