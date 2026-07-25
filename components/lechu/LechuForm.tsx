"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import {
  createLechuDraftAction,
  publishLechuAction,
  updateLechuAction,
} from "@/lib/listings/actions";
import {
  AUTHOR_VISIBILITY_OPTIONS,
  LISTING_VISIBILITY_OPTIONS,
  isPublisherLocked,
} from "@/lib/listings/constants";
import type { LechuFormInput } from "@/lib/listings/validation";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { CityCombobox } from "@/components/master-data/CityCombobox";
import { StateSelect } from "@/components/master-data/StateSelect";
import type {
  AuthorVisibility,
  LechuRewardType,
  Listing,
  ListingCategory,
  ListingVisibility,
  OwnedBusinessOption,
  PublisherType,
} from "@/types/listing";
import {
  LECHU_CARRY_TYPE_LABELS,
  LECHU_REWARD_LABELS,
} from "@/types/listing";
import type { UsStateOption } from "@/types/master-data";

const CARRY_TYPE_OPTIONS = (
  Object.entries(LECHU_CARRY_TYPE_LABELS) as [string, string][]
).map(([value, label]) => ({ value, label }));

const REWARD_OPTIONS = (
  Object.entries(LECHU_REWARD_LABELS) as [LechuRewardType, string][]
).map(([value, label]) => ({ value, label }));

type LechuFormProps = {
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
  departureCountry: string;
  destinationCountry: string;
  departureDate: string;
  carryTypes: string[];
  maxWeightKg: number | null;
  sizeLimit: string;
  rewardType: LechuRewardType;
  contactNote: string;
  publisherType: PublisherType;
  publisherBusinessId: string;
};

function initialFormState(listing?: Listing): FormState {
  const lechu = listing?.lechu;
  return {
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    city: listing?.city ?? "",
    state: listing?.state ?? "",
    stateCode: listing?.stateCode ?? "",
    cityGeoid: listing?.cityGeoid ?? "",
    visibility: listing?.visibility ?? "public",
    authorVisibility: listing?.authorVisibility ?? "public",
    categoryId: lechu?.categoryId ?? "",
    departureCountry: lechu?.departureCountry ?? "",
    destinationCountry: lechu?.destinationCountry ?? "",
    departureDate: lechu?.departureDate?.slice(0, 10) ?? "",
    carryTypes: lechu?.carryTypes?.length ? lechu.carryTypes : ["documents"],
    maxWeightKg: lechu?.maxWeightKg ?? null,
    sizeLimit: lechu?.sizeLimit ?? "",
    rewardType: lechu?.rewardType ?? "negotiable",
    contactNote: "",
    publisherType: listing?.publisherType ?? "profile",
    publisherBusinessId: listing?.publisherBusinessId ?? "",
  };
}

function buildFormInput(state: FormState): LechuFormInput {
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
    departureCountry: state.departureCountry,
    destinationCountry: state.destinationCountry,
    departureDate: state.departureDate || null,
    carryTypes: state.carryTypes,
    maxWeightKg: state.maxWeightKg,
    sizeLimit: state.sizeLimit || null,
    rewardType: state.rewardType,
    contactNote: state.contactNote || null,
    publisherType: state.publisherType,
    publisherBusinessId:
      state.publisherType === "business" ? state.publisherBusinessId || null : null,
  };
}

export function LechuForm({
  mode,
  categories,
  ownedBusinesses = [],
  initial,
  listingId: propListingId,
  usStates = [],
}: LechuFormProps) {
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

  function toggleCarryType(value: string) {
    setForm((f) => {
      const has = f.carryTypes.includes(value);
      const next = has
        ? f.carryTypes.filter((t) => t !== value)
        : [...f.carryTypes, value];
      return { ...f, carryTypes: next.length ? next : f.carryTypes };
    });
  }

  function saveDraft() {
    setError(null);
    setMessage(null);
    const input = buildFormInput(form);

    startTransition(async () => {
      const result =
        mode === "create" && !listingId
          ? await createLechuDraftAction(input)
          : await updateLechuAction(listingId, input);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const id = result.listingId ?? listingId;
      if (id) {
        setListingId(id);
        if (mode === "create") {
          router.push(`/lechu/${id}/edit`);
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
        const draft = await createLechuDraftAction(input);
        if (!draft.ok || !draft.listingId) {
          setError(draft.ok ? "Не удалось создать черновик." : draft.message);
          return;
        }
        id = draft.listingId;
        setListingId(id);
      } else if (id) {
        const updated = await updateLechuAction(id, input);
        if (!updated.ok) {
          setError(updated.message);
          return;
        }
      } else {
        setError("Сначала сохраните черновик.");
        return;
      }

      const result = await publishLechuAction(id, input);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/lechu/${id}`);
    });
  }

  return (
    <div className="space-y-6">
      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        «Лечу» — для тех, кто летит и может взять посылку. Переводы денег — в{" "}
        <Link className="font-medium underline" href="/transfers/new">
          Переводах
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

        <label className="block space-y-1.5 text-sm" htmlFor="departureCountry">
          <span className="font-medium text-slate-700">Откуда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="departureCountry"
            onChange={(e) => updateField("departureCountry", e.target.value)}
            placeholder="США"
            required
            value={form.departureCountry}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="destinationCountry">
          <span className="font-medium text-slate-700">Куда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="destinationCountry"
            onChange={(e) => updateField("destinationCountry", e.target.value)}
            placeholder="Казахстан"
            required
            value={form.destinationCountry}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="departureDate">
          <span className="font-medium text-slate-700">Дата вылета</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="departureDate"
            onChange={(e) => updateField("departureDate", e.target.value)}
            type="date"
            value={form.departureDate}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="rewardType">
          <span className="font-medium text-slate-700">Вознаграждение</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="rewardType"
            onChange={(e) =>
              updateField("rewardType", e.target.value as LechuRewardType)
            }
            value={form.rewardType}
          >
            {REWARD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium text-slate-700">Что могу взять</legend>
          <div className="flex flex-wrap gap-4">
            {CARRY_TYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input
                  checked={form.carryTypes.includes(opt.value)}
                  onChange={() => toggleCarryType(opt.value)}
                  type="checkbox"
                />
                <span className="text-slate-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-1.5 text-sm" htmlFor="maxWeightKg">
          <span className="font-medium text-slate-700">Макс. вес (кг)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="maxWeightKg"
            min={0}
            onChange={(e) =>
              updateField(
                "maxWeightKg",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            step="0.1"
            type="number"
            value={form.maxWeightKg ?? ""}
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="sizeLimit">
          <span className="font-medium text-slate-700">Ограничение по размеру</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            id="sizeLimit"
            maxLength={120}
            onChange={(e) => updateField("sizeLimit", e.target.value)}
            placeholder="Например, рюкзак / небольшая коробка"
            value={form.sizeLimit}
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
          {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Сохранить черновик
        </Button>
        <Button
          className="gap-2 disabled:opacity-60"
          disabled={pending}
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
