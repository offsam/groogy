/** Checklist of fields needed before publishing a preview card. */

export type CompletenessField = {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
};

export type CompletenessReport = {
  fields: CompletenessField[];
  readyCount: number;
  total: number;
  missing: CompletenessField[];
};

function report(fields: CompletenessField[]): CompletenessReport {
  const readyCount = fields.filter((f) => f.ok).length;
  return {
    fields,
    readyCount,
    total: fields.length,
    missing: fields.filter((f) => !f.ok),
  };
}

/** 0–100 from checklist ready/total. */
export function completenessPercent(report: CompletenessReport): number {
  if (report.total <= 0) return 0;
  return Math.round((report.readyCount / report.total) * 100);
}

export function businessPreviewCompleteness(input: {
  name?: string | null;
  categoryName?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  instagramUrl?: string | null;
  imageUrl?: string | null;
  city?: string | null;
  addressLine?: string | null;
}): CompletenessReport {
  const hasContact = Boolean(
    input.phone || input.email || input.website || input.instagramUrl,
  );
  const hasCopy = Boolean(
    (input.shortDescription || "").trim() || (input.description || "").trim(),
  );
  return report([
    {
      key: "name",
      label: "Название",
      ok: Boolean((input.name || "").trim()),
    },
    {
      key: "category",
      label: "Категория",
      ok: Boolean((input.categoryName || "").trim()),
      hint: "без категории сложнее найти в каталоге",
    },
    {
      key: "city",
      label: "Город / район",
      ok: Boolean((input.city || "").trim()),
      hint: "из поста или из группы-источника",
    },
    {
      key: "contact",
      label: "Контакт",
      ok: hasContact,
      hint: "телефон, сайт, Instagram или email",
    },
    {
      key: "copy",
      label: "Описание",
      ok: hasCopy,
      hint: "короткий текст для карточки",
    },
    {
      key: "photo",
      label: "Фото",
      ok: Boolean((input.imageUrl || "").trim()),
      hint: "можно опубликовать без фото",
    },
    {
      key: "address",
      label: "Адрес",
      ok: Boolean((input.addressLine || "").trim()),
      hint: "нужен для карты",
    },
  ]);
}

export function professionalPreviewCompleteness(input: {
  displayName?: string | null;
  categoryName?: string | null;
  headline?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  instagramUrl?: string | null;
  imageUrl?: string | null;
  city?: string | null;
}): CompletenessReport {
  const hasContact = Boolean(
    input.phone || input.email || input.website || input.instagramUrl,
  );
  const hasCopy = Boolean(
    (input.shortDescription || "").trim() ||
      (input.description || "").trim() ||
      (input.headline || "").trim(),
  );
  return report([
    {
      key: "name",
      label: "Имя",
      ok: Boolean((input.displayName || "").trim()),
    },
    {
      key: "category",
      label: "Специальность",
      ok: Boolean(
        (input.categoryName || "").trim() || (input.headline || "").trim(),
      ),
    },
    {
      key: "city",
      label: "Город / район",
      ok: Boolean((input.city || "").trim()),
      hint: "из поста или из группы-источника",
    },
    {
      key: "contact",
      label: "Контакт",
      ok: hasContact,
      hint: "телефон, сайт, Instagram или email",
    },
    {
      key: "copy",
      label: "О себе",
      ok: hasCopy,
    },
    {
      key: "photo",
      label: "Фото",
      ok: Boolean((input.imageUrl || "").trim()),
      hint: "можно опубликовать без фото",
    },
  ]);
}

export function listingPreviewCompleteness(input: {
  title?: string | null;
  description?: string | null;
  city?: string | null;
  phone?: string | null;
  imageUrl?: string | null;
  priceAmount?: number | null;
}): CompletenessReport {
  return report([
    {
      key: "title",
      label: "Заголовок",
      ok: Boolean((input.title || "").trim()),
    },
    {
      key: "description",
      label: "Описание",
      ok: Boolean((input.description || "").trim()),
    },
    {
      key: "city",
      label: "Город",
      ok: Boolean((input.city || "").trim()),
    },
    {
      key: "contact",
      label: "Контакт",
      ok: Boolean((input.phone || "").trim()),
    },
    {
      key: "photo",
      label: "Фото",
      ok: Boolean((input.imageUrl || "").trim()),
    },
    {
      key: "price",
      label: "Цена",
      ok: input.priceAmount != null,
      hint: "не обязательно",
    },
  ]);
}
