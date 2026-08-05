"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { enrichCommentRecommendationAction } from "@/lib/import-review/recommendation-actions";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  recommendationId: string;
  disabled?: boolean;
  /** Match live AdminLensBar chips. */
  variant?: "button" | "chip";
};

/** One-click fill-empty enrich for recommendation queue cards. */
export function ReviewRecommendationEnrichButton({
  recommendationId,
  disabled,
  variant = "button",
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (pending || disabled) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await enrichCommentRecommendationAction({
        id: recommendationId,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message);
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {variant === "chip" ? (
        <button
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          disabled={disabled || pending}
          type="button"
          onClick={run}
        >
          {pending ? (
            <BrandPinLoader size="sm" />
          ) : (
            <Sparkles aria-hidden className="size-3.5" />
          )}
          {pending ? "Обогащение…" : "Обогатить"}
        </button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="w-full shrink-0 sm:w-auto"
          disabled={disabled || pending}
          onClick={run}
        >
          {pending ? (
            <BrandPinLoader size="sm" className="mr-2" />
          ) : (
            <Sparkles className="mr-2 size-4" />
          )}
          Обогатить
        </Button>
      )}
      {error ? (
        <p className="text-xs text-rose-700">{error}</p>
      ) : message ? (
        <p className="text-xs text-emerald-800">{message}</p>
      ) : null}
    </div>
  );
}
