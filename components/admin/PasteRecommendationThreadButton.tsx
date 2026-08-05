"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { pasteRecommendationThreadAction } from "@/lib/import-review/recommendation-actions";
import { parseRecommendationThread } from "@/lib/import-review/parse-recommendation-thread";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

export function PasteRecommendationThreadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview =
    text.trim().length >= 40 ? parseRecommendationThread(text) : null;

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        className="text-sm"
        onClick={() => {
          setOpen((v) => !v);
          setMessage(null);
          setError(null);
        }}
      >
        <ClipboardPaste className="mr-1.5 size-4" />
        {open ? "Скрыть вставку" : "Вставить тред"}
      </Button>
      {open ? (
        <div className="mt-2 max-w-xl space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-600">
            Вставьте пост «посоветуйте…» вместе с комментариями. Вытащим шопы
            по телефонам, FB/IG/Maps и именам вроде «Euroman».
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Друзья подскажите автомастерскую…&#10;Reply&#10;Yulia …&#10;Laguna Niguel Collision&#10;https://www.facebook.com/…"
            className="min-h-40 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none ring-brand-blue focus:ring-2"
          />
          {preview ? (
            <p className="text-xs text-slate-600">
              Превью: {preview.clusters.length} рекомендаций
              {preview.skippedNoise
                ? ` · шум ${preview.skippedNoise}`
                : ""}
              {preview.clusters[0]?.display_name
                ? ` · напр. ${preview.clusters
                    .slice(0, 3)
                    .map((c) => c.display_name)
                    .filter(Boolean)
                    .join(", ")}`
                : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending || text.trim().length < 40}
              onClick={() => {
                setError(null);
                setMessage(null);
                startTransition(async () => {
                  const res = await pasteRecommendationThreadAction({ text });
                  if (!res.ok) {
                    setError(res.message);
                    return;
                  }
                  setMessage(res.message);
                  setText("");
                  router.refresh();
                });
              }}
            >
              {pending ? (
                <>
                  <BrandPinLoader size="sm" className="mr-2" />
                  Разбираю…
                </>
              ) : (
                "Разобрать в рекомендации"
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setText("");
                setOpen(false);
                setError(null);
                setMessage(null);
              }}
            >
              Отмена
            </Button>
          </div>
          {message ? (
            <p className="text-xs text-emerald-700">{message}</p>
          ) : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
      {!open && message ? (
        <p className="text-xs text-emerald-700">{message}</p>
      ) : null}
    </div>
  );
}
