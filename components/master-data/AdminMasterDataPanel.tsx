"use client";

import { useMemo, useState, useTransition } from "react";

import {
  adminSetLanguageActiveAction,
  adminSetLanguageSortAction,
  adminSetListingCategoryActiveAction,
  adminSetLocationActiveAction,
  adminUpsertFeatureAction,
  adminUpsertListingCategoryAction,
  searchCitiesAction,
} from "@/lib/master-data/actions";
import { formatCityLabel } from "@/lib/master-data/location";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { CityCombobox } from "@/components/master-data/CityCombobox";
import { StateSelect } from "@/components/master-data/StateSelect";
import type {
  CitySearchResult,
  GeographyCounts,
  MasterCategory,
  MasterDataDomain,
  PlatformFeature,
  PlatformLanguage,
  UsStateOption,
} from "@/types/master-data";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const TABS = [
  { id: "categories", label: "Категории" },
  { id: "features", label: "Фичи" },
  { id: "languages", label: "Языки" },
  { id: "geography", label: "География" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type AdminMasterDataPanelProps = {
  listingCategories: MasterCategory[];
  businessCategories: MasterCategory[];
  features: PlatformFeature[];
  languages: PlatformLanguage[];
  states: UsStateOption[];
  geographyCounts: GeographyCounts;
};

export function AdminMasterDataPanel({
  listingCategories,
  businessCategories,
  features,
  languages,
  states,
  geographyCounts,
}: AdminMasterDataPanelProps) {
  const [tab, setTab] = useState<TabId>("categories");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Ошибка");
      else setMessage(result.message ?? successFallback);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            }`}
            onClick={() => setTab(t.id)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}
      {pending && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <BrandPinLoader size="sm" />
          Сохранение…
        </p>
      )}

      {tab === "categories" && (
        <CategoriesTab
          businessCategories={businessCategories}
          listingCategories={listingCategories}
          pending={pending}
          run={run}
        />
      )}
      {tab === "features" && (
        <FeaturesTab features={features} pending={pending} run={run} />
      )}
      {tab === "languages" && (
        <LanguagesTab languages={languages} pending={pending} run={run} />
      )}
      {tab === "geography" && (
        <GeographyTab
          counts={geographyCounts}
          pending={pending}
          run={run}
          states={states}
        />
      )}
    </div>
  );
}

function CategoriesTab({
  listingCategories,
  businessCategories,
  pending,
  run,
}: {
  listingCategories: MasterCategory[];
  businessCategories: MasterCategory[];
  pending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) => void;
}) {
  const [domain, setDomain] = useState<"marketplace" | "services" | "business">(
    "marketplace",
  );
  const [editing, setEditing] = useState<MasterCategory | null>(null);
  const [form, setForm] = useState({
    nameRu: "",
    nameEn: "",
    slug: "",
    sortOrder: "0",
    parentId: "",
    iconKey: "",
    disclaimerText: "",
    isActive: true,
    isSelectable: true,
  });

  const rows = useMemo(() => {
    if (domain === "business") return businessCategories;
    return listingCategories.filter((c) => c.domain === domain);
  }, [domain, listingCategories, businessCategories]);

  const parents = rows.filter((c) => !c.parentId);

  function startCreate() {
    setEditing(null);
    setForm({
      nameRu: "",
      nameEn: "",
      slug: "",
      sortOrder: "0",
      parentId: "",
      iconKey: "",
      disclaimerText: "",
      isActive: true,
      isSelectable: true,
    });
  }

  function startEdit(cat: MasterCategory) {
    setEditing(cat);
    setForm({
      nameRu: cat.nameRu,
      nameEn: cat.nameEn ?? "",
      slug: cat.slug,
      sortOrder: String(cat.sortOrder),
      parentId: cat.parentId ?? "",
      iconKey: cat.iconKey ?? "",
      disclaimerText: cat.disclaimerText ?? "",
      isActive: cat.isActive,
      isSelectable: cat.isSelectable,
    });
  }

  function save() {
    if (domain === "business") return;
    run(
      () =>
        adminUpsertListingCategoryAction({
          id: editing?.id ?? null,
          slug: form.slug,
          nameRu: form.nameRu,
          nameEn: form.nameEn || null,
          parentId: form.parentId || null,
          domain: domain,
          listingType: domain === "services" ? "service" : "marketplace_item",
          sortOrder: Number(form.sortOrder) || 0,
          isActive: form.isActive,
          iconKey: form.iconKey || null,
          disclaimerText: form.disclaimerText || null,
          isSelectable: form.isSelectable,
        }),
      "Категория сохранена.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["marketplace", "Marketplace"],
            ["services", "Услуги"],
            ["business", "Бизнес"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              domain === id
                ? "bg-slate-800 text-white"
                : "border border-slate-200 bg-white text-slate-700"
            }`}
            onClick={() => {
              setDomain(id);
              startCreate();
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {domain === "business" ? (
        <p className="text-sm text-slate-500">
          Категории бизнесов (таблица <code className="text-xs">categories</code>
          ) — фильтры на /search, только просмотр. Не путать с разделами
          платформы (Marketplace / Услуги / Лечу / Переводы) и их{" "}
          <code className="text-xs">listing_categories</code>.
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">
            {editing ? "Редактировать категорию" : "Новая категория"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Название (RU)</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                onChange={(e) => setForm((f) => ({ ...f, nameRu: e.target.value }))}
                value={form.nameRu}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Name (EN)</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
                value={form.nameEn}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Slug</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                value={form.slug}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Sort</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                onChange={(e) =>
                  setForm((f) => ({ ...f, sortOrder: e.target.value }))
                }
                type="number"
                value={form.sortOrder}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Parent</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                onChange={(e) =>
                  setForm((f) => ({ ...f, parentId: e.target.value }))
                }
                value={form.parentId}
              >
                <option value="">—</option>
                {parents
                  .filter((p) => p.id !== editing?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameRu}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Icon key</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                onChange={(e) =>
                  setForm((f) => ({ ...f, iconKey: e.target.value }))
                }
                value={form.iconKey}
              />
            </label>
            <label className="block space-y-1 text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Disclaimer</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                onChange={(e) =>
                  setForm((f) => ({ ...f, disclaimerText: e.target.value }))
                }
                value={form.disclaimerText}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                checked={form.isActive}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isActive: e.target.checked }))
                }
                type="checkbox"
              />
              Активна
            </label>
            <label className="flex items-center gap-2">
              <input
                checked={form.isSelectable}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isSelectable: e.target.checked }))
                }
                type="checkbox"
              />
              Выбираемая
            </label>
          </div>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={save} type="button">
              Сохранить
            </Button>
            {editing && (
              <Button
                disabled={pending}
                onClick={startCreate}
                type="button"
                variant="secondary"
              >
                Сброс
              </Button>
            )}
          </div>
        </div>
      )}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {rows.map((cat) => (
          <li
            key={cat.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div>
              <p className="font-medium text-slate-900">
                {cat.nameRu}{" "}
                <span className="text-xs font-normal text-slate-400">
                  {cat.slug}
                </span>
              </p>
              <p className="text-xs text-slate-500">
                sort {cat.sortOrder}
                {cat.isActive ? "" : " · выкл"}
                {cat.iconKey ? ` · ${cat.iconKey}` : ""}
              </p>
            </div>
            {domain !== "business" && (
              <div className="flex gap-2">
                <Button
                  disabled={pending}
                  onClick={() => startEdit(cat)}
                  type="button"
                  variant="secondary"
                >
                  Изменить
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        adminSetListingCategoryActiveAction(
                          cat.id,
                          !cat.isActive,
                        ),
                      "Статус обновлён.",
                    )
                  }
                  type="button"
                  variant="secondary"
                >
                  {cat.isActive ? "Выкл" : "Вкл"}
                </Button>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-6 text-sm text-slate-500">Нет категорий</li>
        )}
      </ul>
    </div>
  );
}

