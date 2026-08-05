"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  adminUpsertChurchAction,
  uploadChurchCoverAction,
} from "@/lib/churches/admin-actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { AddressFieldsEditor } from "@/components/business/AddressFieldsEditor";
import { ContactLinksEditor } from "@/components/contacts/ContactLinksEditor";
import {
  normalizeStructuredAddress,
  type StructuredAddress,
} from "@/lib/address/normalize";
import {
  parseContactLinks,
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";
import { slugifyChurchName } from "@/lib/churches/mappers";
import type {
  ChurchMinistry,
  ChurchSourceKind,
  ChurchStatus,
} from "@/types/church";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type AdminChurchFormProps = {
  initial?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    phone: string | null;
    email?: string | null;
    website: string | null;
    instagram_url: string | null;
    telegram_url?: string | null;
    google_maps_url?: string | null;
    contact_links?: unknown;
    city: string | null;
    address_line: string | null;
    region?: string | null;
    state_code?: string | null;
    postal_code?: string | null;
    status: ChurchStatus;
    source_url?: string | null;
    source_kind?: ChurchSourceKind;
    image_url?: string | null;
    schedule_text?: string | null;
    ministries?: ChurchMinistry[];
  };
};

function ministriesToLines(items: ChurchMinistry[] | undefined): string {
  if (!items?.length) return "";
  return items
    .map((m) => {
      const parts = [m.title.trim()];
      if (m.detail?.trim()) parts.push(m.detail.trim());
      if (m.url?.trim()) {
        if (parts.length === 1) parts.push("");
        parts.push(m.url.trim());
      }
      return parts.join(" | ");
    })
    .join("\n");
}

export function AdminChurchForm({ initial }: AdminChurchFormProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
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
      const result = await adminUpsertChurchAction({
        id: initial?.id,
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
        description: String(formData.get("description") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        website: String(formData.get("website") ?? ""),
        city: address.city ?? "",
        addressLine: address.addressLine ?? "",
        region: address.region,
        stateCode: address.stateCode,
        postalCode: address.postalCode,
        email: String(formData.get("email") ?? ""),
        instagramUrl: String(formData.get("instagramUrl") ?? ""),
        telegramUrl: String(formData.get("telegramUrl") ?? ""),
        googleMapsUrl: String(formData.get("googleMapsUrl") ?? ""),
        contactLinks: serializeContactLinks(links),
        sourceUrl: String(formData.get("sourceUrl") ?? ""),
        sourceKind: (String(formData.get("sourceKind") ?? "") ||
          null) as ChurchSourceKind,
        imageUrl: String(formData.get("imageUrl") ?? ""),
        scheduleText: String(formData.get("scheduleText") ?? ""),
        ministries: String(formData.get("ministries") ?? ""),
        status: String(formData.get("status") ?? "draft") as ChurchStatus,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Сохранено");
      router.push("/admin/catalog/churches");
      router.refresh();
    });
  }

  async function onCoverFile(file: File | null) {
    if (!file || !initial?.id) return;
    setError(null);
    setMessage(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const result = await uploadChurchCoverAction({
        churchId: initial.id,
        churchSlug: slug || initial.slug,
        formData: fd,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.imageUrl) setImageUrl(result.imageUrl);
      setMessage(result.message ?? "Фото обновлено.");
      router.refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
    >
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
            if (!slugTouched) setSlug(slugifyChurchName(e.target.value));
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
          className="min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2"
          defaultValue={initial?.description ?? ""}
          name="description"
          placeholder="Без телефонов и адреса — они в блоках ниже"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Расписание (текст)</span>
        <input
          className="w-full rounded-lg border border-slate-200 px-3 py-2"
          defaultValue={initial?.schedule_text ?? ""}
          name="scheduleText"
          placeholder="Напр. Вс 11:00 · онлайн"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Служения</span>
        <textarea
          className="min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
          defaultValue={ministriesToLines(initial?.ministries)}
          name="ministries"
          placeholder={"Детская программа\nОнлайн-трансляция | каждое воскресенье | https://…"}
        />
        <span className="text-xs text-slate-500">
          По одной строке: название или «название | детали | url»
        </span>
      </label>

      <div className="space-y-2 rounded-xl border border-slate-100 p-3">
        <p className="text-sm font-medium text-slate-700">Фото</p>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-36 w-full rounded-lg object-cover"
            src={imageUrl}
          />
        ) : (
          <div className="flex h-28 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
            Нет фото
          </div>
        )}
        {initial?.id ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              type="file"
              onChange={(e) => void onCoverFile(e.target.files?.[0] ?? null)}
            />
            <Button
              disabled={uploading || pending}
              type="button"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <>
                  <BrandPinLoader size="sm" />
                  Загрузка…
                </>
              ) : (
                "Загрузить фото"
              )}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Сначала сохраните карточку — потом можно загрузить файл. Или
            укажите URL ниже.
          </p>
        )}
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">или URL</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            name="imageUrl"
            placeholder="https://"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
        </label>
      </div>

      <AddressFieldsEditor
        businessName={name}
        value={address}
        onChange={setAddress}
      />

      <fieldset className="space-y-3 rounded-xl border border-slate-100 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">
          Контакты
        </legend>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">Телефон</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.phone ?? ""}
            name="phone"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">Email</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.email ?? ""}
            name="email"
            type="email"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">Сайт</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.website ?? ""}
            name="website"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">Instagram</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.instagram_url ?? ""}
            name="instagramUrl"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">Telegram</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.telegram_url ?? ""}
            name="telegramUrl"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">Google Maps URL</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.google_maps_url ?? ""}
            name="googleMapsUrl"
          />
        </label>
        <ContactLinksEditor
          exclude={["phone", "email", "website", "instagram", "telegram"]}
          value={links}
          onChange={setLinks}
        />
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-slate-100 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">
          Источник
        </legend>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">Тип</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.source_kind ?? "platform"}
            name="sourceKind"
          >
            <option value="platform">КРУГИ / admin</option>
            <option value="telegram">Telegram</option>
            <option value="facebook">Facebook</option>
            <option value="directory">Справочник</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">URL источника</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            defaultValue={initial?.source_url ?? ""}
            name="sourceUrl"
            placeholder="https://"
          />
        </label>
      </fieldset>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Статус</span>
        <select
          className="w-full rounded-lg border border-slate-200 px-3 py-2"
          defaultValue={initial?.status ?? "draft"}
          name="status"
        >
          <option value="draft">Черновик</option>
          <option value="approved">Опубликовано</option>
          <option value="archived">Архив</option>
        </select>
      </label>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button disabled={pending || uploading} type="submit">
          {pending ? (
            <>
              <BrandPinLoader size="sm" />
              Сохранение…
            </>
          ) : (
            "Сохранить"
          )}
        </Button>
        <Button
          disabled={pending || uploading}
          type="button"
          variant="secondary"
          onClick={() => router.push("/admin/catalog/churches")}
        >
          Отмена
        </Button>
      </div>
    </form>
  );
}
