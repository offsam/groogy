"use client";

import Image from "next/image";
import Link from "next/link";
import { Briefcase, MapPin } from "lucide-react";
import { ShareEntityButton } from "@/components/engagement/ShareEntityButton";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import {
  formatJobCardEmployer,
  formatJobCardLocation,
  jobHref,
} from "@/lib/jobs/mappers";
import type { Job } from "@/types/job";

type JobCardProps = {
  job: Job;
};

export function JobCard({ job }: JobCardProps) {
  const photo =
    job.businessImageUrl && hasRealBusinessPhoto(job.businessImageUrl)
      ? job.businessImageUrl
      : null;
  const href = jobHref(job);
  const employer = formatJobCardEmployer(job);
  const location = formatJobCardLocation(job);

  return (
    <article className="relative overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <div className="absolute right-2 top-2 z-10">
        <ShareEntityButton
          className="size-8 bg-white/95 shadow-sm"
          stopPropagation
          title={job.title}
          url={href}
        />
      </div>
      <Link className="block" href={href}>
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
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-50 via-white to-brand-orange/10 px-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-100/80 text-amber-800 ring-1 ring-amber-200/80">
                <Briefcase aria-hidden className="size-6" />
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-amber-800/70">
                Вакансия
              </span>
            </div>
          )}
        </div>
        <div className="space-y-1 p-2.5 sm:p-3">
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
        </div>
      </Link>
    </article>
  );
}
