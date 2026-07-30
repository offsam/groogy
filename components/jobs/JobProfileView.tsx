import Link from "next/link";
import { Briefcase, MapPin } from "lucide-react";
import { AdminLensBar } from "@/components/admin/AdminLensBar";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { PaymentMethodsCard } from "@/components/shared/PaymentMethodsCard";
import { formatJobCardLocation } from "@/lib/jobs/mappers";
import type { Job } from "@/types/job";

type Props = {
  job: Job;
  isAdmin?: boolean;
  /** Admin moderation: hide back-link and owner-only chrome. */
  preview?: boolean;
};

/** Public job detail — same component for site + admin preview. */
export function JobProfileView({
  job,
  isAdmin = false,
  preview = false,
}: Props) {
  const location = formatJobCardLocation(job);

  return (
    <div
      className={
        preview
          ? "mx-auto max-w-2xl space-y-6"
          : "mx-auto max-w-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8"
      }
    >
      {isAdmin && !preview ? (
        <AdminLensBar entityId={job.id} kind="job" slug={job.slug} />
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex aspect-[16/9] flex-col items-center justify-center gap-3 bg-gradient-to-br from-amber-50 via-white to-brand-orange/10">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-100/90 text-amber-800 ring-1 ring-amber-200/80">
            <Briefcase aria-hidden className="size-7" />
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-amber-800/70">
            Вакансия
          </span>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Работа
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900">
              {job.title}
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-800">
              {job.businessName?.trim() || "Частный работодатель"}
            </p>
            {location ? (
              <p className="mt-1.5 inline-flex items-start gap-1.5 text-sm text-slate-600">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{location}</span>
              </p>
            ) : null}
          </div>

          {job.description ? (
            <div className="border-t border-slate-100 pt-4">
              <h2 className="text-sm font-semibold text-slate-800">Описание</h2>
              <DescriptionWithOriginal
                className="mt-2"
                original={job.descriptionOriginal}
                text={job.description}
                textClassName="text-sm leading-relaxed text-slate-700"
              />
            </div>
          ) : null}
          <PaymentMethodsCard methods={job.paymentMethods} />
        </div>
      </div>

      {!preview ? (
        <Link
          className="inline-flex text-sm font-medium text-brand-blue hover:underline"
          href="/jobs"
        >
          ← Все вакансии
        </Link>
      ) : null}
    </div>
  );
}
