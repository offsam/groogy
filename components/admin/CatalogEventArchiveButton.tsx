"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminSetEventStatusAction } from "@/lib/events/admin-actions";

export function CatalogEventArchiveButton({
  eventId,
  status,
}: {
  eventId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const archived = status === "archived";

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await adminSetEventStatusAction({
              id: eventId,
              status: archived ? "published" : "archived",
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? "…" : archived ? "Вернуть" : "Архив"}
      </button>
      {error ? (
        <span className="max-w-[10rem] text-[10px] text-red-600">{error}</span>
      ) : null}
    </span>
  );
}
