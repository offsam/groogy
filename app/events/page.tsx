import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/DataState";
import { EventCard } from "@/components/events/EventCard";
import { EventsCalendar } from "@/components/events/EventsCalendar";
import { EventsToolbar } from "@/components/events/EventsToolbar";
import {
  listPublishedEventCityCounts,
  listPublishedEventDateCounts,
  listPublishedEvents,
} from "@/lib/events/queries";
import {
  citiesForRegionIds,
  parseEventCategoryParam,
  parseEventDate,
  parseEventRegions,
  parseEventSort,
  parseEventWhen,
  pacificTodayYmd,
} from "@/lib/events/regions";
import {
  sortPastNewestFirst,
  sortUpcomingSoonest,
  splitEventsByTimeline,
} from "@/lib/events/timing";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Чем заняться — КРУГИ",
  description:
    "Афиша занятий и мероприятий: фестивали, ярмарки, семья, еда, культура — по дням и выходным",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function EventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const regions = parseEventRegions(params.regions);
  const sort = parseEventSort(params.sort);
  const when = parseEventWhen(params.when);
  const category = parseEventCategoryParam(params.category);
  const selectedDate = parseEventDate(params.date);
  const cities = citiesForRegionIds(regions);
  const today = pacificTodayYmd();
  const month =
    (params.month && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : null) ||
    (selectedDate ? selectedDate.slice(0, 7) : today.slice(0, 7));

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let events: Awaited<ReturnType<typeof listPublishedEvents>> = [];
  let cityCounts: Record<string, number> = {};
  let dateCounts: Record<string, number> = {};
  try {
    const client = createServiceRoleClient();
    const [listed, counts, dates] = await Promise.all([
      listPublishedEvents(client, {
        limit: 120,
        cities: cities.length > 0 ? cities : undefined,
        sort: "newest",
        when: selectedDate ? "all" : when,
        onDate: selectedDate || undefined,
        category: category || undefined,
      }),
      listPublishedEventCityCounts(client),
      listPublishedEventDateCounts(client, {
        cities: cities.length > 0 ? cities : undefined,
        category: category || undefined,
      }),
    ]);
    events = listed;
    cityCounts = counts;
    dateCounts = dates;
  } catch {
    events = [];
  }

  const direction = sort === "later" ? "later" : "soon";
  let { upcoming, past } = splitEventsByTimeline(events);

  if (sort === "newest") {
    upcoming = [...upcoming].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    past = [...past].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  } else {
    upcoming = sortUpcomingSoonest(upcoming, direction);
    past = sortPastNewestFirst(past);
  }

  const showUpcoming = selectedDate ? true : when !== "past";
  const showPast = selectedDate ? true : when !== "upcoming";
  const upcomingVisible = showUpcoming ? upcoming : [];
  const pastVisible = showPast ? past : [];
  // When a day is selected, show a single nearest→furthest list
  const dayList = selectedDate
    ? sortUpcomingSoonest(
        [...upcomingVisible, ...pastVisible],
        "soon",
      )
    : null;
  const resultCount = dayList
    ? dayList.length
    : upcomingVisible.length + pastVisible.length;

  const scopeLabel =
    regions.length === 0
      ? "по всей Америке"
      : cities.length === 1
        ? `в городе ${cities[0]}`
        : "в выбранных регионах";

  const addHref = user ? "/events/new" : "/login?next=/events/new";

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Чем заняться
          </h1>
          <p className="mt-1 text-sm text-slate-500 sm:text-base">
            Фестивали, ярмарки, семья, еда, культура и другие занятия{" "}
            {scopeLabel}
          </p>
        </div>
        <Link
          href={addHref}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
        >
          Добавить событие
        </Link>
      </div>

      <EventsCalendar
        selectedDate={selectedDate}
        month={month}
        dateCounts={dateCounts}
        selectedRegions={regions}
        sort={sort}
        when={when}
        category={category}
      />

      <EventsToolbar
        selectedRegions={regions}
        sort={sort}
        when={when}
        category={category}
        selectedDate={selectedDate}
        month={month}
        cityCounts={cityCounts}
        resultCount={resultCount}
      />

      {resultCount === 0 ? (
        <EmptyState
          title="Нет занятий по этому фильтру"
          description="Выберите другой день или сбросьте регионы — либо добавьте своё событие."
        />
      ) : dayList ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {selectedDate}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dayList.map((item) => (
              <li key={item.id}>
                <EventCard event={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="space-y-8">
          {upcomingVisible.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Ближайшие
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {upcomingVisible.map((item) => (
                  <li key={item.id}>
                    <EventCard event={item} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {upcomingVisible.length > 0 && pastVisible.length > 0 ? (
            <div
              className="relative flex items-center gap-4 py-2"
              role="separator"
            >
              <div className="h-px flex-1 bg-slate-200" />
              <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
                Уже прошедшие
              </span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          ) : pastVisible.length > 0 ? (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Уже прошедшие
            </h2>
          ) : null}

          {pastVisible.length > 0 ? (
            <section>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pastVisible.map((item) => (
                  <li key={item.id}>
                    <EventCard event={item} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
