"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postCouponCommentAction } from "@/lib/coupons/actions";
import { Button } from "@/components/ui/Button";
import type { CouponComment } from "@/types/coupon";

type Props = {
  couponId: string;
  comments: CouponComment[];
  isLoggedIn: boolean;
};

export function CouponComments({ couponId, comments, isLoggedIn }: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postCouponCommentAction({ couponId, body });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">
        Комментарии {comments.length > 0 ? `(${comments.length})` : ""}
      </h2>

      {isLoggedIn ? (
        <form className="space-y-2" onSubmit={handleSubmit}>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <textarea
            className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
            maxLength={1000}
            placeholder="Написать комментарий…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button disabled={pending || body.trim().length < 1} type="submit">
            {pending ? "Отправляю…" : "Отправить"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-slate-500">
          <a className="text-brand-blue hover:underline" href="/login">
            Войдите
          </a>
          , чтобы оставить комментарий.
        </p>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-slate-500">Пока нет комментариев.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-800">
                {c.authorName || "Пользователь"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
