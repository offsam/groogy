import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/DataState";
import { JobCard } from "@/components/jobs/JobCard";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { listPublishedJobs } from "@/lib/jobs/queries";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { formatHubsInLabel, serializeHubIds } from "@/lib/regions/hubs";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Работа — КРУГИ",
  description: "Вакансии от компаний и частных работодателей",
};

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function JobsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const hubs = await resolveRequestHubs(raw.hub);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));
  const inLabel = formatHubsInLabel(hubs);

  let jobs: Awaited<ReturnType<typeof listPublishedJobs>> = [];
  try {
    const catalog = createServiceRoleClient();
    jobs = await listPublishedJobs(catalog, { limit: 60, hubId: hubIds });
  } catch {
    jobs = [];
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SyncHubCookie hubId={hubIds} />
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Работа
        </h1>
        <p className="mt-1 text-sm text-slate-500 sm:text-base">
          Вакансии в {inLabel}
          <span className="text-slate-400">
            {" "}
            · без города — по всей стране
          </span>
        </p>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="Пока нет вакансий в этом регионе"
          description="Локальные вакансии появятся здесь. Объявления без привязки к городу видны во всех регионах."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
