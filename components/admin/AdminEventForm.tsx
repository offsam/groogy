"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  adminSetEventStatusAction,
  adminUpdateEventAction,
} from "@/lib/events/admin-actions";
import { EVENT_REGIONS } from "@/lib/events/regions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";

export type AdminEventFormInitial = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  city: string | null;
  address_line: string | null;
  venue_name: string | null;
  starts_at: string | null;
  event_at_label: string | null;
  registration_url: string | null;
  phone: string | null;
  telegram_url: string | null;
  price_label: string | null;
  format: "online" | "offline" | "hybrid" | "unknown" | string | null;
  status: "draft" | "published" | "archived" | string;
  state_code: string | null;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminEventForm({ initial }: { initial: AdminEventFormInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [format, setFormat] = useState<
    "online" | "offline" | "hybrid" | "unknown"
  >(
    initial.format === "online" ||
      initial.format === "offline" ||
      initial.format === "hybrid"
      ? initial.format
      : "unknown",
  );
  const [dateUnknown, setDateUnknown] = useState(
    !initial.starts_at ||
      initial.event_at_label === "Дата уточняется",
  );
  const [status, setStatus] = useState<"draft" | "published" | "archived">(
    initial.status === "draft" || initial.status === "archived"
      ? initial.status
      : "published",
  );

  const addressRequired = format === "offline" || format === "hybrid";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await adminUpdateEventAction({
        id: initial.id,
        title: String(fd.get("title") || ""),
        description: String(fd.get("description") || ""),
        city: String(fd.get("city") || ""),
        addressLine: String(fd.get("addressLine") || ""),
        venueName: String(fd.get("venueName") || ""),
        startsAt: dateUnknown ? undefined : String(fd.get("startsAt") || ""),
        dateUnknown,
        registrationUrl: String(fd.get("registrationUrl") || ""),
        phone: String(fd.get("phone") || ""),
        telegramUrl: String(fd.get("telegramUrl") || ""),
        priceLabel: String(fd.get("priceLabel") || ""),
        format,
        status,
        stateCode: String(fd.get("stateCode") || ""),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Сохранено.");
      router.refresh();
    });
  }

  function onQuickStatus(next: "published" | "archived") {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await adminSetEventStatusAction({
        id: initial.id,
        status: next,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setStatus(next);
      setMessage(result.message ?? "Готово.");
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      <p className="text-sm text-slate-500">
        Публичная страница:{" "}
        <Link
          href={`/events/${initial.slug}`}
          className="text-brand-blue hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          /events/{initial.slug}
        </Link>
      </p>

      <div className="flex flex-wrap gap-2">
        {status !== "archived" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => onQuickStatus("archived")}
          >
            В архив
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => onQuickStatus("published")}
          >
            Вернуть на сайт
          </Button>
        )}
        <Link
          href="/admin/catalog/events"
          className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          ← К каталогу
        </Link>
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Название</span>
        <input
          name="title"
          required
          minLength={3}
          maxLength={160}
          defaultValue={initial.title}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Описание</span>
        <textarea
          name="description"
          rows={5}
          maxLength={8000}
          defaultValue={initial.description ?? ""}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
        />
        <span className="text-xs text-slate-500">
          Телефон и адрес лучше в полях ниже, не в тексте.
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Город / регион</span>
          <select
            name="city"
            defaultValue={initial.city ?? ""}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
          >
            <option value="">Не указан</option>
            {EVENT_REGIONS.map((r) => (
              <option key={r.id} value={r.city}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Штат (код)</span>
          <input
            name="stateCode"
            maxLength={16}
            placeholder="US-CA"
            defaultValue={initial.state_code ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={dateUnknown}
          onChange={(e) => setDateUnknown(e.target.checked)}
          className="size-4 rounded border-slate-300"
        />
        Дата уточняется
      </label>

      {!dateUnknown ? (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Дата и время</span>
          <input
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocalInput(initial.starts_at)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Формат</span>
          <select
            name="format"
            value={format}
            onChange={(e) =>
              setFormat(
                e.target.value as "online" | "offline" | "hybrid" | "unknown",
              )
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
          >
            <option value="unknown">Не указан</option>
            <option value="online">Онлайн</option>
            <option value="offline">Офлайн</option>
            <option value="hybrid">Гибрид</option>
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Статус</span>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as "draft" | "published" | "archived")
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
          >
            <option value="published">Опубликовано</option>
            <option value="draft">Черновик</option>
            <option value="archived">Архив</option>
          </select>
        </label>
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">
          Адрес площадки{addressRequired ? " *" : ""}
        </span>
        <input
          name="addressLine"
          required={addressRequired}
          maxLength={240}
          defaultValue={initial.address_line ?? ""}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Название площадки</span>
        <input
          name="venueName"
          maxLength={160}
          defaultValue={initial.venue_name ?? ""}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Цена</span>
          <input
            name="priceLabel"
            maxLength={80}
            defaultValue={initial.price_label ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Ссылка / регистрация</span>
          <input
            name="registrationUrl"
            type="url"
            defaultValue={initial.registration_url ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Телефон</span>
          <input
            name="phone"
            maxLength={40}
            defaultValue={initial.phone ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Telegram</span>
          <input
            name="telegramUrl"
            maxLength={120}
            placeholder="@username или https://t.me/…"
            defaultValue={initial.telegram_url ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      </div>

      <Button type="submit" disabled={pending} className="min-h-11 w-full sm:w-auto">
        {pending ? "Сохраняю…" : "Сохранить"}
      </Button>
    </form>
  );
}
