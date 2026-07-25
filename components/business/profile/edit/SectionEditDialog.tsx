"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

type SectionEditDialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  pending?: boolean;
  error?: string | null;
  children: ReactNode;
};

export function SectionEditDialog({
  open,
  title,
  onClose,
  onSave,
  pending = false,
  error = null,
  children,
}: SectionEditDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
      <button
        aria-label="Закрыть"
        className="absolute inset-0 cursor-default"
        type="button"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900" id={titleId}>
            {title}
          </h2>
          <button
            aria-label="Закрыть"
            className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {error ? (
          <p className="px-4 pb-2 text-sm text-red-600">{error}</p>
        ) : null}
        <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
          <Button
            className="flex-1"
            disabled={pending}
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Отмена
          </Button>
          <Button
            className="flex-1"
            disabled={pending}
            type="button"
            onClick={onSave}
          >
            {pending ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  );
}
