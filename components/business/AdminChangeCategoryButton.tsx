"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tags } from "lucide-react";
import { SectionEditDialog } from "@/components/business/profile/edit/SectionEditDialog";
import { adminSetBusinessCategoryAction } from "@/lib/business/admin-actions";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/business";

type AdminChangeCategoryButtonProps = {
  businessId: string;
  businessSlug: string;
  currentCategoryId: string | null;
  categories: Category[];
  className?: string;
};

export function AdminChangeCategoryButton({
  businessId,
  businessSlug,
  currentCategoryId,
  categories,
  className,
}: AdminChangeCategoryButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState(currentCategoryId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategoryId(currentCategoryId ?? "");
      setError(null);
    }
  }, [open, currentCategoryId]);

  function onSave() {
    const next = categoryId.trim() || null;
    if (next === (currentCategoryId ?? null)) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await adminSetBusinessCategoryAction({
        businessId,
        categoryId: next,
        slug: businessSlug,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (categories.length === 0) return null;

  return (
    <>
      <button
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50",
          className,
        )}
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
        onSave={onSave}
      >
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Категория каталога</span>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-blue"
            disabled={pending}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Без категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-slate-500">
            Карточка сразу появится в выбранной категории каталога.
          </span>
        </label>
      </SectionEditDialog>
    </>
  );
}
