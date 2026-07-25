"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import {
  addListingMediaAction,
  createServiceDraftAction,
  publishServiceAction,
  removeListingMediaAction,
  updateServiceAction,
} from "@/lib/listings/actions";
import {
  AUTHOR_VISIBILITY_OPTIONS,
  LANGUAGE_OPTIONS,
  LISTING_VISIBILITY_OPTIONS,
  MAX_LISTING_MEDIA,
  SERVICE_MODE_OPTIONS,
  SERVICE_PRICING_OPTIONS,
  isPublisherLocked,
  listingStoragePrefix,
} from "@/lib/listings/constants";
import { createBrowserClient } from "@/lib/supabase/client";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { CityCombobox } from "@/components/master-data/CityCombobox";
import { LanguageCheckboxGroup } from "@/components/master-data/LanguageCheckboxGroup";
import { StateSelect } from "@/components/master-data/StateSelect";
import type {
  AuthorVisibility,
  Listing,
  ListingCategory,
  ListingVisibility,
  OwnedBusinessOption,
  PublisherType,
  ServiceMode,
  ServicePricingType,
} from "@/types/listing";
import type { LanguageOption, UsStateOption } from "@/types/master-data";

type ServiceFormProps = {
  mode: "create" | "edit";
  categories: ListingCategory[];
  ownedBusinesses?: OwnedBusinessOption[];
  initial?: Listing;
  listingId?: string;
  userId?: string;
  usStates?: UsStateOption[];
  languages?: LanguageOption[];
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
  serviceCategoryId: string;
  pricingType: ServicePricingType;
  priceFrom: number | null;
  priceTo: number | null;
  priceUnit: string;
  serviceModes: ServiceMode[];
  serviceArea: string;
  experienceYears: number | null;
  languages: string[];
  languagesText: string;
  licenseInfo: string;
  insuranceStatus: string;
  availabilityText: string;
  offersFreeEstimate: boolean;
  offersEmergencyService: boolean;
  isNegotiable: boolean;
  publisherType: PublisherType;
  publisherBusinessId: string;
};

