"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminDeleteBusinessAction } from "@/lib/admin/actions";
import { cn } from "@/lib/utils";

type AdminDeleteBusinessButtonProps = {
  businessId: string;
  businessName: string;
  slug: string;
  className?: string;
};

export function AdminDeleteBusinessButton({
  businessId,
  businessName,
  slug,
  className,
}: AdminDeleteBusinessButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    const ok = window.confirm(
      `Удалить «${businessName}»?\nКарточка уйдёт в архив и исчезнет из каталога.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await adminDeleteBusinessAction({
        businessId,
        slug,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push("/search");
      router.refresh();
    });
  }

  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <button
        className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
        disabled={pending}
        type="button"
        onClick={onDelete}
      >
        {pending ? "Удаляю…" : "Удалить"}
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </span>
  );
}
