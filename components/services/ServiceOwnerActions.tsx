"use client";

import { useTransition, useState } from "react";
import Link from "next/link";

import {
  archiveListingAction,
  completeListingAction,
  pauseListingAction,
  reactivateListingAction,
} from "@/lib/listings/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import type { ListingStatus } from "@/types/listing";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type ServiceOwnerActionsProps = {
  listingId: string;
  status: ListingStatus;
};

export function ServiceOwnerActions({
  listingId,
  status,
}: ServiceOwnerActionsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Ошибка");
      else {
        setMessage(result.message ?? "Готово");
        window.location.reload();
      }
    });
  }

  const canPause = status === "active";
  const canReactivate = status === "paused" || status === "completed";
  const canComplete = status === "active" || status === "paused";
  const canArchive = ["active", "paused", "completed", "draft"].includes(status);

  return (
    <div className="space-y-3">
      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      <div className="flex flex-wrap gap-2">
        <Link
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
          href={`/services/${listingId}/edit`}
        >
          Редактировать
        </Link>

        {canPause && (
          <Button
            className="gap-2 disabled:opacity-60"
            disabled={pending}
            onClick={() => run(() => pauseListingAction(listingId))}
            type="button"
          >
            {pending && <BrandPinLoader size="sm" />}
            Пауза
          </Button>
        )}

        {canReactivate && (
          <Button
            className="gap-2 disabled:opacity-60"
            disabled={pending}
            onClick={() => run(() => reactivateListingAction(listingId))}
            type="button"
          >
            {pending && <BrandPinLoader size="sm" />}
            Возобновить
          </Button>
        )}

        {canComplete && (
          <Button
            className="disabled:opacity-60"
            disabled={pending}
            onClick={() => run(() => completeListingAction(listingId))}
            type="button"
            variant="secondary"
          >
            Завершить
          </Button>
        )}

        {canArchive && (
          <Button
            className="disabled:opacity-60"
            disabled={pending}
            onClick={() => run(() => archiveListingAction(listingId))}
            type="button"
            variant="secondary"
          >
            В архив
          </Button>
        )}
      </div>
    </div>
  );
}
