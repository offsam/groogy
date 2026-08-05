"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Trash2, Upload } from "lucide-react";
import {
  addListingMediaAction,
  createListingDraftAction,
  publishListingAction,
  removeListingMediaAction,
  updateListingAction,
} from "@/lib/listings/actions";
import {
  AUTHOR_VISIBILITY_OPTIONS,
  CONDITION_OPTIONS,
  LISTING_VISIBILITY_OPTIONS,
  MAX_LISTING_MEDIA,
  TRANSACTION_OPTIONS,
  isPublisherLocked,
  listingStoragePrefix,
} from "@/lib/listings/constants";
import { createBrowserClient } from "@/lib/supabase/client";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { CityCombobox } from "@/components/master-data/CityCombobox";
import { StateSelect } from "@/components/master-data/StateSelect";
import type {
  AuthorVisibility,
  Listing,
  ListingCategory,
  ListingCondition,
  ListingTransactionType,
  ListingVisibility,
  OwnedBusinessOption,
  PublisherType,
} from "@/types/listing";
import type { UsStateOption } from "@/types/master-data";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type ListingFormProps = {
  mode: "create" | "edit";
  categories: ListingCategory[];
  ownedBusinesses?: OwnedBusinessOption[];
  initial?: Listing;
  listingId?: string;
  userId?: string;
  usStates?: UsStateOption[];
};

function buildFormInput(state: FormState) {
  return {
    title: state.title,
    description: state.description,
    priceAmount: state.transactionType === "free" ? 0 : state.priceAmount,
    isNegotiable: state.isNegotiable,
    city: state.city || null,
    state: state.state || null,
    stateCode: state.stateCode || null,
    cityGeoid: state.cityGeoid || null,
    visibility: state.visibility,
    authorVisibility: state.authorVisibility,
    categoryId: state.categoryId || null,
    condition: state.condition,
    transactionType: state.transactionType,
    deliveryAvailable: state.deliveryAvailable,
    pickupAvailable: state.pickupAvailable,
    quantity: null,
    publisherType: state.publisherType,
    publisherBusinessId:
      state.publisherType === "business" ? state.publisherBusinessId || null : null,
  };
}

type FormState = {
  title: string;
  description: string;
  priceAmount: number | null;
  isNegotiable: boolean;
  city: string;
  state: string;
  stateCode: string;
  cityGeoid: string;
  visibility: ListingVisibility;
  authorVisibility: AuthorVisibility;
  categoryId: string;
  condition: ListingCondition | null;
  transactionType: ListingTransactionType;
  deliveryAvailable: boolean;
  pickupAvailable: boolean;
  publisherType: PublisherType;
  publisherBusinessId: string;
};

function initialFormState(listing?: Listing): FormState {
  return {
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    priceAmount: listing?.priceAmount ?? null,
    isNegotiable: listing?.isNegotiable ?? false,
    city: listing?.city ?? "",
    state: listing?.state ?? "",
    stateCode: listing?.stateCode ?? "",
    cityGeoid: listing?.cityGeoid ?? "",
    visibility: listing?.visibility ?? "public",
    authorVisibility: listing?.authorVisibility ?? "public",
    categoryId: listing?.marketplace?.categoryId ?? "",
    condition: listing?.marketplace?.condition ?? null,
    transactionType: listing?.marketplace?.transactionType ?? "sell",
    deliveryAvailable: listing?.marketplace?.deliveryAvailable ?? false,
    pickupAvailable: listing?.marketplace?.pickupAvailable ?? true,
    publisherType: listing?.publisherType ?? "profile",
    publisherBusinessId: listing?.publisherBusinessId ?? "",
  };
}

