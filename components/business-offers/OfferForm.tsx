"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Category } from "@/types/business";
import type {
  BusinessOffer,
  BusinessOfferPriceMode,
  BusinessOfferType,
} from "@/types/business-offer";
import {
  OFFER_PRICE_MODE_LABELS,
  OFFER_PRICE_UNIT_LABELS,
  OFFER_TYPE_SINGULAR,
} from "@/types/business-offer";
import { ATTRIBUTE_FIELDS } from "@/lib/business-offers/validation";
import {
  createBusinessOfferAction,
  updateBusinessOfferAction,
} from "@/lib/business-offers/actions";

type OfferFormProps = {
  businessId: string;
  businessSlug: string;
  categories: Category[];
  initial?: BusinessOffer | null;
};

const OFFER_TYPES: BusinessOfferType[] = [
  "service",
  "product",
  "vehicle",
  "property",
  "rental",
  "menu_item",
  "other",
];

const PRICE_MODES: BusinessOfferPriceMode[] = [
  "fixed",
  "from",
  "range",
  "on_request",
  "free",
  "contact",
];

export function OfferForm({
  businessId,
  businessSlug,
  categories,
  initial = null,
}: OfferFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [offerType, setOfferType] = useState<BusinessOfferType>(
    initial?.offerType ?? "service",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [shortDescription, setShortDescription] = useState(
    initial?.shortDescription ?? "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [priceMode, setPriceMode] = useState<BusinessOfferPriceMode>(
    initial?.priceMode ?? "contact",
  );
  const [priceAmount, setPriceAmount] = useState(
    initial?.priceAmount?.toString() ?? "",
  );
  const [priceMin, setPriceMin] = useState(initial?.priceMin?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(initial?.priceMax?.toString() ?? "");
  const [priceUnit, setPriceUnit] = useState(initial?.priceUnit ?? "service");
  const [isAvailable, setIsAvailable] = useState(initial?.isAvailable ?? true);
  const [isFeatured, setIsFeatured] = useState(initial?.isFeatured ?? false);
  const [attributes, setAttributes] = useState<Record<string, unknown>>(
    (initial?.attributes as Record<string, unknown>) ?? {},
  );

  const attrFields = useMemo(() => ATTRIBUTE_FIELDS[offerType], [offerType]);

  function parseNum(value: string): number | null {
    if (!value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = {
      businessId,
      offerType,
      title,
      slug: slug || undefined,
      shortDescription: shortDescription || null,
      description: description || null,
      categoryId: categoryId || null,
      priceMode,
      priceAmount: parseNum(priceAmount),
      priceMin: parseNum(priceMin),
      priceMax: parseNum(priceMax),
      priceUnit,
      isAvailable,
      isFeatured,
      attributes,
      status: initial?.status ?? "draft",
    };

    startTransition(async () => {
      const result = initial
        ? await updateBusinessOfferAction(initial.id, payload, businessSlug)
        : await createBusinessOfferAction(payload, businessSlug);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/business/${businessSlug}/manage/offers`);
      router.refresh();
    });
  }

  return (
    <form className="space-y-8" onSubmit={handleSubmit}>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Тип</span>
          <select
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            disabled={!!initial}
            onChange={(e) => setOfferType(e.target.value as BusinessOfferType)}
            value={offerType}
          >
            {OFFER_TYPES.map((t) => (
              <option key={t} value={t}>
                {OFFER_TYPE_SINGULAR[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Название</span>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            onChange={(e) => setTitle(e.target.value)}
            required
            value={title}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">Slug (URL)</span>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            onChange={(e) => setSlug(e.target.value)}
            placeholder="auto-from-title"
            value={slug}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">Категория</span>
          <select
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            onChange={(e) => setCategoryId(e.target.value)}
            value={categoryId}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Краткое описание</span>
          <textarea
            className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            maxLength={300}
            onChange={(e) => setShortDescription(e.target.value)}
            value={shortDescription}
          />
        </label>

        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Описание</span>
          <textarea
            className="min-h-32 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            onChange={(e) => setDescription(e.target.value)}
            value={description}
          />
        </label>
      </div>

      <fieldset className="space-y-4 rounded-2xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">Цена</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Режим</span>
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              onChange={(e) => setPriceMode(e.target.value as BusinessOfferPriceMode)}
              value={priceMode}
            >
              {PRICE_MODES.map((m) => (
                <option key={m} value={m}>
                  {OFFER_PRICE_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Единица</span>
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              onChange={(e) => setPriceUnit(e.target.value)}
              value={priceUnit ?? "item"}
            >
              {Object.entries(OFFER_PRICE_UNIT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label || key}
                </option>
              ))}
            </select>
          </label>

          {(priceMode === "fixed" || priceMode === "from") && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Сумма (USD)</span>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                inputMode="decimal"
                onChange={(e) => setPriceAmount(e.target.value)}
                type="text"
                value={priceAmount}
              />
            </label>
          )}

          {priceMode === "range" && (
            <>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">От (USD)</span>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  inputMode="decimal"
                  onChange={(e) => setPriceMin(e.target.value)}
                  type="text"
                  value={priceMin}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">До (USD)</span>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  inputMode="decimal"
                  onChange={(e) => setPriceMax(e.target.value)}
                  type="text"
                  value={priceMax}
                />
              </label>
            </>
          )}
        </div>
      </fieldset>

      {attrFields.length > 0 && (
        <fieldset className="space-y-4 rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">
            Дополнительные поля
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {attrFields.map((field) => (
              <label key={field.key} className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">{field.label}</span>
                {field.type === "boolean" ? (
                  <input
                    checked={Boolean(attributes[field.key])}
                    className="size-4"
                    onChange={(e) =>
                      setAttributes((prev) => ({
                        ...prev,
                        [field.key]: e.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                ) : (
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                    onChange={(e) =>
                      setAttributes((prev) => ({
                        ...prev,
                        [field.key]:
                          field.type === "number"
                            ? parseNum(e.target.value)
                            : e.target.value,
                      }))
                    }
                    type={field.type === "number" ? "number" : "text"}
                    value={String(attributes[field.key] ?? "")}
                  />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            checked={isAvailable}
            onChange={(e) => setIsAvailable(e.target.checked)}
            type="checkbox"
          />
          Доступно
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            checked={isFeatured}
            onChange={(e) => setIsFeatured(e.target.checked)}
            type="checkbox"
          />
          Избранное
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Сохранение…" : initial ? "Сохранить" : "Создать черновик"}
        </button>
      </div>
    </form>
  );
}
