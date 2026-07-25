"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { BusinessList } from "@/components/business/BusinessList";
import { OfferSearchResults } from "@/components/search/OfferSearchResults";
import { CategoryFilter } from "@/components/search/CategoryFilter";
import { SearchBar } from "@/components/search/SearchBar";
import { ErrorState, LoadingState } from "@/components/ui/DataState";
import { createBrowserClient } from "@/lib/supabase/client";
import { getActiveCategories, searchBusinesses } from "@/lib/supabase/queries";
import type { Business, Category } from "@/types/business";

const BusinessMap = dynamic(() => import("@/components/map/BusinessMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-400">
      Загрузка карты…
    </div>
  ),
});

type SearchIntentSummary = {
  keywords: string[];
  city: string | null;
  categorySlug: string | null;
  mustHints: string[];
};

type AiSearchResponse = {
  businesses: Business[];
  intent: SearchIntentSummary;
  modelUsed: string | null;
  fallback: boolean;
};

type SearchResultsProps = {
  initialQuery: string;
  initialCategory: string | null;
  initialCity: string | null;
  initialHubId: string;
};

function intentHintLabel(
  intent: SearchIntentSummary,
  categories: Category[],
  fallback: boolean,
): string | null {
  if (fallback) return "обычный поиск (AI временно недоступен)";
  const parts: string[] = [];
  if (intent.city) parts.push(intent.city);
  if (intent.categorySlug) {
    const cat = categories.find((c) => c.slug === intent.categorySlug);
    parts.push(cat?.name ?? intent.categorySlug);
  }
  if (intent.mustHints.length > 0) {
    parts.push(intent.mustHints.slice(0, 2).join(", "));
  }
  if (parts.length === 0 && intent.keywords.length > 0) {
    parts.push(intent.keywords.slice(0, 3).join(" · "));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function SearchResults({
  initialQuery,
  initialCategory,
  initialCity,
  initialHubId,
}: SearchResultsProps) {
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);

  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSelectedId(null);
      setAiHint(null);

      try {
        const client = createBrowserClient();
        const catsPromise = getActiveCategories(client);

        if (initialQuery.trim()) {
          const [cats, aiRes] = await Promise.all([
            catsPromise,
            fetch("/api/search/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                q: initialQuery,
                categorySlug: category,
                city: initialCity,
                hubId: initialHubId,
              }),
            }),
          ]);

          if (cancelled) return;

          if (!aiRes.ok) {
            throw new Error(`AI search failed (${aiRes.status})`);
          }

          const data = (await aiRes.json()) as AiSearchResponse;
          setCategories(cats);
          setResults(data.businesses ?? []);
          setAiHint(intentHintLabel(data.intent, cats, data.fallback));
          return;
        }

        const [cats, businesses] = await Promise.all([
          catsPromise,
          searchBusinesses(client, {
            categorySlug: category,
            city: initialCity,
            hubId: initialHubId,
          }),
        ]);

        if (cancelled) return;
        setCategories(cats);
        setResults(businesses);
      } catch (err) {
        if (cancelled) return;
        setResults([]);
        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [initialQuery, category, initialCity, initialHubId]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Бизнесы
      </h1>

      <div className="max-w-2xl">
        <SearchBar initialQuery={initialQuery} variant="hero" />
      </div>

      <CategoryFilter categories={categories} onChange={setCategory} selected={category} />

      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {loading ? (
            "Загрузка…"
          ) : (
            <>
              Найдено: <span className="font-semibold text-slate-900">{results.length}</span>
              {initialQuery && (
                <>
                  {" "}
                  по запросу «
                  <span className="font-medium text-slate-900">{initialQuery}</span>»
                </>
              )}
            </>
          )}
        </p>
        {!loading && aiHint && (
          <p className="text-xs text-slate-400">AI понял: {aiHint}</p>
        )}
      </div>

      {error ? (
        <ErrorState detail={error} message="Не удалось загрузить результаты поиска" />
      ) : loading ? (
        <LoadingState label={initialQuery ? "AI ищет компании…" : "Ищем компании…"} />
      ) : (
        <>
          <OfferSearchResults city={initialCity} query={initialQuery} />

          {/* Map stays fixed at top; list scrolls underneath */}
          <div className="sticky top-[7.5rem] z-20 h-[32vh] min-h-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:top-24 sm:h-[46vh] sm:min-h-[220px]">
            <BusinessMap
              businesses={results}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          </div>

          <div className="pt-4">
            <BusinessList
              businesses={results}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          </div>
        </>
      )}
    </div>
  );
}
