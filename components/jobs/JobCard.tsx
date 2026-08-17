"use client";

import Image from "next/image";
import Link from "next/link";
import { Briefcase, MapPin } from "lucide-react";
import {
  CategoryAccentBar,
  CategoryChip,
  CategoryMediaFallback,
} from "@/components/platform/CategoryCardChrome";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import {
  formatJobCardEmployer,
  formatJobCardLocation,
  jobHref,
} from "@/lib/jobs/mappers";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import type { Job } from "@/types/job";

type JobCardProps = {
  job: Job;
  /** Admin catalog: no public navigation. */
  preview?: boolean;
};

export function JobCard({ job, preview = false }: JobCardProps) {
  const photo =
    job.businessImageUrl && hasRealBusinessPhoto(job.businessImageUrl)
      ? job.businessImageUrl
      : null;
  const href = jobHref(job);
  const employer = formatJobCardEmployer(job);
  const location = formatJobCardLocation(job);

  const body = (
    <>
      <CategoryAccentBar theme="jobs" />
      <div className="relative aspect-[4/3] bg-slate-100">
        {photo ? (
          <Image
            alt={employer}
            className="object-cover"
            fill
            sizes="(max-width: 640px) 50vw, 280px"
            src={photo}
          />
        ) : (
          <CategoryMediaFallback icon={Briefcase} theme="jobs" />
        )}
      </div>
      <div className="space-y-1 p-2.5 sm:p-3">
        <CategoryChip theme="jobs" />
        <h2 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900 sm:text-sm">
          {job.title}
        </h2>
        <p className="line-clamp-1 text-[11px] font-medium text-slate-700 sm:text-xs">
          {employer}
        </p>
        {location ? (
          <p className="flex items-start gap-1 text-[11px] leading-snug text-slate-500 sm:text-xs">
            <MapPin
              aria-hidden
              className="mt-0.5 size-3 shrink-0 text-slate-400"
            />
            <span className="line-clamp-2">{location}</span>
          </p>
        ) : null}
        {job.paymentMethods?.length ? (
          <PaymentMethodIcons
            className="pt-0.5"
            methods={job.paymentMethods}
            size="sm"
          />
        ) : null}
      </div>
    </>
  );

  if (preview) {
    return (
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {body}
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link className="block" href={href}>
        {body}
      </Link>
    </article>
  );
}