export function ListingForm({
  mode,
  categories,
  ownedBusinesses = [],
  initial,
  listingId: propListingId,
  userId,
  usStates = [],
}: ListingFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => initialFormState(initial));
  const [listingId, setListingId] = useState(propListingId ?? initial?.id ?? "");
  const [media, setMedia] = useState(initial?.media ?? []);
  const [uploading, setUploading] = useState(false);

  const publisherLocked = initial
    ? isPublisherLocked({
        publishedAt: initial.publishedAt,
        status: initial.status,
      })
    : false;

  useEffect(() => {
    if (form.transactionType === "free") {
      setForm((f) => ({ ...f, priceAmount: 0, isNegotiable: false }));
    }
  }, [form.transactionType]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function saveDraft(onSuccess?: (id: string) => void) {
    setError(null);
    setMessage(null);
    const input = buildFormInput(form);

    startTransition(async () => {
      const result =
        mode === "create" && !listingId
          ? await createListingDraftAction(input)
          : await updateListingAction(listingId, input);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const id = result.listingId ?? listingId;
      if (id) {
        setListingId(id);
        if (mode === "create") {
          router.push(`/marketplace/${id}/edit`);
        } else {
          setMessage(result.message ?? "Черновик сохранён.");
          onSuccess?.(id);
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
        const draft = await createListingDraftAction(input);
        if (!draft.ok || !draft.listingId) {
          setError(draft.ok ? "Не удалось создать черновик." : draft.message);
          return;
        }
        id = draft.listingId;
        if (id) setListingId(id);
      } else if (id) {
        const updated = await updateListingAction(id, input);
        if (!updated.ok) {
          setError(updated.message);
          return;
        }
      } else {
        setError("Сначала сохраните черновик.");
        return;
      }

      const result = await publishListingAction(id);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/marketplace/${id}`);
    });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length || !listingId || !userId) return;

    if (media.length >= MAX_LISTING_MEDIA) {
      setError("Максимум 10 фотографий на объявление.");
      return;
    }

    setUploading(true);
    setError(null);

    const supabase = createBrowserClient();
    const prefix = listingStoragePrefix(userId, listingId);

    for (const file of Array.from(files)) {
      if (media.length >= MAX_LISTING_MEDIA) break;

      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storagePath = `${prefix}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from("listing-images")
        .upload(storagePath, file, { upsert: false });

      if (uploadError) {
        setError(uploadError.message);
        break;
      }

      const result = await addListingMediaAction({
        listingId,
        storagePath,
        sortOrder: media.length,
      });

      if (!result.ok) {
        setError(result.message);
        break;
      }

      const { data: signed } = await supabase.storage
        .from("listing-images")
        .createSignedUrl(storagePath, 3600);

      setMedia((m) => [
        ...m,
        {
          id: `temp-${storagePath}`,
          listingId,
          storagePath,
          sortOrder: m.length,
          publicUrl: signed?.signedUrl ?? null,
        },
      ]);
    }

    setUploading(false);
    e.target.value = "";
    router.refresh();
  }

  function removeMedia(mediaId: string) {
    if (!listingId) return;
    setError(null);
    startTransition(async () => {
      const result = await removeListingMediaAction(mediaId, listingId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMedia((m) => m.filter((item) => item.id !== mediaId));
      router.refresh();
    });
  }

  const priceDisabled = form.transactionType === "free" || form.transactionType === "exchange";
  const showPrice = form.transactionType === "sell" || form.transactionType === "wanted";

  return (
    <div className="space-y-6">
      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        Marketplace только для товаров. Услуги размещайте в разделе{" "}
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
        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="transactionType">
          <span className="font-medium text-slate-700">Тип сделки</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="transactionType"
            onChange={(e) =>
              updateField("transactionType", e.target.value as ListingTransactionType)
            }
            value={form.transactionType}
          >
            {TRANSACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

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

        {form.transactionType !== "wanted" && (
          <label className="block space-y-1.5 text-sm" htmlFor="condition">
            <span className="font-medium text-slate-700">Состояние</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              id="condition"
              onChange={(e) =>
                updateField(
                  "condition",
                  e.target.value ? (e.target.value as ListingCondition) : null,
                )
              }
              value={form.condition ?? ""}
            >
              <option value="">Выберите…</option>
              {CONDITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {showPrice && (
          <label className="block space-y-1.5 text-sm" htmlFor="price">
            <span className="font-medium text-slate-700">
              {form.transactionType === "wanted" ? "Бюджет (USD)" : "Цена (USD)"}
            </span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500"
              disabled={priceDisabled}
              id="price"
              min={0}
              onChange={(e) =>
                updateField(
                  "priceAmount",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              step="0.01"
              type="number"
              value={form.transactionType === "free" ? 0 : (form.priceAmount ?? "")}
            />
          </label>
        )}

        {form.transactionType === "sell" && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              checked={form.isNegotiable}
              onChange={(e) => updateField("isNegotiable", e.target.checked)}
              type="checkbox"
            />
            <span className="text-slate-700">Возможен торг</span>
          </label>
        )}

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

        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={form.pickupAvailable}
              onChange={(e) => updateField("pickupAvailable", e.target.checked)}
              type="checkbox"
            />
            <span className="text-slate-700">Самовывоз</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={form.deliveryAvailable}
              onChange={(e) => updateField("deliveryAvailable", e.target.checked)}
              type="checkbox"
            />
            <span className="text-slate-700">Доставка</span>
          </label>
        </div>

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

      {mode === "edit" && listingId && userId && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Фотографии ({media.length}/{MAX_LISTING_MEDIA})
            </h3>
            {media.length < MAX_LISTING_MEDIA && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:border-slate-300">
                <Upload aria-hidden="true" className="size-4" />
                Загрузить
                <input
                  accept="image/*"
                  className="sr-only"
                  disabled={uploading || pending}
                  multiple
                  onChange={handleFileUpload}
                  type="file"
                />
              </label>
            )}
          </div>

          {media.length === 0 ? (
            <p className="text-sm text-slate-500">Добавьте до 10 фотографий.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {media.map((item) => (
                <li key={item.id} className="relative aspect-square overflow-hidden rounded-lg">
                  {item.publicUrl && (
                    <Image
                      alt=""
                      className="object-cover"
                      fill
                      sizes="120px"
                      src={item.publicUrl}
                      unoptimized
                    />
                  )}
                  {!item.id.startsWith("temp-") && (
                    <button
                      aria-label="Удалить фото"
                      className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-slate-700 shadow hover:bg-white disabled:opacity-60"
                      disabled={pending}
                      onClick={() => removeMedia(item.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {uploading && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <BrandPinLoader size="sm" />
              Загрузка…
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          className="gap-2 disabled:opacity-60"
          disabled={pending || uploading}
          onClick={() => saveDraft()}
          type="button"
          variant="secondary"
        >
          {pending && <BrandPinLoader size="sm" />}
          Сохранить черновик
        </Button>
        <Button
          className="gap-2 disabled:opacity-60"
          disabled={pending || uploading}
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
