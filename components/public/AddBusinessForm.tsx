"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { AuthAlert } from "@/components/auth/AuthShell";
import { submitBusinessAction } from "@/lib/public-submit/actions";

const CATEGORIES = [
  "Рестораны кафе",
  "Продукты",
  "Красота",
  "Автосервис",
  "Медицина",
  "Юристы",
  "Образование",
  "Мастера / быт",
  "Недвижимость",
  "Спорт и фитнес",
  "Финансы и бухгалтерия",
  "Страхование",
  "Путешествия",
  "Организация праздников",
  "Животные",
  "Массаж и wellness",
  "Здоровье и психика",
  "Дети и няни",
  "Дом и ремонт",
  "Фото и видео",
  "Дизайн и handmade",
  "Готовим",
  "IT и сайты",
  "Прочее",
];

const inputClass = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
const labelClass = "block space-y-1 text-sm";
const labelTextClass = "font-medium text-slate-700";

export function AddBusinessForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await submitBusinessAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message);
      setDone(true);
    });
  }

  if (done) {
    return <AuthAlert tone="success">{message}</AuthAlert>;
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}

      {/* Honeypot — hidden from real users via CSS, bots tend to fill every field. */}
      <div aria-hidden="true" className="hidden">
        <label>
          Оставьте это поле пустым
          <input
            autoComplete="off"
            name="website_url_confirm"
            tabIndex={-1}
            type="text"
          />
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Название бизнеса *</span>
        <input className={inputClass} name="name" required />
      </label>

      <label className={labelClass}>
        <span className={labelTextClass}>Категория</span>
        <select className={inputClass} defaultValue="" name="category">
          <option value="">Не выбрано</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          <span className={labelTextClass}>Город</span>
          <input className={inputClass} name="city" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Штат</span>
          <input className={inputClass} maxLength={20} name="state" placeholder="CA" />
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelTextClass}>Описание</span>
        <textarea
          className="min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          name="description"
          placeholder="Чем занимается бизнес"
        />
      </label>

      <p className="pt-1 text-xs font-medium text-slate-500">
        Укажите хотя бы один способ связи:
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          <span className={labelTextClass}>Телефон</span>
          <input className={inputClass} name="phone" type="tel" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Сайт</span>
          <input className={inputClass} name="website" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Instagram</span>
          <input className={inputClass} name="instagram" placeholder="@handle или ссылка" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Telegram</span>
          <input className={inputClass} name="telegram" placeholder="@username" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
        <label className={labelClass}>
          <span className={labelTextClass}>Ваше имя</span>
          <input className={inputClass} name="contactName" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Ваш email</span>
          <input className={inputClass} name="contactEmail" type="email" />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Эти два поля — только для связи с вами при проверке, на карточке не публикуются.
      </p>

      <Button className="w-full" loading={pending} type="submit">
        Отправить на проверку
      </Button>
    </form>
  );
}
