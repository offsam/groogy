import type { Metadata } from "next";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { ChurchCard } from "@/components/churches/ChurchCard";
import { EmptyState } from "@/components/ui/DataState";
import { listApprovedChurches } from "@/lib/churches/queries";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { formatHubsInLabel, serializeHubIds } from "@/lib/regions/hubs";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Церкви — КРУГИ",
  description: "Русскоязычные церкви и приходы в США",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function ChurchesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q?.trim() || null;
  const hubs = await resolveRequestHubs(params.hub);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));
  const inLabel = formatHubsInLabel(hubs);

  let churches: Awaited<ReturnType<typeof listApprovedChurches>> = [];
  try {
    const catalog = createServiceRoleClient();
    churches = await listApprovedChurches(catalog, {
      limit: 120,
      hubId: hubIds,
      q,
    });
  } catch {
    churches = [];
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SyncHubCookie hubId={hubIds} />
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Церкви
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {inLabel
            ? `Приходы и общины ${inLabel}`
            : "Русскоязычные церкви и приходы"}
          {churches.length > 0 ? ` · ${churches.length}` : null}
        </p>
      </div>

      <form className="flex gap-2" method="get">
        {hubIds ? <input name="hub" type="hidden" value={hubIds} /> : null}
        <input
          className="min-h-11 w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
          defaultValue={q ?? ""}
          name="q"
          placeholder="Поиск по названию или городу"
          type="search"
        />
        <button
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-brand-blue px-4 text-sm font-semibold text-white hover:bg-brand-blue/90"
          type="submit"
        >
          Найти
        </button>
      </form>

      {churches.length === 0 ? (
        <EmptyState
          title="Пока нет церквей"
          description="В этом регионе ещё нет опубликованных карточек."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {churches.map((church) => (
            <li key={church.id}>
              <ChurchCard church={church} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
