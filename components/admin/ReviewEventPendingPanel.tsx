"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  structureEventRecommendationAction,
  translateEventRecommendationAction,
} from "@/lib/import-review/recommendation-actions";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import {
  EVENT_CATEGORY_LABELS_RU,
  type EventCategory,
} from "@/lib/events/categories";

type Props = {
  item: CommentRecommendation;
};

export function ReviewEventPendingPanel({ item }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: "structure" | "translate") {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result =
        action === "structure"
          ? await structureEventRecommendationAction({ id: item.id })
          : await translateEventRecommendationAction({ id: item.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message || "Готово.");
      router.refresh();
    });
  }

  const category = (item.category || "") as EventCategory | "";
  const categoryLabel =
    category && category in EVENT_CATEGORY_LABELS_RU
      ? EVENT_CATEGORY_LABELS_RU[category as EventCategory]
      : item.category || "—";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">
          Событие — ждут выкладки
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Structure (разбор + перевод EN→RU) → Approve. На сайт не попадает без
          Approve. Translate — если нужно перевести ещё раз.
        </p>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Источник</dt>
          <dd className="font-medium text-slate-900">
            {item.external_source || item.source_channel || "—"}
            {item.external_id ? (
              <span className="ml-1 font-normal text-slate-500">
                #{item.external_id}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Язык</dt>
          <dd className="text-slate-800">{item.source_language || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Когда</dt>
          <dd className="text-slate-800">
            {item.event_at || item.starts_at || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Категория</dt>
          <dd className="text-slate-800">{categoryLabel}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">Где</dt>
          <dd className="text-slate-800">
            {[item.venue_name, item.address_line, item.city]
              .filter(Boolean)
              .join(" · ") || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Цена</dt>
          <dd className="text-slate-800">{item.price_label || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Регистрация</dt>
          <dd className="truncate text-slate-800">
            {item.registration_url || "—"}
          </dd>
        </div>
        {item.title_original ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-500">Оригинал названия</dt>
            <dd className="text-slate-700">{item.title_original}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => run("structure")}
        >
          Structure
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => run("translate")}
        >
          Translate EN→RU
        </Button>
      </div>

      {message ? (
        <p className="text-sm text-emerald-700">{message}</p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
