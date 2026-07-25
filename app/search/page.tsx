import type { Metadata } from "next";
import { SearchResults } from "@/components/search/SearchResults";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { serializeHubIds } from "@/lib/regions/hubs";

export const metadata: Metadata = {
  title: "Бизнесы — КРУГИ",
};

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
    category?: string;
    city?: string;
    hub?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, category, city, hub: hubParam } = await searchParams;
  const hubs = await resolveRequestHubs(hubParam);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));

  return (
    <>
      <SyncHubCookie hubId={hubIds} />
      <SearchResults
        key={`${q ?? ""}|${category ?? ""}|${city ?? ""}|${hubIds}`}
        initialCategory={category ?? null}
        initialCity={city ?? null}
        initialHubId={hubIds}
        initialQuery={q ?? ""}
      />
    </>
  );
}
