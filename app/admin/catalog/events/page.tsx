import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogBrowser } from "@/components/admin/CatalogBrowser";
import { EventCard } from "@/components/events/EventCard";
import { listCatalogEvents } from "@/lib/admin/catalog/queries";
import type {
  CatalogSort,
  CatalogStatusFilter,
} from "@/lib/admin/catalog/types";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Events — Catalog — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  published: "Published",
  archived: "Archived",
  cancelled: "Cancelled",
};

function parseStatus(raw: string | undefined): CatalogStatusFilter {
  const allowed = new Set([
    "all",
    "published",
    "draft",
    "archived",
    "other",
  ]);
  return allowed.has(raw ?? "")
    ? (raw as CatalogStatusFilter)
    : "published";
}

function parseSort(raw: string | undefined): CatalogSort {
  if (raw === "oldest" || raw === "title") return raw;
  return "newest";
}

export default async function AdminCatalogEventsPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/catalog/events");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const q = params.q ?? "";
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const page = Math.max(1, Number(params.page || "1") || 1);

  let result: Awaited<ReturnType<typeof listCatalogEvents>> = {
    items: [],
    total: 0,
    page,
    pageSize: 24,
  };
  let loadError: string | null = null;

  try {
    result = await listCatalogEvents(supabase, { q, status, sort, page });
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить события";
  }

  return (
    <CatalogBrowser
      title="Events"
      description="Опубликованные события. Очередь верификации кандидатов — в Review Center / legacy Events."
      basePath="/admin/catalog/events"
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      q={q}
      status={status}
      sort={sort}
      legacyHref="/admin/review/inbox?view=events"
      legacyLabel="Events in Inbox"
      error={loadError}
      items={result.items.map((event) => ({
        meta: {
          id: event.id,
          statusLabel: STATUS_LABELS[event.status] ?? event.status,
          publicHref:
            event.status === "published" ? `/events/${event.slug}` : null,
          editHref: null,
          archiveAvailable: false,
          enrichKind: "event" as const,
          slug: event.slug,
        },
        card: <EventCard event={event} preview />,
      }))}
    />
  );
}
