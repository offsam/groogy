import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { listPublicPromotions } from "@/lib/promotions/queries";
import { PromotionCard } from "@/components/shared/PromotionCard";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ category?: string }>;

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const categorySlug = params.category?.trim() || null;
  const supabase = await createServerClient();
  const promotions = await listPublicPromotions(supabase, {
    categorySlug,
    limit: 60,
  });

  const { data: categories } = await supabase
    .from("categories")
    .select("slug, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(40);

  const filters = [
    { slug: null as string | null, label: "Все" },
    ...((categories ?? []) as unknown as Array<{
      slug: string;
      name: string | null;
    }>)
      .filter((c) => c.slug && c.name)
      .map((c) => ({ slug: c.slug, label: c.name! })),
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Акции
        </h1>
        <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
          Скидки и спецпредложения от специалистов и бизнесов. Просроченные не
          показываем.
        </p>
      </header>

      <nav
        aria-label="Категории акций"
        className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {filters.map((f) => {
          const active = (categorySlug || null) === f.slug;
          const href = f.slug ? `/promotions?category=${f.slug}` : "/promotions";
          return (
            <Link
              key={f.slug || "all"}
              href={href}
              className={
                active
                  ? "shrink-0 rounded-full bg-brand-blue px-3 py-2 text-sm font-medium text-white"
                  : "shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand-blue/40"
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <section className="mt-6 space-y-3" aria-live="polite">
        {promotions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Пока нет активных акций
            {categorySlug ? " в этой категории" : ""}.
          </p>
        ) : (
          promotions.map((promo) => (
            <PromotionCard key={promo.id} promo={promo} showOwner />
          ))
        )}
      </section>
    </main>
  );
}
