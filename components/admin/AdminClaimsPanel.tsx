"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import {
  adminReviewBusinessClaimAction,
  type PendingBusinessClaim,
} from "@/lib/admin/claim-actions";
import { Button } from "@/components/ui/Button";

type AdminClaimsPanelProps = {
  claims: PendingBusinessClaim[];
};

export function AdminClaimsPanel({ claims }: AdminClaimsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function review(claimId: string, decision: "approved" | "rejected") {
    setError(null);
    setBusyId(claimId);
    startTransition(async () => {
      const result = await adminReviewBusinessClaimAction({
        claimId,
        decision,
        moderatorNote: notes[claimId] ?? null,
      });
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  if (claims.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Нет заявок на проверке.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <ul className="space-y-4">
        {claims.map((claim) => (
          <li
            key={claim.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Link
                  className="text-base font-semibold text-slate-900 hover:text-brand-blue"
                  href={`/business/${claim.businessSlug}`}
                  target="_blank"
                >
                  {claim.businessName}
                  <ExternalLink
                    aria-hidden="true"
                    className="ml-1.5 inline size-3.5 align-middle text-slate-400"
                  />
                </Link>
                <p className="text-sm text-slate-600">
                  {claim.applicantDisplayName || "Пользователь"}
                  {claim.applicantEmail ? ` · ${claim.applicantEmail}` : null}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(claim.createdAt).toLocaleString("ru-RU")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={pending && busyId === claim.id}
                  type="button"
                  variant="secondary"
                  onClick={() => review(claim.id, "rejected")}
                >
                  <X aria-hidden="true" className="size-3.5" />
                  Отклонить
                </Button>
                <Button
                  disabled={pending && busyId === claim.id}
                  type="button"
                  onClick={() => review(claim.id, "approved")}
                >
                  <Check aria-hidden="true" className="size-3.5" />
                  Одобрить
                </Button>
              </div>
            </div>

            {claim.verificationDetails ? (
              <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                {claim.verificationDetails}
              </pre>
            ) : null}

            {claim.applicantMessage ? (
              <p className="mt-2 text-sm text-slate-600">
                <span className="font-medium text-slate-800">Сообщение: </span>
                {claim.applicantMessage}
              </p>
            ) : null}

            <label className="mt-3 block space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Заметка модератора</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                value={notes[claim.id] ?? ""}
                onChange={(e) =>
                  setNotes((prev) => ({ ...prev, [claim.id]: e.target.value }))
                }
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
