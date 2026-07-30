"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  moveEntitySectionAction,
  type MoveSectionKey,
} from "@/lib/admin/move-entity-section";
import { suggestedSectionForType } from "@/lib/admin/section-routing-audit-client";

type Props = {
  fromSection: MoveSectionKey;
  entityId: string;
  suggestedEntityType: string;
  reason: string;
};

export function WrongSectionMoveButton({
  fromSection,
  entityId,
  suggestedEntityType,
  reason,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toSection = suggestedSectionForType(suggestedEntityType);

  if (!toSection) {
    return (
      <span className="text-xs text-slate-500">Нет целевого раздела</span>
    );
  }

  function onMove() {
    if (!toSection || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await moveEntitySectionAction({
        fromSection,
        fromId: entityId,
        toSection,
        reason: `audit_wrong_section:${reason}`,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.push(res.redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        className="px-3 py-1.5 text-xs"
        disabled={pending}
        type="button"
        onClick={onMove}
      >
        {pending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Перенос…
          </>
        ) : (
          `Перенести → ${toSection}`
        )}
      </Button>
      {error ? <p className="max-w-[14rem] text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
