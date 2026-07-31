import type { Metadata } from "next";
import Link from "next/link";
import { ProfessionalCategoryTabs } from "@/components/professional/ProfessionalCategoryTabs";
import { ProfessionalListRow } from "@/components/professional/ProfessionalListRow";
import { EmptyState } from "@/components/ui/DataState";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { PROFESSIONAL_CATEGORY_SLUGS } from "@/lib/professional/categories";
import { listApprovedProfessionals } from "@/lib/professional/queries";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { formatHubsInLabel, serializeHubIds } from "@/lib/regions/hubs";
import { getProfessionalCategories } from "@/lib/supabase/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Специалисты — КРУГИ",
  description: "Русскоязычные специалисты в США",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function ProfessionalsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawCategory = params.category?.trim() || null;
  const allowed = new Set<string>(PROFESSIONAL_CATEGORY_SLUGS);
  const categorySlug =
    rawCategory && allowed.has(rawCategory) ? rawCategory : null;
  const isAllView = params.view === "all" && !categorySlug;
  const isOverview = !categorySlug && !isAllView;

  const hubs = await resolveRequestHubs(params.hub);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));
  const inLabel = formatHubsInLabel(hubs);
  const overviewHref = hubIds
    ? `/professionals?hub=${encodeURIComponent(hubIds)}`
    : "/professionals";

  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  let professionals: Awaited<ReturnType<typeof listApprovedProfessionals>> = [];
  let categories: Awaited<ReturnType<typeof getProfessionalCategories>> = [];
  let counts: Record<string, number> = {};
  let totalCount = 0;

  try {
    const catalog = createServiceRoleClient();
    const [listed, cats] = await Promise.all([
      listApprovedProfessionals(catalog, {
        // Overview needs counts; list views need cards (+ services preview).
        limit: isOverview ? 5000 : categorySlug ? 120 : 600,
        withServicesPreview: !isOverview,
        categorySlug: isOverview || isAllView ? null : categorySlug,
        hubId: hubIds,
      }),
      getProfessionalCategories(session).catch(() =>
        getProfessionalCategories(catalog),
      ),
    ]);
    categories = cats;

    // Hub-scoped counts from the same catalog slice as the list.
    const byCat: Record<string, number> = {};
    for (const p of listed) {
      const raw = p.categorySlug?.trim() || null;
      const slug = raw && allowed.has(raw) ? raw : "pro_other";
      byCat[slug] = (byCat[slug] ?? 0) + 1;
    }
    counts = byCat;
    totalCount = listed.length;

    if (!isOverview) {
      professionals = isAllView
        ? [...listed].sort((a, b) =>
            a.displayName.localeCompare(b.displayName, "ru"),
          )
        : listed;
    }
  } catch {
    professionals = [];
  }

  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
  const selectedName = categorySlug
    ? (categoryBySlug.get(categorySlug)?.name ?? null)
    : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SyncHubCookie hubId={hubIds} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Специалисты
          </h1>
          <p className="mt-1 text-sm text-slate-500 sm:text-base">
            {isOverview
              ? `По сферам · ${inLabel}`
              : selectedName
                ? `${selectedName} · ${inLabel}`
                : `Все · А–Я · ${inLabel}`}
          </p>
        </div>
        <Link
          className="rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white"
          href={user ? "/professional/new" : "/login?next=/professional/new"}
        >
          Создать профиль
        </Link>
      </div>

      {isOverview ? (
        categories.length > 0 && totalCount > 0 ? (
          <ProfessionalCategoryTabs
            categories={categories}
            categoryCounts={counts}
            hubParam={hubIds || null}
            totalCount={totalCount}
          />
        ) : (
          <EmptyState
            title="Пока нет опубликованных специалистов"
            description="Создайте первый профиль — он появится здесь сразу после публикации."
          />
        )
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <Link
              href={overviewHref}
              className="text-sm font-medium text-brand-blue hover:underline"
            >
              ← Назад
            </Link>
            <p className="text-sm text-slate-500">
              {isAllView ? "Все · А–Я" : `${selectedName} · А–Я`}
              {" · "}
              <span className="font-semibold text-slate-900">
                {professionals.length}
              </span>
            </p>
          </div>

          {professionals.length === 0 ? (
            <EmptyState
              title={
                categorySlug
                  ? "В этой сфере пока нет специалистов"
                  : "Пока нет опубликованных специалистов"
              }
              description={
                categorySlug
                  ? "Выберите другую сферу или вернитесь назад."
                  : "Создайте первый профиль — он появится здесь сразу после публикации."
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {professionals.map((p) => (
                <li key={p.id}>
                  <ProfessionalListRow professional={p} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
