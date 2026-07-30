"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { saveCommentRecommendationFieldsAction } from "@/lib/import-review/recommendation-actions";
import type { ReviewWorkspaceTask } from "@/lib/admin/review-workspace/types";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";

type Props = {
  task: ReviewWorkspaceTask;
};

export function ReviewWorkspaceEditPanel({ task }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const item =
    task.payload.kind === "recommendation" ||
    task.payload.kind === "event_verification"
      ? task.payload.item
      : null;

  const [displayName, setDisplayName] = useState(item?.display_name ?? "");
  const [city, setCity] = useState(item?.city ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [eventAt, setEventAt] = useState(item?.event_at ?? "");
  const [addressLine, setAddressLine] = useState(item?.address_line ?? "");
  const [venueName, setVenueName] = useState(item?.venue_name ?? "");
  const [priceLabel, setPriceLabel] = useState(item?.price_label ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [registrationUrl, setRegistrationUrl] = useState(
    item?.registration_url ?? "",
  );

  const backHref = reviewWorkspacePath(task.reviewType, task.sourceId);

  if (task.payload.kind === "ownership_claim") {
    const business = task.payload.business;
    return (
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Link href={backHref} className="text-sm text-brand-blue hover:underline">
          ← К Workspace
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Edit · Claim</h1>
        {business ? (
          <p className="text-sm text-slate-600">
            Редактор бизнеса открыт ниже. После сохранения вернитесь в Workspace.
          </p>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Бизнес для этой заявки не найден — правки карточки недоступны.
          </p>
        )}
      </div>
    );
  }

  if (!item) {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <Link href={backHref} className="text-sm text-brand-blue hover:underline">
          ← К Workspace
        </Link>
        <p className="text-sm text-slate-600">Редактор для этого типа пока Coming Soon.</p>
      </div>
    );
  }

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await saveCommentRecommendationFieldsAction({
        id: item!.id,
        displayName,
        city,
        notes,
        eventAt: task.reviewType === "event_verification" ? eventAt : undefined,
        addressLine:
          task.reviewType === "event_verification" ? addressLine : undefined,
        venueName:
          task.reviewType === "event_verification" ? venueName : undefined,
        priceLabel:
          task.reviewType === "event_verification" ? priceLabel : undefined,
        category:
          task.reviewType === "event_verification" ? category : undefined,
        registrationUrl:
          task.reviewType === "event_verification"
            ? registrationUrl
            : undefined,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message || "Сохранено");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="text-sm text-brand-blue hover:underline">
          ← К Workspace
        </Link>
        <p className="text-xs uppercase tracking-wide text-slate-400">
          Edit · {task.reviewType}
        </p>
      </div>
      <h1 className="text-xl font-bold text-slate-900">Редактирование</h1>
      <p className="text-sm text-slate-500">
        Поля рекомендации до публикации. После Approve правьте публичную карточку.
      </p>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <label className="block text-xs font-medium text-slate-500">
        Название
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
        />
      </label>
      <label className="block text-xs font-medium text-slate-500">
        Город
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
        />
      </label>
      {task.reviewType === "event_verification" ? (
        <>
          <label className="block text-xs font-medium text-slate-500">
            Дата / event_at (ISO или текст)
            <input
              value={eventAt}
              onChange={(e) => setEventAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Площадка (venue)
            <input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Адрес
            <input
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Цена
            <input
              value={priceLabel}
              onChange={(e) => setPriceLabel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Категория
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="festival, outdoors, family…"
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Registration URL
            <input
              value={registrationUrl}
              onChange={(e) => setRegistrationUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            />
          </label>
        </>
      ) : null}
      <label className="block text-xs font-medium text-slate-500">
        Заметка модератора
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={save}>
          Сохранить
        </Button>
        <Link href={backHref}>
          <Button type="button" variant="secondary">
            Готово
          </Button>
        </Link>
      </div>
    </div>
  );
}
