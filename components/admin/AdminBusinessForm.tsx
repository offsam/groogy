"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { adminUpsertBusinessAction } from "@/lib/admin/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";

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
    website: string | null;
    instagram_url: string | null;
    google_maps_url: string | null;
    google_rating: number | null;
    google_reviews_count: number;
    city: string | null;
    address_line: string | null;
    status: "draft" | "pending" | "approved" | "rejected" | "archived";
    category_id: string | null;
  };
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function AdminBusinessForm({ categories, initial }: AdminBusinessFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));

  function onSubmit(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await adminUpsertBusinessAction({
        id: initial?.id,
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
        shortDescription: String(formData.get("shortDescription") ?? ""),
        description: String(formData.get("description") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        website: String(formData.get("website") ?? ""),
        city: String(formData.get("city") ?? ""),
        addressLine: String(formData.get("addressLine") ?? ""),
        instagramUrl: String(formData.get("instagramUrl") ?? ""),
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
          | "draft",
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
        <span className="font-medium text-slate-700">Краткое описание</span>
        <input
          className="w-full rounded-lg border border-slate-200 px-3 py-2"
          defaultValue={initial?.short_description ?? ""}
          name="shortDescription"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Описание</span>
        <textarea
          className="min-h-32 w-full rounded-lg border border-slate-200 px-3 py-2"
          defaultValue={initial?.description ?? ""}
          name="description"
        />
      </label>

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
          <span className="font-medium text-slate-700">Instagram URL</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.instagram_url ?? ""}
            name="instagramUrl"
            placeholder="https://instagram.com/…"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Город</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.city ?? ""}
            name="city"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Адрес</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.address_line ?? ""}
            name="addressLine"
          />
        </label>
        <label className="block space-y-1 text-sm">
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
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {initial ? "Сохранить" : "Создать бизнес"}
      </Button>
    </form>
  );
}
