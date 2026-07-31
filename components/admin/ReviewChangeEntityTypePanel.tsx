"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { saveImportReviewItemAction } from "@/lib/import-review/actions";
import {
  ENTITY_TO_COLLECTION,
  routeCard,
  routeHintLabel,
} from "@/lib/import-review/entity-routing";
import type {
  ImportReviewEntityType,
  ImportReviewItem,
  ImportReviewTargetCollection,
} from "@/types/import-review";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS: {
  entityType: ImportReviewEntityType;
  label: string;
}[] = [
  { entityType: "business", label: "Бизнес" },
  { entityType: "private_specialist", label: "Специалист" },
  { entityType: "marketplace_listing", label: "Купи-продай" },
  { entityType: "job", label: "Работа" },
  { entityType: "event", label: "Событие" },
  { entityType: "lechu_listing", label: "Лечу" },
  { entityType: "transfer_listing", label: "Переводы" },
  { entityType: "organization", label: "Организация" },
  { entityType: "real_estate", label: "Недвижимость (заморожена)" },
];

type Props = {
  item: ImportReviewItem;
};

export function ReviewChangeEntityTypePanel({ item }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<ImportReviewEntityType | "">(
    item.entity_type || "",
  );

  const hint = useMemo(() => {
    const hasContact = Boolean(
      (item.phone?.length || 0) > 0 ||
        (item.website?.length || 0) > 0 ||
        (item.instagram?.length || 0) > 0 ||
        item.telegram_username ||
        item.telegram_user_id,
    );
    return routeCard({
      text: item.source_text || item.description || item.title,
      category: item.category,
      businessName: item.business_name,
      personName: item.person_name,
      classification: item.ai_decision,
      entityTypeHint: item.entity_type,
      hasContact,
      addressLine: item.address_line,
      postalCode: item.postal_code,
    });
  }, [item]);

  const hintLabel = routeHintLabel(hint);

  function applySuggested() {
    if (!hint.entityType) return;
    setEntityType(hint.entityType);
  }

  function onSave() {
    if (!entityType || pending) return;
    if (entityType === "real_estate") {
      setError("Недвижимость заморожена до Phase 3.");
      return;
    }
    const targetCollection: ImportReviewTargetCollection =
      ENTITY_TO_COLLECTION[entityType];
    setError(null);
    startTransition(async () => {
      const res = await saveImportReviewItemAction({
        id: item.id,
        fields: {
          entity_type: entityType,
          target_collection: targetCollection,
          // Reset leaf category when section changes — taxonomy differs per section.
          category: null,
          subcategory: null,
        },
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Change Entity Type
          </p>
          <p className="text-sm text-slate-700">
            Сейчас:{" "}
            <span className="font-medium">
              {item.entity_type || "не задан"} /{" "}
              {item.target_collection || "—"}
            </span>
          </p>
          {hintLabel ? (
            <p className="mt-0.5 text-xs text-brand-blue">
              Подсказка маршрутизатора: {hintLabel}
            </p>
          ) : null}
        </div>
        <Button
          className="px-3 py-1.5 text-xs"
          type="button"
          variant="secondary"
          onClick={() => setOpen((v) => !v)}
        >
          <Layers className="size-3.5" />
          {open ? "Скрыть" : "Сменить тип"}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {TYPE_OPTIONS.map((opt) => {
              const active = entityType === opt.entityType;
              const frozen = opt.entityType === "real_estate";
              return (
                <li key={opt.entityType}>
                  <button
                    className={cn(
                      "flex min-h-10 w-full items-center rounded-lg border px-3 py-2 text-left text-sm transition",
                      active
                        ? "border-brand-blue bg-brand-blue/5 font-medium"
                        : "border-slate-200 hover:border-slate-300",
                      frozen && "opacity-50",
                    )}
                    disabled={frozen || pending}
                    type="button"
                    onClick={() => setEntityType(opt.entityType)}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
          {hint.entityType ? (
            <button
              className="text-xs font-medium text-brand-blue hover:underline"
              type="button"
              onClick={applySuggested}
            >
              Применить подсказку ({hint.entityType})
            </button>
          ) : null}
          {error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              className="px-3 py-1.5 text-xs"
              disabled={pending}
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              className="px-3 py-1.5 text-xs"
              disabled={!entityType || pending || entityType === item.entity_type}
              type="button"
              onClick={onSave}
            >
              {pending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Сохраняем…
                </>
              ) : (
                "Сохранить тип"
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
