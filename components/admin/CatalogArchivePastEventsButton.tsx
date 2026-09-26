"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminArchivePastEventsAction } from "@/lib/events/admin-actions";

export function CatalogArchivePastEventsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await adminArchivePastEventsAction();
            setMessage(result.ok ? (result.message ?? "Готово") : result.message);
            if (result.ok) router.refresh();
          });
        }}
      >
        {pending ? "Архивирую…" : "В архив все прошедшие"}
      </button>
      {message ? (
        <span className="text-xs text-slate-500">{message}</span>
      ) : null}
    </div>
  );
}
