"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveListingAction } from "@/lib/listings/actions";

type Props = {
  listingId: string;
};

export function OwnListingArchiveButton({ listingId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <button
        className="inline-flex min-h-11 items-center text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
        disabled={pending}
        type="button"
        onClick={() => {
          if (!window.confirm("Убрать объявление из публикации (в архив)?")) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await archiveListingAction(listingId);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? "Удаляю…" : "Удалить"}
      </button>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
