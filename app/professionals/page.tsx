import type { Metadata } from "next";
import Link from "next/link";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { ProfessionalCategoryFilter } from "@/components/professional/ProfessionalCategoryFilter";
import {
  ProfessionalCategoryRows,
  type ProfessionalCategoryRow,
} from "@/components/professional/ProfessionalCategoryRows";
import { EmptyState } from "@/components/ui/DataState";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { PROFESSIONAL_CATEGORY_SLUGS } from "@/lib/professional/categories";
import {
  countApprovedProfessionalsByCategory,
  listApprovedProfessionals,
} from "@/lib/professional/queries";
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

  const hubs = await resolveRequestHubs(params.hub);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));
  const inLabel = formatHubsInLabel(hubs);

  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  let professionals: Awaited<ReturnType<typeof listApprovedProfessionals>> = [];
  let categories: Awaited<ReturnType<typeof getProfessionalCategories>> = [];
  let counts: Record<string, number> = {};

  try {
    const catalog = createServiceRoleClient();
    const [listed, cats, byCat] = await Promise.all([
      listApprovedProfessionals(catalog, {
        // Overview groups by category — need the full catalog (~500), not only
        // the newest page (many recent imports still lack category_slug).
        limit: categorySlug ? 80 : 600,
        withServicesPreview: true,
        categorySlug,
        hubId: hubIds,
      }),
      getProfessionalCategories(session).catch(() =>
        getProfessionalCategories(catalog),
      ),
      countApprovedProfessionalsByCategory(catalog).catch(() => ({})),
    ]);
    professionals = listed;
    categories = cats;
    counts = byCat;
  } catch {
    professionals = [];
  }

  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
  const selectedName = categorySlug
    ? categoryBySlug.get(categorySlug)?.name ?? null
    : null;

  const rows: ProfessionalCategoryRow[] = [];
  if (!categorySlug) {
    const byCat = new Map<string, typeof professionals>();
    for (const p of professionals) {
      const raw = p.categorySlug?.trim() || null;
      const slug =
        raw && allowed.has(raw) ? raw : "pro_other";
      const list = byCat.get(slug) ?? [];
      list.push(p);
      byCat.set(slug, list);
    }

    const orderedSlugs = [...PROFESSIONAL_CATEGORY_SLUGS].sort((a, b) => {
      const ca = Math.max(counts[a] ?? 0, byCat.get(a)?.length ?? 0);
      const cb = Math.max(counts[b] ?? 0, byCat.get(b)?.length ?? 0);
      return cb - ca;
    });

    for (const slug of orderedSlugs) {
      const items = byCat.get(slug) ?? [];
      if (items.length === 0) continue;
      const total = Math.max(counts[slug] ?? 0, items.length);
      const name = categoryBySlug.get(slug)?.name ?? slug;
      rows.push({
        slug,
        name,
        total,
        items,
      });
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <SyncHubCookie hubId={hubIds} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Специалисты
          </h1>
          <p className="mt-1 text-sm text-slate-500 sm:text-base">
            {selectedName
              ? `Сфера: ${selectedName} · ${inLabel}`
              : `По сферам · ${inLabel}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {categorySlug ? (
            <Link
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300"
              href="/professionals"
            >
              Все сферы
            </Link>
          ) : null}
          <Link
            className="rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white"
            href={user ? "/professional/new" : "/login?next=/professional/new"}
          >
            Создать профиль
          </Link>
        </div>
      </div>

      {categories.length > 0 ? (
        <ProfessionalCategoryFilter
          categories={categories}
          counts={counts}
          selected={categorySlug}
        />
      ) : null}

      {categorySlug ? (
        professionals.length === 0 ? (
          <EmptyState
            title="В этой сфере пока нет специалистов"
            description="Выберите другую сферу или вернитесь ко всем."
          />
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {professionals.map((p) => (
              <ProfessionalCard key={p.id} professional={p} />
            ))}
          </div>
        )
      ) : rows.length === 0 ? (
        <EmptyState
          title="Пока нет опубликованных специалистов"
          description="Создайте первый профиль — он появится здесь сразу после публикации."
        />
      ) : (
        <ProfessionalCategoryRows rows={rows} />
      )}
    </div>
  );
}
