"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveCouponAction,
  createCouponAction,
  reviewCouponSubmissionAction,
} from "@/lib/coupons/actions";
import { Button } from "@/components/ui/Button";
import { AuthAlert } from "@/components/auth/AuthShell";
import type { Coupon, CouponSubmission } from "@/types/coupon";

type Category = { id: string; name: string; slug: string };

type Props = {
  submissions: CouponSubmission[];
  myCoupons: Coupon[];
  categories: Category[];
};

type Tab = "new" | "queue" | "mine";

export function CuratorManagePanel({ submissions, myCoupons, categories }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(submissions.length > 0 ? "queue" : "new");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // New post form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [categoryId, setCategoryId] = useState("");

  function publish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await createCouponAction({
        title,
        body,
        imageUrl: imageUrl || null,
        linkUrl: linkUrl || null,
        promoCode: promoCode || null,
        categoryId: categoryId || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Опубликовано.");
      setTitle("");
      setBody("");
      setImageUrl("");
      setLinkUrl("");
      setPromoCode("");
      setCategoryId("");
      router.refresh();
    });
  }

  function review(id: string, decision: "approve" | "reject") {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await reviewCouponSubmissionAction({ id, decision });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Готово.");
      router.refresh();
    });
  }

  function archive(id: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await archiveCouponAction({ id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Готово.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "new", label: "Новый пост" },
            { id: "queue", label: `Предложения (${submissions.length})` },
            { id: "mine", label: "Мои посты" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              tab === t.id
                ? "border-brand-blue bg-brand-blue text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
            type="button"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      {tab === "new" ? (
        <form className="max-w-xl space-y-4" onSubmit={publish}>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Заголовок</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
              maxLength={200}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Текст поста</span>
            <textarea
              className="min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
              maxLength={4000}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Фото (ссылка)</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                placeholder="https://…"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Категория</span>
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Без категории</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Ссылка</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                placeholder="https://… (или оставь — найдём в тексте)"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Промокод</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
              />
            </label>
          </div>
          <Button
            disabled={pending || title.trim().length < 3 || body.trim().length < 10}
            type="submit"
          >
            {pending ? "Публикую…" : "Опубликовать"}
          </Button>
        </form>
      ) : null}

      {tab === "queue" ? (
        submissions.length === 0 ? (
          <p className="text-sm text-slate-500">Нет предложений на рассмотрении.</p>
        ) : (
          <ul className="space-y-4">
            {submissions.map((s) => (
              <li key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-400">
                  От {s.submitterName || "пользователя"} ·{" "}
                  {new Date(s.createdAt).toLocaleString("ru-RU")}
                </p>
                <p className="mt-1 font-semibold text-slate-900">{s.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{s.body}</p>
                {s.linkUrl ? (
                  <a
                    className="mt-1 inline-block text-sm text-brand-blue hover:underline"
                    href={s.linkUrl}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                  >
                    {s.linkUrl}
                  </a>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button disabled={pending} type="button" onClick={() => review(s.id, "approve")}>
                    Одобрить
                  </Button>
                  <Button
                    disabled={pending}
                    type="button"
                    variant="secondary"
                    onClick={() => review(s.id, "reject")}
                  >
                    Отклонить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "mine" ? (
        myCoupons.length === 0 ? (
          <p className="text-sm text-slate-500">Постов ещё нет.</p>
        ) : (
          <ul className="space-y-3">
            {myCoupons.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{c.title}</p>
                  <p className="text-xs text-slate-400">
                    {c.status === "archived" ? "В архиве" : "Опубликовано"} ·{" "}
                    {new Date(c.publishedAt).toLocaleDateString("ru-RU")}
                  </p>
                </div>
                {c.status === "published" ? (
                  <Button
                    disabled={pending}
                    type="button"
                    variant="secondary"
                    onClick={() => archive(c.id)}
                  >
                    В архив
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
