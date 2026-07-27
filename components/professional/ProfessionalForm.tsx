"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createProfessionalAction,
  updateProfessionalAction,
  type CreateProfessionalInput,
} from "@/lib/professional/actions";

type ProfessionalFormProps = {
  mode: "create" | "edit";
  slug?: string;
  initial?: CreateProfessionalInput;
};

export function ProfessionalForm({ mode, slug, initial }: ProfessionalFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [headline, setHeadline] = useState(initial?.headline ?? "");
  const [shortDescription, setShortDescription] = useState(
    initial?.shortDescription ?? "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [region, setRegion] = useState(initial?.region ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [instagramUrl, setInstagramUrl] = useState(initial?.instagramUrl ?? "");
  const [telegramUrl, setTelegramUrl] = useState(initial?.telegramUrl ?? "");

  function submit(publish: boolean) {
    setError(null);
    const payload: CreateProfessionalInput = {
      displayName,
      headline,
      shortDescription,
      description,
      city,
      region,
      phone,
      email,
      website,
      instagramUrl,
      telegramUrl,
      publish,
    };

    startTransition(async () => {
      const result =
        mode === "edit" && slug
          ? await updateProfessionalAction(slug, payload)
          : await createProfessionalAction(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/professional/${result.slug}`);
      router.refresh();
    });
  }

  const field =
    "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-brand-blue/30 focus:ring-2";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
    >
      <label className="block text-sm font-medium text-slate-700">
        Имя / как вас называют
        <input
          className={field}
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Специальность
        <input
          className={field}
          placeholder="Например: сантехник, репетитор, риелтор"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Коротко о себе
        <textarea
          className={field}
          rows={2}
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Подробнее
        <textarea
          className={field}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Город
          <input
            className={field}
            placeholder="Irvine"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Если работаете по всему округу — оставьте пустым и укажите район.
          </span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Район / округ
          <input
            className={field}
            placeholder="Orange County"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Показывается в профиле и фильтрах. Без улицы на карте не будет пина.
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Телефон
          <input
            className={field}
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            className={field}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Сайт
          <input
            className={field}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Instagram
          <input
            className={field}
            placeholder="@username или ссылка"
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-slate-700">
        Telegram
        <input
          className={field}
          placeholder="@username или числовой ID"
          value={telegramUrl}
          onChange={(e) => setTelegramUrl(e.target.value)}
        />
      </label>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          className="rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Сохранение…" : "Опубликовать"}
        </button>
        <button
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-60"
          disabled={pending}
          type="button"
          onClick={() => submit(false)}
        >
          Сохранить черновик
        </button>
      </div>
    </form>
  );
}
