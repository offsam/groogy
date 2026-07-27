import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/DataState";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Недвижимость — КРУГИ",
  description: "Аренда и продажа от частников, специалистов и компаний",
};

type ReRow = { id: string; title: string; slug: string; city: string | null };

async function listPublishedRealEstate(): Promise<ReRow[]> {
  try {
    const client = createServiceRoleClient();
    const { data, error } = await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (a: string, b: string) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data: ReRow[] | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        };
      }
    )
      .from("real_estate_listings")
      .select("id, title, slug, city")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function RealEstatePage() {
  const listings = await listPublishedRealEstate();

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Недвижимость
        </h1>
        <p className="mt-1 text-sm text-slate-500 sm:text-base">
          Объекты от частников, специалистов и бизнесов
        </p>
      </div>

      {listings.length === 0 ? (
        <EmptyState
          title="Пока нет объектов"
          description="Когда появятся опубликованные объявления, они будут здесь."
        />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {listings.map((item) => (
            <li key={item.id}>
              <a
                className="block px-4 py-3 transition hover:bg-slate-50"
                href={`/real-estate/${item.slug}`}
              >
                <p className="font-medium text-slate-900">{item.title}</p>
                {item.city ? (
                  <p className="mt-0.5 text-sm text-slate-500">{item.city}</p>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
