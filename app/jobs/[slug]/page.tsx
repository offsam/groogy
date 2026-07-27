import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Briefcase, MapPin } from "lucide-react";
import { formatJobCardLocation } from "@/lib/jobs/mappers";
import { getJobBySlug } from "@/lib/jobs/queries";
import { createServiceRoleClient } from "@/lib/supabase/service";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(createServiceRoleClient(), slug).catch(() => null);
  if (!job || job.status !== "published") return { title: "Вакансия не найдена" };
  if (job.businessSlug) {
    return { title: `${job.title} — ${job.businessName}` };
  }
  return {
    title: `${job.title} — Работа — КРУГИ`,
    description: job.description?.slice(0, 160) ?? job.title,
  };
}

export default async function JobDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const catalog = createServiceRoleClient();
  const job = await getJobBySlug(catalog, slug).catch(() => null);
  if (!job || job.status !== "published") notFound();

  if (job.businessSlug) {
    redirect(`/business/${job.businessSlug}?tab=jobs`);
  }

  const location = formatJobCardLocation(job);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
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
              Частный работодатель
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
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {job.description}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <Link
        className="inline-flex text-sm font-medium text-brand-blue hover:underline"
        href="/jobs"
      >
        ← Все вакансии
      </Link>
    </div>
  );
}
