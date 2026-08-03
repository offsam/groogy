"use server";

import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type SubmitBusinessResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const MAX_SHORT = 200;
const MAX_LONG = 2000;

function clean(value: FormDataEntryValue | null, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export async function submitBusinessAction(
  formData: FormData,
): Promise<SubmitBusinessResult> {
  // Honeypot: real users never fill this hidden field. Bots that fill every
  // field will trip it. Pretend success so bots don't learn to skip it.
  const honeypot = clean(formData.get("website_url_confirm"), MAX_SHORT);
  if (honeypot) {
    return { ok: true, message: "Спасибо! Мы получили заявку." };
  }

  const name = clean(formData.get("name"), MAX_SHORT);
  const category = clean(formData.get("category"), MAX_SHORT);
  const city = clean(formData.get("city"), MAX_SHORT);
  const state = clean(formData.get("state"), 20);
  const description = clean(formData.get("description"), MAX_LONG);
  const phone = clean(formData.get("phone"), MAX_SHORT);
  const website = clean(formData.get("website"), MAX_SHORT);
  const instagram = clean(formData.get("instagram"), MAX_SHORT);
  const telegram = clean(formData.get("telegram"), MAX_SHORT);
  const contactName = clean(formData.get("contactName"), MAX_SHORT);
  const contactEmail = clean(formData.get("contactEmail"), MAX_SHORT);

  if (!name) {
    return { ok: false, message: "Укажите название бизнеса." };
  }
  const hasContact = Boolean(phone || website || instagram || telegram);
  if (!hasContact) {
    return {
      ok: false,
      message: "Укажите хотя бы один способ связи: телефон, сайт, Instagram или Telegram.",
    };
  }

  const noteLines = [
    contactName ? `Контакт для связи (не публикуется): ${contactName}` : null,
    contactEmail ? `Email отправителя (не публикуется): ${contactEmail}` : null,
    "Источник: публичная форма «Добавить бизнес» на сайте.",
  ].filter(Boolean);

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("import_review_items").insert({
    source: "public_form",
    source_fingerprint: `public_form:${randomUUID()}`,
    entity_type: "business",
    target_collection: "businesses",
    business_name: name,
    category: category || null,
    description: description || null,
    city: city || null,
    state: state || null,
    location_source: city ? "manual" : null,
    phone: phone ? [phone] : [],
    website: website ? [website] : [],
    instagram: instagram ? [instagram] : [],
    telegram_username: telegram || null,
    review_status: "pending",
    review_notes: noteLines.join("\n"),
    raw_payload: {
      submitted_via: "public_add_business_form",
      submitted_at: new Date().toISOString(),
      contact_name: contactName || null,
      contact_email: contactEmail || null,
    },
  });

  if (error) {
    return {
      ok: false,
      message: "Не удалось отправить заявку. Попробуйте ещё раз чуть позже.",
    };
  }

  return {
    ok: true,
    message:
      "Спасибо! Заявка отправлена на проверку. Мы опубликуем карточку после модерации.",
  };
}