function FeaturesTab({
  features,
  pending,
  run,
}: {
  features: PlatformFeature[];
  pending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    nameEn: "",
    nameRu: "",
    description: "",
    domains: "business,services",
    sortOrder: "0",
    isActive: true,
  });

  function startCreate() {
    setEditingId(null);
    setForm({
      code: "",
      nameEn: "",
      nameRu: "",
      description: "",
      domains: "business,services",
      sortOrder: "0",
      isActive: true,
    });
  }

  function startEdit(f: PlatformFeature) {
    setEditingId(f.id);
    setForm({
      code: f.code,
      nameEn: f.nameEn,
      nameRu: f.nameRu ?? "",
      description: f.description ?? "",
      domains: f.domains.join(","),
      sortOrder: String(f.sortOrder),
      isActive: f.isActive,
    });
  }

  function save() {
    const domains = form.domains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean) as MasterDataDomain[];
    run(
      () =>
        adminUpsertFeatureAction({
          id: editingId,
          code: form.code,
          nameEn: form.nameEn,
          nameRu: form.nameRu || null,
          description: form.description || null,
          domains,
          sortOrder: Number(form.sortOrder) || 0,
          isActive: form.isActive,
        }),
      "Фича сохранена.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          {editingId ? "Редактировать фичу" : "Новая фича"}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Code</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              value={form.code}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Domains</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              onChange={(e) =>
                setForm((f) => ({ ...f, domains: e.target.value }))
              }
              placeholder="business,services"
              value={form.domains}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Name EN</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              onChange={(e) =>
                setForm((f) => ({ ...f, nameEn: e.target.value }))
              }
              value={form.nameEn}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Name RU</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              onChange={(e) =>
                setForm((f) => ({ ...f, nameRu: e.target.value }))
              }
              value={form.nameRu}
            />
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Description</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              value={form.description}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Sort</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              onChange={(e) =>
                setForm((f) => ({ ...f, sortOrder: e.target.value }))
              }
              type="number"
              value={form.sortOrder}
            />
          </label>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              checked={form.isActive}
              onChange={(e) =>
                setForm((f) => ({ ...f, isActive: e.target.checked }))
              }
              type="checkbox"
            />
            Активна
          </label>
        </div>
        <div className="flex gap-2">
          <Button disabled={pending} onClick={save} type="button">
            Сохранить
          </Button>
          {editingId && (
            <Button
              disabled={pending}
              onClick={startCreate}
              type="button"
              variant="secondary"
            >
              Сброс
            </Button>
          )}
        </div>
      </div>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {features.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div>
              <p className="font-medium text-slate-900">
                {f.nameRu || f.nameEn}{" "}
                <span className="text-xs font-normal text-slate-400">
                  {f.code}
                </span>
              </p>
              <p className="text-xs text-slate-500">
                {f.domains.join(", ")} · sort {f.sortOrder}
                {f.isActive ? "" : " · выкл"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={pending}
                onClick={() => startEdit(f)}
                type="button"
                variant="secondary"
              >
                Изменить
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      adminUpsertFeatureAction({
                        id: f.id,
                        isActive: !f.isActive,
                      }),
                    "Статус обновлён.",
                  )
                }
                type="button"
                variant="secondary"
              >
                {f.isActive ? "Выкл" : "Вкл"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LanguagesTab({
  languages,
  pending,
  run,
}: {
  languages: PlatformLanguage[];
  pending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) => void;
}) {
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {languages.map((lang) => (
        <li
          key={lang.code}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div>
            <p className="font-medium text-slate-900">
              {lang.nameRu || lang.nameNative || lang.nameEn}{" "}
              <span className="text-xs font-normal text-slate-400">
                {lang.code}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {lang.nameEn}
              {lang.isActive ? "" : " · выкл"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-slate-600">
              Sort
              <input
                className="w-20 rounded-lg border border-slate-200 px-2 py-1"
                defaultValue={lang.sortOrder}
                disabled={pending}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next) || next === lang.sortOrder) return;
                  run(
                    () => adminSetLanguageSortAction(lang.code, next),
                    "Порядок обновлён.",
                  );
                }}
                type="number"
              />
            </label>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    adminSetLanguageActiveAction(lang.code, !lang.isActive),
                  "Статус языка обновлён.",
                )
              }
              type="button"
              variant="secondary"
            >
              {lang.isActive ? "Выкл" : "Вкл"}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GeographyTab({
  counts,
  states,
  pending,
  run,
}: {
  counts: GeographyCounts;
  states: UsStateOption[];
  pending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) => void;
}) {
  const [stateCode, setStateCode] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [lastCity, setLastCity] = useState<CitySearchResult | null>(null);

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Страны", counts.countries],
            ["Штаты / регионы", counts.subdivisions],
            ["Округа", counts.counties],
            ["Города", counts.cities],
          ] as const
        ).map(([label, n]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <dt className="text-xs uppercase tracking-wide text-slate-400">
              {label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{n}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Тест поиска городов
        </h3>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Штат (фильтр)</span>
          <StateSelect
            onChange={(code) => setStateCode(code)}
            states={states}
            value={stateCode}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Город</span>
          <CityCombobox
            onCityChange={setCityQuery}
            onSelect={async (sel) => {
              setCityQuery(sel.city);
              setStateCode(sel.stateCode);
              const result = await searchCitiesAction(sel.city, sel.stateCode);
              if (result.ok) {
                const match =
                  result.cities.find((c) => c.geoid === sel.cityGeoid) ?? null;
                setLastCity(match);
              }
            }}
            stateCode={stateCode || null}
            states={states}
            value={cityQuery}
          />
        </label>

        {lastCity && (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <p className="font-medium text-slate-900">
              {formatCityLabel(lastCity, states)}
            </p>
            <p className="text-xs text-slate-500">geoid {lastCity.geoid}</p>
            <Button
              className="mt-2"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    adminSetLocationActiveAction(
                      "city",
                      lastCity.geoid,
                      false,
                    ),
                  "Город отключён.",
                )
              }
              type="button"
              variant="secondary"
            >
              Отключить город
            </Button>
            <Button
              className="mt-2 ml-2"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    adminSetLocationActiveAction(
                      "city",
                      lastCity.geoid,
                      true,
                    ),
                  "Город включён.",
                )
              }
              type="button"
              variant="secondary"
            >
              Включить город
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