function parseLanguages(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function initialFormState(listing?: Listing): FormState {
  const service = listing?.service;
  const languages = service?.languages?.length ? service.languages : ["ru"];
  return {
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    city: listing?.city ?? "",
    state: listing?.state ?? "",
    stateCode: listing?.stateCode ?? "",
    cityGeoid: listing?.cityGeoid ?? "",
    visibility: listing?.visibility ?? "public",
    authorVisibility: listing?.authorVisibility ?? "public",
    serviceCategoryId: service?.serviceCategoryId ?? "",
    pricingType: service?.pricingType ?? "contact_for_price",
    priceFrom: service?.priceFrom ?? null,
    priceTo: service?.priceTo ?? null,
    priceUnit: service?.priceUnit ?? "",
    serviceModes: service?.serviceModes?.length
      ? service.serviceModes
      : ["in_person"],
    serviceArea: service?.serviceArea ?? "",
    experienceYears: service?.experienceYears ?? null,
    languages,
    languagesText: languages.join(", "),
    licenseInfo: service?.licenseInfo ?? "",
    insuranceStatus: service?.insuranceStatus ?? "",
    availabilityText: service?.availabilityText ?? "",
    offersFreeEstimate: service?.offersFreeEstimate ?? false,
    offersEmergencyService: service?.offersEmergencyService ?? false,
    isNegotiable: listing?.isNegotiable ?? false,
    publisherType: listing?.publisherType ?? "profile",
    publisherBusinessId: listing?.publisherBusinessId ?? "",
  };
}

function buildFormInput(state: FormState) {
  const languages =
    state.languages.length > 0
      ? state.languages
      : parseLanguages(state.languagesText);
  return {
    title: state.title,
    description: state.description,
    city: state.city || null,
    state: state.state || null,
    stateCode: state.stateCode || null,
    cityGeoid: state.cityGeoid || null,
    visibility: state.visibility,
    authorVisibility: state.authorVisibility,
    serviceCategoryId: state.serviceCategoryId || null,
    pricingType: state.pricingType,
    priceFrom: state.priceFrom,
    priceTo: state.priceTo,
    priceUnit: state.priceUnit || null,
    serviceModes: state.serviceModes,
    serviceArea: state.serviceArea || null,
    experienceYears: state.experienceYears,
    languages: languages.length ? languages : ["ru"],
    licenseInfo: state.licenseInfo || null,
    insuranceStatus: state.insuranceStatus || null,
    availabilityText: state.availabilityText || null,
    offersFreeEstimate: state.offersFreeEstimate,
    offersEmergencyService: state.offersEmergencyService,
    isNegotiable: state.isNegotiable || state.pricingType === "negotiable",
    publisherType: state.publisherType,
    publisherBusinessId:
      state.publisherType === "business" ? state.publisherBusinessId || null : null,
  };
}

export function ServiceForm({
  mode,
  categories,
  ownedBusinesses = [],
  initial,
  listingId: propListingId,
  userId,
  usStates = [],
  languages: languageOptions = [],
}: ServiceFormProps) {
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

  const showPriceFields = ["fixed", "from", "hourly", "daily"].includes(
    form.pricingType,
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleMode(modeValue: ServiceMode) {
    setForm((f) => {
      const has = f.serviceModes.includes(modeValue);
      const next = has
        ? f.serviceModes.filter((m) => m !== modeValue)
        : [...f.serviceModes, modeValue];
      return { ...f, serviceModes: next.length ? next : f.serviceModes };
    });
  }

  function toggleLanguage(code: string) {
    setForm((f) => {
      const has = f.languages.includes(code);
      const next = has
        ? f.languages.filter((l) => l !== code)
        : [...f.languages, code];
      return {
        ...f,
        languages: next,
        languagesText: next.join(", "),
      };
    });
  }

  function saveDraft() {
    setError(null);
    setMessage(null);
    const input = buildFormInput(form);

    startTransition(async () => {
      const result =
        mode === "create" && !listingId
          ? await createServiceDraftAction(input)
          : await updateServiceAction(listingId, input);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const id = result.listingId ?? listingId;
      if (id) {
        setListingId(id);
        if (mode === "create") {
          router.push(`/services/${id}/edit`);
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
        const draft = await createServiceDraftAction(input);
        if (!draft.ok || !draft.listingId) {
          setError(draft.ok ? "Не удалось создать черновик." : draft.message);
          return;
        }
        id = draft.listingId;
        setListingId(id);
      } else if (id) {
        const updated = await updateServiceAction(id, input);
        if (!updated.ok) {
          setError(updated.message);
          return;
        }
      } else {
        setError("Сначала сохраните черновик.");
        return;
      }

      const result = await publishServiceAction(id, input);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/services/${id}`);
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

  return (
    <div className="space-y-6">
      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        Услуги размещаются здесь. Товары — в разделе{" "}
        <Link className="font-medium underline" href="/marketplace/new">
          Marketplace
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
        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="serviceCategoryId">
          <span className="font-medium text-slate-700">Категория</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="serviceCategoryId"
            onChange={(e) => updateField("serviceCategoryId", e.target.value)}
            value={form.serviceCategoryId}
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

        <label className="block space-y-1.5 text-sm" htmlFor="pricingType">
          <span className="font-medium text-slate-700">Тип цены</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="pricingType"
            onChange={(e) =>
              updateField("pricingType", e.target.value as ServicePricingType)
            }
            value={form.pricingType}
          >
            {SERVICE_PRICING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {showPriceFields && (
          <>
            <label className="block space-y-1.5 text-sm" htmlFor="priceFrom">
              <span className="font-medium text-slate-700">
                {form.pricingType === "from" ? "Цена от (USD)" : "Цена (USD)"}
              </span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
                id="priceFrom"
                min={0}
                onChange={(e) =>
                  updateField(
                    "priceFrom",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                step="0.01"
                type="number"
                value={form.priceFrom ?? ""}
              />
            </label>

            <label className="block space-y-1.5 text-sm" htmlFor="priceTo">
              <span className="font-medium text-slate-700">Цена до (USD)</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
                id="priceTo"
                min={0}
                onChange={(e) =>
                  updateField(
                    "priceTo",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                step="0.01"
                type="number"
                value={form.priceTo ?? ""}
              />
            </label>

            {(form.pricingType === "hourly" || form.pricingType === "daily") && (
              <label className="block space-y-1.5 text-sm" htmlFor="priceUnit">
                <span className="font-medium text-slate-700">Единица</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
                  id="priceUnit"
                  maxLength={40}
                  onChange={(e) => updateField("priceUnit", e.target.value)}
                  placeholder={form.pricingType === "hourly" ? "час" : "день"}
                  value={form.priceUnit}
                />
              </label>
            )}
          </>
        )}

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium text-slate-700">Формат услуги</legend>
          <div className="flex flex-wrap gap-4">
            {SERVICE_MODE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input
                  checked={form.serviceModes.includes(opt.value)}
                  onChange={() => toggleMode(opt.value)}
                  type="checkbox"
                />
                <span className="text-slate-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

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

        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="serviceArea">
          <span className="font-medium text-slate-700">Зона обслуживания</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="serviceArea"
            maxLength={200}
            onChange={(e) => updateField("serviceArea", e.target.value)}
            placeholder="Например, Orange County, Irvine"
            value={form.serviceArea}
          />
        </label>

        <div className="space-y-2 sm:col-span-2">
          {languageOptions.length > 0 ? (
            <LanguageCheckboxGroup
              languages={languageOptions}
              onChange={(codes) => {
                updateField("languages", codes);
                updateField("languagesText", codes.join(", "));
              }}
              value={form.languages}
            />
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Языки</legend>
              <div className="flex flex-wrap gap-4">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <input
                      checked={form.languages.includes(opt.value)}
                      onChange={() => toggleLanguage(opt.value)}
                      type="checkbox"
                    />
                    <span className="text-slate-700">{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="block space-y-1.5 text-sm" htmlFor="languagesText">
            <span className="font-medium text-slate-700">Или через запятую</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              id="languagesText"
              onChange={(e) => {
                const text = e.target.value;
                updateField("languagesText", text);
                updateField("languages", parseLanguages(text));
              }}
              placeholder="ru, en, es"
              value={form.languagesText}
            />
          </label>
        </div>

        <label className="block space-y-1.5 text-sm" htmlFor="experienceYears">
          <span className="font-medium text-slate-700">Опыт (лет)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="experienceYears"
            max={80}
            min={0}
            onChange={(e) =>
              updateField(
                "experienceYears",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            step={1}
            type="number"
            value={form.experienceYears ?? ""}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="licenseInfo">
          <span className="font-medium text-slate-700">Лицензия</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="licenseInfo"
            maxLength={500}
            onChange={(e) => updateField("licenseInfo", e.target.value)}
            value={form.licenseInfo}
          />
        </label>

        <label className="block space-y-1.5 text-sm sm:col-span-2" htmlFor="availabilityText">
          <span className="font-medium text-slate-700">Доступность</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="availabilityText"
            maxLength={500}
            onChange={(e) => updateField("availabilityText", e.target.value)}
            placeholder="Пн–Пт 9:00–18:00, выходные по записи"
            value={form.availabilityText}
          />
        </label>

        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={form.offersFreeEstimate}
              onChange={(e) => updateField("offersFreeEstimate", e.target.checked)}
              type="checkbox"
            />
            <span className="text-slate-700">Бесплатная оценка</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={form.offersEmergencyService}
              onChange={(e) =>
                updateField("offersEmergencyService", e.target.checked)
              }
              type="checkbox"
            />
            <span className="text-slate-700">Срочный выезд</span>
          </label>
        </div>

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
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
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
          {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Сохранить черновик
        </Button>
        <Button
          className="gap-2 disabled:opacity-60"
          disabled={pending || uploading}
          onClick={() => publish()}
          type="button"
        >
          {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Опубликовать
        </Button>
      </div>
    </div>
  );
}
