"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { adminUpsertBusinessAction } from "@/lib/admin/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { AddressFieldsEditor } from "@/components/business/AddressFieldsEditor";
import { ContactLinksEditor } from "@/components/contacts/ContactLinksEditor";
import {
  normalizeStructuredAddress,
  type StructuredAddress,
} from "@/lib/address/normalize";
import {
  CONTACT_LINKS_COLUMN_READY,
  parseContactLinks,
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";
import {
  isYelpUrl,
  normalizeYelpBizUrl,
} from "@/lib/business/presence";
import { catalogCardSlug } from "@/lib/routing/ascii-slug";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type CategoryOption = { id: string; name: string; slug: string };

type AdminBusinessFormProps = {
  categories: CategoryOption[];
  initial?: {
    id: string;
    name: string;
    slug: string;
    short_description: string | null;
    description: string | null;
    phone: string | null;
    email?: string | null;
    website: string | null;
    instagram_url: string | null;
    telegram_url?: string | null;
    yelp_url?: string | null;
    contact_links?: unknown;
    google_maps_url: string | null;
    google_rating: number | null;
    google_reviews_count: number;
    city: string | null;
    address_line: string | null;
    region?: string | null;
    state_code?: string | null;
    postal_code?: string | null;
    status: "draft" | "pending" | "approved" | "rejected" | "archived" | "deferred";
    category_id: string | null;
  };
};

function slugify(value: string): string {
  return catalogCardSlug({ name: value, fallback: "business" }).slice(0, 80);
}

export function AdminBusinessForm({ categories, initial }: AdminBusinessFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [address, setAddress] = useState<StructuredAddress>(() =>
    normalizeStructuredAddress({
      addressLine: initial?.address_line,
      city: initial?.city,
      region: initial?.region,
      stateCode: initial?.state_code,
      postalCode: initial?.postal_code,
    }),
  );
  const [links, setLinks] = useState<ContactLink[]>(() =>
    parseContactLinks(initial?.contact_links),
  );

  function onSubmit(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const rawWebsite = String(formData.get("website") ?? "").trim();
      const rawYelp = String(formData.get("yelpUrl") ?? "").trim();
      const websiteIsYelp = Boolean(rawWebsite && isYelpUrl(rawWebsite));
      const website = websiteIsYelp ? "" : rawWebsite;
      const yelpUrl =
        normalizeYelpBizUrl(rawYelp) ||
        (websiteIsYelp ? normalizeYelpBizUrl(rawWebsite) : null) ||
        "";
      const result = await adminUpsertBusinessAction({
        id: initial?.id,
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
        shortDescription: String(formData.get("shortDescription") ?? ""),
        description: String(formData.get("description") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        website,
        city: address.city ?? "",
        addressLine: address.addressLine ?? "",
        region: address.region,
        stateCode: address.stateCode,
        postalCode: address.postalCode,
        email: String(formData.get("email") ?? ""),
        instagramUrl: String(formData.get("instagramUrl") ?? ""),
        telegramUrl: String(formData.get("telegramUrl") ?? ""),
        yelpUrl,
        contactLinks: serializeContactLinks(links),
        googleMapsUrl: String(formData.get("googleMapsUrl") ?? ""),
        googleRating: (() => {
          const raw = String(formData.get("googleRating") ?? "").trim();
          if (!raw) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        })(),
        googleReviewsCount: (() => {
          const raw = String(formData.get("googleReviewsCount") ?? "").trim();
          if (!raw) return 0;
          const n = Number(raw);
          return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
        })(),
        status: String(formData.get("status") ?? "pending") as
          | "pending"
          | "approved"
          | "rejected"
          | "archived"
          | "draft"
          | "deferred",
        categoryId: String(formData.get("categoryId") || "") || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Сохранено");
      router.push("/admin/businesses");
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Название</span>
        <input
          className="w-full rounded-lg border border-slate-200 px-3 py-2"
          name="name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Slug (URL)</span>
        <input
          className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Описание</span>
        <textarea
          className="min-h-32 w-full rounded-lg border border-slate-200 px-3 py-2"
          defaultValue={
            initial?.description?.trim() ||
            initial?.short_description?.trim() ||
            ""
          }
          name="description"
        />
      </label>
      <input name="shortDescription" type="hidden" value="" />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Телефон</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.phone ?? ""}
            name="phone"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Сайт / Instagram</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.website ?? ""}
            name="website"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Email</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.email ?? ""}
            name="email"
            type="email"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Instagram URL</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.instagram_url ?? ""}
            name="instagramUrl"
            placeholder="https://instagram.com/…"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Telegram</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.telegram_url ?? ""}
            name="telegramUrl"
            placeholder="@username (пусто = убрать)"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Yelp URL</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.yelp_url ?? ""}
            name="yelpUrl"
            placeholder="https://www.yelp.com/biz/…"
          />
        </label>
        {CONTACT_LINKS_COLUMN_READY ? (
          <div className="sm:col-span-2">
            <ContactLinksEditor
              exclude={["website", "instagram", "telegram", "yelp", "google_maps"]}
              value={links}
              onChange={setLinks}
            />
          </div>
        ) : null}
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium text-slate-700">Адрес</p>
          <p className="text-xs text-slate-500">
            Улица отдельно от города, штата, ZIP и округа — без дублей в одной строке.
          </p>
          <AddressFieldsEditor
          businessName={name || initial?.name}
          value={address}
          onChange={setAddress}
        />
        </div>
        <label className="block space-y-1 text-sm sm:col-span-2">
          <span className="font-medium text-slate-700">Google Maps URL</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.google_maps_url ?? ""}
            name="googleMapsUrl"
            placeholder="https://maps.google.com/…"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Рейтинг Google</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.google_rating ?? ""}
            max={5}
            min={0}
            name="googleRating"
            placeholder="4.7"
            step="0.1"
            type="number"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Отзывов Google</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.google_reviews_count ?? 0}
            min={0}
            name="googleReviewsCount"
            type="number"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Статус</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.status ?? "pending"}
            name="status"
          >
            <option value="pending">На проверке</option>
            <option value="approved">Опубликован</option>
            <option value="rejected">Отклонён</option>
            <option value="deferred">Отложен</option>
            <option value="archived">Архив</option>
            <option value="draft">Черновик</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Категория</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.category_id ?? ""}
            name="categoryId"
          >
            <option value="">Без категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Button className="gap-2" disabled={pending} type="submit" variant="primary">
        {pending ? <BrandPinLoader size="sm" /> : null}
        {initial ? "Сохранить" : "Создать бизнес"}
      </Button>
    </form>
  );
}
