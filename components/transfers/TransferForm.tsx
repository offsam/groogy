"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createTransferDraftAction,
  publishTransferAction,
  updateTransferAction,
} from "@/lib/listings/actions";
import {
  AUTHOR_VISIBILITY_OPTIONS,
  LISTING_VISIBILITY_OPTIONS,
  isPublisherLocked,
} from "@/lib/listings/constants";
import type { TransferFormInput } from "@/lib/listings/validation";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { CityCombobox } from "@/components/master-data/CityCombobox";
import { StateSelect } from "@/components/master-data/StateSelect";
import type {
  AuthorVisibility,
  Listing,
  ListingCategory,
  ListingVisibility,
  OwnedBusinessOption,
  PublisherType,
  TransferMethod,
} from "@/types/listing";
import { TRANSFER_METHOD_LABELS } from "@/types/listing";
import type { UsStateOption } from "@/types/master-data";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const TRANSFER_METHOD_OPTIONS = (
  Object.entries(TRANSFER_METHOD_LABELS) as [TransferMethod, string][]
).map(([value, label]) => ({ value, label }));

type TransferFormProps = {
  mode: "create" | "edit";
  categories: ListingCategory[];
  ownedBusinesses?: OwnedBusinessOption[];
  initial?: Listing;
  listingId?: string;
  usStates?: UsStateOption[];
};

type FormState = {
  title: string;
  description: string;
  city: string;
  state: string;
  stateCode: string;
  cityGeoid: string;
  visibility: ListingVisibility;
  authorVisibility: AuthorVisibility;
  categoryId: string;
  fromCountry: string;
  toCountry: string;
  transferMethod: TransferMethod;
  feePercent: number | null;
  feeFixedUsd: number | null;
  minAmountUsd: number | null;
  maxAmountUsd: number | null;
  processingDays: number | null;
  contactNote: string;
  publisherType: PublisherType;
  publisherBusinessId: string;
};

function initialFormState(listing?: Listing): FormState {
  const transfer = listing?.transfer;
  return {
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    city: listing?.city ?? "",
    state: listing?.state ?? "",
    stateCode: listing?.stateCode ?? "",
    cityGeoid: listing?.cityGeoid ?? "",
    visibility: listing?.visibility ?? "public",
    authorVisibility: listing?.authorVisibility ?? "public",
    categoryId: transfer?.categoryId ?? "",
    fromCountry: transfer?.fromCountry ?? "",
    toCountry: transfer?.toCountry ?? "",
    transferMethod: transfer?.transferMethod ?? "bank",
    feePercent: transfer?.feePercent ?? null,
    feeFixedUsd: transfer?.feeFixedUsd ?? null,
    minAmountUsd: transfer?.minAmountUsd ?? null,
    maxAmountUsd: transfer?.maxAmountUsd ?? null,
    processingDays: transfer?.processingDays ?? null,
    contactNote: "",
    publisherType: listing?.publisherType ?? "profile",
    publisherBusinessId: listing?.publisherBusinessId ?? "",
  };
}

function buildFormInput(state: FormState): TransferFormInput {
  return {
    title: state.title,
    description: state.description,
    city: state.city || null,
    state: state.state || null,
    stateCode: state.stateCode || null,
    cityGeoid: state.cityGeoid || null,
    visibility: state.visibility,
    authorVisibility: state.authorVisibility,
    categoryId: state.categoryId || null,
    fromCountry: state.fromCountry,
    toCountry: state.toCountry,
    transferMethod: state.transferMethod,
    feePercent: state.feePercent,
    feeFixedUsd: state.feeFixedUsd,
    minAmountUsd: state.minAmountUsd,
    maxAmountUsd: state.maxAmountUsd,
    processingDays: state.processingDays,
    contactNote: state.contactNote || null,
    publisherType: state.publisherType,
    publisherBusinessId:
      state.publisherType === "business" ? state.publisherBusinessId || null : null,
  };
}

