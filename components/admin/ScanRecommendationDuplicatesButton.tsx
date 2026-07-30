"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { scanPendingRecommendationsForDuplicatesAction } from "@/lib/import-review/recommendation-actions";

export function ScanRecommendationDuplicatesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        className="text-sm"
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const res = await scanPendingRecommendationsForDuplicatesAction({
              limit: 80,
            });
            if (!res.ok) {
              setError(res.message || "Скан не удался");
              return;
            }
            setMessage(res.message || "Готово");
            router.refresh();
          });
        }}
      >
        {pending ? "Ищу…" : "Поиск двойников"}
      </Button>
      {message ? (
        <p className="text-xs text-emerald-700">{message}</p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
