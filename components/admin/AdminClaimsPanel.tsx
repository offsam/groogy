"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import {
  adminReviewBusinessClaimAction,
  adminReviewEventClaimAction,
  adminReviewJobClaimAction,
  adminReviewListingClaimAction,
  adminReviewProfessionalClaimAction,
  type PendingBusinessClaim,
  type PendingEventClaim,
  type PendingJobClaim,
  type PendingListingClaim,
  type PendingProfessionalClaim,
} from "@/lib/admin/claim-actions";
import { listingKindFromType } from "@/lib/claims/shared";
import { Button } from "@/components/ui/Button";
import type { ListingType } from "@/types/listing";

type AdminClaimsPanelProps = {
  businessClaims: PendingBusinessClaim[];
  professionalClaims: PendingProfessionalClaim[];
  listingClaims: PendingListingClaim[];
  eventClaims: PendingEventClaim[];
  jobClaims: PendingJobClaim[];
};

type ClaimKind =
  | "business"
  | "professional"
  | "listing"
  | "event"
  | "job";

type UnifiedClaim = {
  id: string;
  kind: ClaimKind;
  kindLabel: string;
  entityHref: string;
  entityName: string;
  applicantDisplayName: string | null;
  applicantEmail: string | null;
  verificationDetails: string | null;
  applicantMessage: string | null;
  createdAt: string;
};

function listingHref(claim: PendingListingClaim) {
  const kind = listingKindFromType(
    (claim.listingType || "marketplace_item") as ListingType,
  );
  return `/${kind}/${claim.listingId}`;
}

function listingKindLabel(claim: PendingListingClaim) {
  const kind = listingKindFromType(
    (claim.listingType || "marketplace_item") as ListingType,
  );
  if (kind === "services") return "Услуга";
  if (kind === "transfers") return "Перевод";
  if (kind === "lechu") return "Лечу";
  return "Объявление";
}

export function AdminClaimsPanel({
  businessClaims,
  professionalClaims,
  listingClaims,
  eventClaims,
  jobClaims,
}: AdminClaimsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyDecision, setBusyDecision] = useState<
    "approved" | "rejected" | null
  >(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const claims: UnifiedClaim[] = [
    ...businessClaims.map((claim) => ({
      id: claim.id,
      kind: "business" as const,
      kindLabel: "Бизнес",
      entityHref: `/business/${claim.businessSlug}`,
      entityName: claim.businessName,
      applicantDisplayName: claim.applicantDisplayName,
      applicantEmail: claim.applicantEmail,
      verificationDetails: claim.verificationDetails,
      applicantMessage: claim.applicantMessage,
      createdAt: claim.createdAt,
    })),
    ...professionalClaims.map((claim) => ({
      id: claim.id,
      kind: "professional" as const,
      kindLabel: "Специалист",
      entityHref: `/professional/${claim.professionalSlug}`,
      entityName: claim.professionalName,
      applicantDisplayName: claim.applicantDisplayName,
      applicantEmail: claim.applicantEmail,
      verificationDetails: claim.verificationDetails,
      applicantMessage: claim.applicantMessage,
      createdAt: claim.createdAt,
    })),
    ...listingClaims.map((claim) => ({
      id: claim.id,
      kind: "listing" as const,
      kindLabel: listingKindLabel(claim),
      entityHref: listingHref(claim),
      entityName: claim.listingTitle,
      applicantDisplayName: claim.applicantDisplayName,
      applicantEmail: claim.applicantEmail,
      verificationDetails: claim.verificationDetails,
      applicantMessage: claim.applicantMessage,
      createdAt: claim.createdAt,
    })),
    ...eventClaims.map((claim) => ({
      id: claim.id,
      kind: "event" as const,
      kindLabel: "Событие",
      entityHref: `/events/${claim.eventSlug}`,
      entityName: claim.eventTitle,
      applicantDisplayName: claim.applicantDisplayName,
      applicantEmail: claim.applicantEmail,
      verificationDetails: claim.verificationDetails,
      applicantMessage: claim.applicantMessage,
      createdAt: claim.createdAt,
    })),
    ...jobClaims.map((claim) => ({
      id: claim.id,
      kind: "job" as const,
      kindLabel: "Вакансия",
      entityHref: `/jobs/${claim.jobSlug}`,
      entityName: claim.jobTitle,
      applicantDisplayName: claim.applicantDisplayName,
      applicantEmail: claim.applicantEmail,
      verificationDetails: claim.verificationDetails,
      applicantMessage: claim.applicantMessage,
      createdAt: claim.createdAt,
    })),
  ].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  function review(claim: UnifiedClaim, decision: "approved" | "rejected") {
    setError(null);
    setBusyId(claim.id);
    setBusyDecision(decision);
    startTransition(async () => {
      const payload = {
        claimId: claim.id,
        decision,
        moderatorNote: notes[claim.id] ?? null,
      };
      const result =
        claim.kind === "business"
          ? await adminReviewBusinessClaimAction(payload)
          : claim.kind === "professional"
            ? await adminReviewProfessionalClaimAction(payload)
            : claim.kind === "listing"
              ? await adminReviewListingClaimAction(payload)
              : claim.kind === "event"
                ? await adminReviewEventClaimAction(payload)
                : await adminReviewJobClaimAction(payload);
      setBusyId(null);
      setBusyDecision(null);
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
            key={`${claim.kind}-${claim.id}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {claim.kindLabel}
                </p>
                <Link
                  className="text-base font-semibold text-slate-900 hover:text-brand-blue"
                  href={claim.entityHref}
                  target="_blank"
                >
                  {claim.entityName}
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
                  loading={
                    pending &&
                    busyId === claim.id &&
                    busyDecision === "rejected"
                  }
                  disabled={pending}
                  type="button"
                  variant="secondary"
                  onClick={() => review(claim, "rejected")}
                >
                  {pending &&
                  busyId === claim.id &&
                  busyDecision === "rejected" ? null : (
                    <X aria-hidden="true" className="size-3.5" />
                  )}
                  {pending &&
                  busyId === claim.id &&
                  busyDecision === "rejected"
                    ? "Отклоняю…"
                    : "Отклонить"}
                </Button>
                <Button
                  loading={
                    pending &&
                    busyId === claim.id &&
                    busyDecision === "approved"
                  }
                  disabled={pending}
                  type="button"
                  onClick={() => review(claim, "approved")}
                >
                  {pending &&
                  busyId === claim.id &&
                  busyDecision === "approved" ? null : (
                    <Check aria-hidden="true" className="size-3.5" />
                  )}
                  {pending &&
                  busyId === claim.id &&
                  busyDecision === "approved"
                    ? "Одобряю…"
                    : "Одобрить"}
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
