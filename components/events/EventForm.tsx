"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createEventAction } from "@/lib/events/actions";
import { EVENT_REGIONS } from "@/lib/events/regions";

export function EventForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<
    "online" | "offline" | "hybrid" | "unknown"
  >("unknown");

  const addressRequired = format === "offline" || format === "hybrid";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "");
    const description = String(fd.get("description") || "");
    const city = String(fd.get("city") || "");
    const addressLine = String(fd.get("addressLine") || "");
    const startsAt = String(fd.get("startsAt") || "");
    const registrationUrl = String(fd.get("registrationUrl") || "");
    const phone = String(fd.get("phone") || "");
    const telegramUrl = String(fd.get("telegramUrl") || "");
    const priceLabel = String(fd.get("priceLabel") || "");
    const nextFormat = String(fd.get("format") || "unknown") as
      | "online"
      | "offline"
      | "hybrid"
      | "unknown";

    startTransition(async () => {
      const result = await createEventAction({
        title,
        description,
        city: city || undefined,
        addressLine: addressLine || undefined,
        startsAt: startsAt || undefined,
        registrationUrl: registrationUrl || undefined,
        phone: phone || undefined,
        telegramUrl: telegramUrl || undefined,
        priceLabel: priceLabel || undefined,
        format: nextFormat,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/events/${result.slug}`);
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Название</span>
        <input
          name="title"
          required
          minLength={3}
          maxLength={160}
          placeholder="Например, вебинар по недвижимости"
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Описание</span>
        <textarea
          name="description"
          rows={5}
          maxLength={8000}
          placeholder="Что будет, для кого, как попасть"
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Город / регион</span>
          <select
            name="city"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
            defaultValue=""
          >
            <option value="">Вся Америка / не указан</option>
            {EVENT_REGIONS.map((r) => (
              <option key={r.id} value={r.city}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Дата и время</span>
          <input
            name="startsAt"
            type="datetime-local"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      </div>

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
          <span className="font-medium text-slate-700">
            Адрес площадки
            {addressRequired ? " *" : ""}
          </span>
          <input
            name="addressLine"
            required={addressRequired}
            maxLength={240}
            placeholder="Улица, номер, название места"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Цена</span>
          <input
            name="priceLabel"
            maxLength={80}
            placeholder="Бесплатно, $25, от $10"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Ссылка / регистрация</span>
          <input
            name="registrationUrl"
            type="url"
            placeholder="https://"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Телефон</span>
          <input
            name="phone"
            type="tel"
            maxLength={40}
            placeholder="+1 …"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Telegram</span>
          <input
            name="telegramUrl"
            maxLength={120}
            placeholder="@username или https://t.me/…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
          />
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
      >
        {pending ? "Публикуем…" : "Опубликовать событие"}
      </button>
    </form>
  );
}
