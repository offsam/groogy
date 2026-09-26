"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  archiveMyEventAction,
  updateMyEventAction,
} from "@/lib/events/actions";
import { EVENT_REGIONS } from "@/lib/events/regions";

type Initial = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  city: string | null;
  address_line: string | null;
  starts_at: string | null;
  event_at_label: string | null;
  registration_url: string | null;
  phone: string | null;
  telegram_url: string | null;
  price_label: string | null;
  format: string | null;
  status: string;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MyEventEditForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dateUnknown, setDateUnknown] = useState(
    !initial.starts_at || initial.event_at_label === "Дата уточняется",
  );
  const [format, setFormat] = useState<
    "online" | "offline" | "hybrid" | "unknown"
  >(
    initial.format === "online" ||
      initial.format === "offline" ||
      initial.format === "hybrid"
      ? initial.format
      : "unknown",
  );
  const addressRequired = format === "offline" || format === "hybrid";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateMyEventAction({
        id: initial.id,
        title: String(fd.get("title") || ""),
        description: String(fd.get("description") || ""),
        city: String(fd.get("city") || ""),
        addressLine: String(fd.get("addressLine") || ""),
        startsAt: dateUnknown ? undefined : String(fd.get("startsAt") || ""),
        dateUnknown,
        registrationUrl: String(fd.get("registrationUrl") || ""),
        phone: String(fd.get("phone") || ""),
        telegramUrl: String(fd.get("telegramUrl") || ""),
        priceLabel: String(fd.get("priceLabel") || ""),
        format,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/events/mine");
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Название</span>
        <input
          name="title"
          required
          minLength={3}
          maxLength={160}
          defaultValue={initial.title}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Описание</span>
        <textarea
          name="description"
          rows={5}
          maxLength={8000}
          defaultValue={initial.description ?? ""}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Город</span>
        <select
          name="city"
          defaultValue={initial.city ?? ""}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"
        >
          <option value="">Не указан</option>
          {EVENT_REGIONS.map((r) => (
            <option key={r.id} value={r.city}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={dateUnknown}
          onChange={(e) => setDateUnknown(e.target.checked)}
          className="size-4"
        />
        Дата уточняется
      </label>
      {!dateUnknown ? (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Дата и время</span>
          <input
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={toLocalInput(initial.starts_at)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
      ) : null}

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Формат</span>
        <select
          value={format}
          onChange={(e) =>
            setFormat(
              e.target.value as "online" | "offline" | "hybrid" | "unknown",
            )
          }
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"
        >
          <option value="unknown">Не указан</option>
          <option value="online">Онлайн</option>
          <option value="offline">Офлайн</option>
          <option value="hybrid">Гибрид</option>
        </select>
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">
          Адрес{addressRequired ? " *" : ""}
        </span>
        <input
          name="addressLine"
          required={addressRequired}
          defaultValue={initial.address_line ?? ""}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Цена</span>
          <input
            name="priceLabel"
            defaultValue={initial.price_label ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Ссылка</span>
          <input
            name="registrationUrl"
            defaultValue={initial.registration_url ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Телефон</span>
          <input
            name="phone"
            defaultValue={initial.phone ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Telegram</span>
          <input
            name="telegramUrl"
            defaultValue={initial.telegram_url ?? ""}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-xl bg-brand-blue px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Сохраняю…" : "Сохранить"}
        </button>
        {initial.status !== "archived" ? (
          <button
            type="button"
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm text-red-700 disabled:opacity-60"
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await archiveMyEventAction({ id: initial.id });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.push("/events/mine");
                router.refresh();
              });
            }}
          >
            Убрать с сайта
          </button>
        ) : null}
      </div>
    </form>
  );
}
