"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { SectionEditDialog } from "@/components/business/profile/edit/SectionEditDialog";
import { addProfessionalServiceAction } from "@/lib/professional/actions";
import { cn } from "@/lib/utils";

type Props = {
  professionalId: string;
  slug: string;
  className?: string;
  /** Compact round + button */
  variant?: "chip" | "icon";
};

export function AddProfessionalServiceButton({
  professionalId,
  slug,
  className,
  variant = "chip",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMode, setPriceMode] = useState<"contact" | "from" | "fixed" | "free">(
    "contact",
  );
  const [priceAmount, setPriceAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPriceMode("contact");
      setPriceAmount("");
      setError(null);
    }
  }, [open]);

  function onSave() {
    setError(null);
    const amount =
      priceMode === "fixed" || priceMode === "from"
        ? Number(priceAmount.replace(",", "."))
        : null;
    if (
      (priceMode === "fixed" || priceMode === "from") &&
      (amount == null || !Number.isFinite(amount) || amount < 0)
    ) {
      setError("Укажите цену.");
      return;
    }
    startTransition(async () => {
      const result = await addProfessionalServiceAction({
        professionalId,
        slug,
        title,
        description,
        priceMode,
        priceAmount: amount,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        className={cn(
          variant === "icon"
            ? "inline-flex size-9 items-center justify-center rounded-xl border border-brand-blue/30 bg-brand-blue/5 text-brand-blue-deep transition hover:bg-brand-blue/10"
            : "inline-flex items-center gap-1 rounded-full border border-brand-blue/30 bg-brand-blue/5 px-2.5 py-1 text-xs font-medium text-brand-blue-deep transition hover:bg-brand-blue/10",
          className,
        )}
        type="button"
        aria-label="Добавить услугу"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden className="size-3.5" />
        {variant === "chip" ? "Услуга" : null}
      </button>

      <SectionEditDialog
        error={error}
        open={open}
        pending={pending}
        title="Новая услуга"
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        onSave={onSave}
      >
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Название</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
              disabled={pending}
              placeholder="Например: Консультация"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Описание</span>
            <textarea
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
              disabled={pending}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Цена</span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
              disabled={pending}
              value={priceMode}
              onChange={(e) =>
                setPriceMode(e.target.value as typeof priceMode)
              }
            >
              <option value="contact">Цену уточняйте</option>
              <option value="from">От суммы</option>
              <option value="fixed">Фиксированная</option>
              <option value="free">Бесплатно</option>
            </select>
          </label>
          {priceMode === "from" || priceMode === "fixed" ? (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Сумма, USD</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                disabled={pending}
                inputMode="decimal"
                placeholder="100"
                value={priceAmount}
                onChange={(e) => setPriceAmount(e.target.value)}
              />
            </label>
          ) : null}
        </div>
      </SectionEditDialog>
    </>
  );
}