export function TransferForm({
  mode,
  categories,
  ownedBusinesses = [],
  initial,
  listingId: propListingId,
  usStates = [],
}: TransferFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => initialFormState(initial));
  const [listingId, setListingId] = useState(propListingId ?? initial?.id ?? "");

  const publisherLocked = initial
    ? isPublisherLocked({
        publishedAt: initial.publishedAt,
        status: initial.status,
      })
    : false;

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function saveDraft() {
    setError(null);
    setMessage(null);
    const input = buildFormInput(form);

    startTransition(async () => {
      const result =
        mode === "create" && !listingId
          ? await createTransferDraftAction(input)
          : await updateTransferAction(listingId, input);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const id = result.listingId ?? listingId;
      if (id) {
        setListingId(id);
        if (mode === "create") {
          router.push(`/transfers/${id}/edit`);
        } else {
          setMessage(result.message ?? "Черновик сохранён.");
        }
      }
    });
  }

  function publish() {
    setError(null);
    setMessage(null);
    const input = buildFormInput(form);

    startTransition(async () => {
      let id = listingId;

      if (mode === "create" && !id) {
        const draft = await createTransferDraftAction(input);
        if (!draft.ok || !draft.listingId) {
          setError(draft.ok ? "Не удалось создать черновик." : draft.message);
          return;
        }
        id = draft.listingId;
        setListingId(id);
      } else if (id) {
        const updated = await updateTransferAction(id, input);
        if (!updated.ok) {
          setError(updated.message);
          return;
        }
      } else {
        setError("Сначала сохраните черновик.");
        return;
      }

      const result = await publishTransferAction(id, input);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/transfers/${id}`);
    });
  }

  return (
    <div className="space-y-6">
      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        Переводы размещаются здесь. Услуги — в разделе{" "}
        <Link className="font-medium underline" href="/services/new">
          Услуги
        </Link>
        .
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Опубликовать как</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={form.publisherType === "profile"}
            disabled={publisherLocked}
            name="publisherType"
            onChange={() => {
              updateField("publisherType", "profile");
              updateField("publisherBusinessId", "");
            }}
            type="radio"
          />
          <span className="text-slate-700">Личный профиль</span>
        </label>
        {ownedBusinesses.map((biz) => (
          <label key={biz.id} className="flex items-center gap-2 text-sm">
            <input
              checked={
                form.publisherType === "business" &&
                form.publisherBusinessId === biz.id
              }
              disabled={publisherLocked}
              name="publisherType"
              onChange={() => {
                updateField("publisherType", "business");
                updateField("publisherBusinessId", biz.id);
              }}
              type="radio"
            />
            <span className="text-slate-700">{biz.name}</span>
          </label>
        ))}
        {publisherLocked && (
          <p className="text-xs text-slate-500">
            Публикатор нельзя изменить после первой публикации.
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="categoryId">
          <span className="font-medium text-slate-700">Категория</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="categoryId"
            onChange={(e) => updateField("categoryId", e.target.value)}
            value={form.categoryId}
          >
            <option value="">Выберите категорию…</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nameRu}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="title">
          <span className="font-medium text-slate-700">Заголовок</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="title"
            maxLength={120}
            onChange={(e) => updateField("title", e.target.value)}
            required
            value={form.title}
          />
        </label>

        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="description">
          <span className="font-medium text-slate-700">Описание</span>
          <textarea
            className="min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="description"
            maxLength={8000}
            onChange={(e) => updateField("description", e.target.value)}
            required
            value={form.description}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="fromCountry">
          <span className="font-medium text-slate-700">Откуда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="fromCountry"
            onChange={(e) => updateField("fromCountry", e.target.value)}
            placeholder="США"
            required
            value={form.fromCountry}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="toCountry">
          <span className="font-medium text-slate-700">Куда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="toCountry"
            onChange={(e) => updateField("toCountry", e.target.value)}
            placeholder="Россия"
            required
            value={form.toCountry}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="transferMethod">
          <span className="font-medium text-slate-700">Способ перевода</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="transferMethod"
            onChange={(e) =>
              updateField("transferMethod", e.target.value as TransferMethod)
            }
            value={form.transferMethod}
          >
            {TRANSFER_METHOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="processingDays">
          <span className="font-medium text-slate-700">Срок (дней)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="processingDays"
            min={0}
            onChange={(e) =>
              updateField(
                "processingDays",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            step={1}
            type="number"
            value={form.processingDays ?? ""}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="feePercent">
          <span className="font-medium text-slate-700">Комиссия (%)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="feePercent"
            min={0}
            onChange={(e) =>
              updateField(
                "feePercent",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            step="0.01"
            type="number"
            value={form.feePercent ?? ""}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="feeFixedUsd">
          <span className="font-medium text-slate-700">Фикс. комиссия (USD)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="feeFixedUsd"
            min={0}
            onChange={(e) =>
              updateField(
                "feeFixedUsd",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            step="0.01"
            type="number"
            value={form.feeFixedUsd ?? ""}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="minAmountUsd">
          <span className="font-medium text-slate-700">Мин. сумма (USD)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="minAmountUsd"
            min={0}
            onChange={(e) =>
              updateField(
                "minAmountUsd",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            step="0.01"
            type="number"
            value={form.minAmountUsd ?? ""}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="maxAmountUsd">
          <span className="font-medium text-slate-700">Макс. сумма (USD)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="maxAmountUsd"
            min={0}
            onChange={(e) =>
              updateField(
                "maxAmountUsd",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            step="0.01"
            type="number"
            value={form.maxAmountUsd ?? ""}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="city">
          <span className="font-medium text-slate-700">Город</span>
          {usStates.length > 0 ? (
            <CityCombobox
              id="city"
              onCityChange={(city) =>
                setForm((f) => ({ ...f, city, cityGeoid: "" }))
              }
              onSelect={(sel) =>
                setForm((f) => ({
                  ...f,
                  city: sel.city,
                  cityGeoid: sel.cityGeoid,
                  stateCode: sel.stateCode,
                  state: sel.stateAbbreviation,
                }))
              }
              stateCode={form.stateCode || null}
              states={usStates}
              value={form.city}
            />
          ) : (
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              id="city"
              onChange={(e) => updateField("city", e.target.value)}
              value={form.city}
            />
          )}
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="state">
          <span className="font-medium text-slate-700">Штат</span>
          {usStates.length > 0 ? (
            <StateSelect
              id="state"
              onChange={(code, abbreviation) =>
                setForm((f) => ({
                  ...f,
                  stateCode: code,
                  state: abbreviation,
                  cityGeoid: code !== f.stateCode ? "" : f.cityGeoid,
                }))
              }
              states={usStates}
              value={form.stateCode}
            />
          ) : (
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              id="state"
              onChange={(e) => updateField("state", e.target.value)}
              value={form.state}
            />
          )}
        </label>

        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="contactNote">
          <span className="font-medium text-slate-700">Заметка для связи</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="contactNote"
            maxLength={500}
            onChange={(e) => updateField("contactNote", e.target.value)}
            placeholder="Telegram, WhatsApp или удобное время"
            value={form.contactNote}
          />
        </label>

        {form.publisherType === "profile" && (
          <label className="block space-y-1.5 text-sm" htmlFor="authorVisibility">
            <span className="font-medium text-slate-700">Отображение автора</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              id="authorVisibility"
              onChange={(e) =>
                updateField("authorVisibility", e.target.value as AuthorVisibility)
              }
              value={form.authorVisibility}
            >
              {AUTHOR_VISIBILITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block space-y-1.5 text-sm" htmlFor="visibility">
          <span className="font-medium text-slate-700">Видимость объявления</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="visibility"
            onChange={(e) =>
              updateField("visibility", e.target.value as ListingVisibility)
            }
            value={form.visibility}
          >
            {LISTING_VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="gap-2 disabled:opacity-60"
          disabled={pending}
          onClick={() => saveDraft()}
          type="button"
          variant="secondary"
        >
          {pending && <BrandPinLoader size="sm" />}
          Сохранить черновик
        </Button>
        <Button
          className="gap-2 disabled:opacity-60"
          disabled={pending}
          onClick={() => publish()}
          type="button"
        >
          {pending && <BrandPinLoader size="sm" />}
          Опубликовать
        </Button>
      </div>
    </div>
  );
}
