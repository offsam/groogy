"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  moveEntitySectionAction,
  type MoveSectionKey,
} from "@/lib/admin/move-entity-section";
import { PLATFORM_SECTIONS } from "@/lib/platform/sections";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const FROZEN: Partial<Record<string, string>> = {
  real_estate: "Таблица недвижимости заморожена (Phase 3).",
  vehicles: "Раздел авто заморожен (stub).",
};

const SECTION_OPTIONS: {
  key: MoveSectionKey | "vehicles";
  title: string;
  hint: string;
  disabled?: boolean;
  disabledReason?: string;
}[] = [
  ...PLATFORM_SECTIONS.map((s) => ({
    key: s.key as MoveSectionKey | "vehicles",
    title: s.title,
    hint: s.hint,
    disabled: Boolean(FROZEN[s.key]),
    disabledReason: FROZEN[s.key],
  })),
];

type Props = {
  fromSection: MoveSectionKey;
  entityId: string;
  title: string;
  open: boolean;
  onClose: () => void;
};

export function AdminLiveSectionPreviewModal({
  fromSection,
  entityId,
  title,
  open,
  onClose,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hub, setHub] = useState<MoveSectionKey | "vehicles">(fromSection);

  useEffect(() => {
    if (!open) return;
    setHub(fromSection);
    setError(null);
  }, [open, fromSection]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, pending]);

  if (!open) return null;

  const dirty = hub !== fromSection;
  const selected = SECTION_OPTIONS.find((o) => o.key === hub);
  const blocked = Boolean(selected?.disabled);

  function onSave() {
    if (!dirty || pending || blocked) return;
    if (hub === "vehicles") {
      setError("Раздел авто заморожен.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await moveEntitySectionAction({
        fromSection,
        fromId: entityId,
        toSection: hub,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onClose();
      router.push(res.redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[1200] flex flex-col bg-slate-950/50">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Сменить раздел
          </p>
          <p className="truncate text-base font-semibold text-slate-900">
            {title}
          </p>
        </div>
        <button
          aria-label="Закрыть"
          className="inline-flex size-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          type="button"
          onClick={() => !pending && onClose()}
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <p className="mb-3 text-sm text-slate-600">
          Выберите раздел платформы. Карточка будет пересоздана в новом разделе,
          старая — в архиве; старый адрес получит редирект.
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SECTION_OPTIONS.map((opt) => {
            const active = hub === opt.key;
            return (
              <li key={opt.key}>
                <button
                  className={cn(
                    "flex min-h-11 w-full flex-col items-start rounded-xl border px-3 py-2.5 text-left transition",
                    active
                      ? "border-brand-blue bg-brand-blue/5 ring-1 ring-brand-blue/30"
                      : "border-slate-200 bg-white hover:border-slate-300",
                    opt.disabled && "cursor-not-allowed opacity-50",
                  )}
                  disabled={opt.disabled || pending}
                  type="button"
                  onClick={() => setHub(opt.key)}
                >
                  <span className="text-sm font-semibold text-slate-900">
                    {opt.title}
                  </span>
                  <span className="text-xs text-slate-500">
                    {opt.disabledReason || opt.hint}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
        <Button
          disabled={pending}
          type="button"
          variant="secondary"
          onClick={onClose}
        >
          Отмена
        </Button>
        <Button
          disabled={!dirty || pending || blocked}
          type="button"
          onClick={onSave}
        >
          {pending ? (
            <>
              <BrandPinLoader size="sm" />
              Переносим…
            </>
          ) : (
            "Перенести"
          )}
        </Button>
      </div>
    </div>
  );
}
