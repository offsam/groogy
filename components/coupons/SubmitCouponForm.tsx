"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitCouponAction } from "@/lib/coupons/actions";
import { Button } from "@/components/ui/Button";
import { AuthAlert } from "@/components/auth/AuthShell";

export function SubmitCouponForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await submitCouponAction({
        title,
        body,
        imageUrl: imageUrl || null,
        linkUrl: linkUrl || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message ?? "Отправлено.");
      setTitle("");
      setBody("");
      setImageUrl("");
      setLinkUrl("");
      router.refresh();
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {success ? <AuthAlert tone="success">{success}</AuthAlert> : null}

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
        <span className="font-medium text-slate-700">Описание акции</span>
        <textarea
          className="min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          maxLength={4000}
          placeholder="Что за акция, где, какая скидка…"
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Фото (ссылка на картинку)</span>
        <input
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          placeholder="https://…"
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">
          Ссылка на бизнес/акцию (необязательно)
        </span>
        <input
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          placeholder="https://…"
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <span className="block text-xs text-slate-400">
          Если не заполнить — ссылку попробуем найти прямо в тексте описания.
        </span>
      </label>

      <Button
        disabled={pending || title.trim().length < 3 || body.trim().length < 10}
        type="submit"
      >
        {pending ? "Отправляю…" : "Предложить куратору"}
      </Button>
    </form>
  );
}
