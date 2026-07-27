"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BusinessList } from "@/components/business/BusinessList";
import { OfferSearchResults } from "@/components/search/OfferSearchResults";
import { CategoryFilter } from "@/components/search/CategoryFilter";
import { SearchBar } from "@/components/search/SearchBar";
import { ErrorState, LoadingState } from "@/components/ui/DataState";
import { createBrowserClient } from "@/lib/supabase/client";
import { getActiveCategories } from "@/lib/supabase/queries";
import type { Business, Category } from "@/types/business";

type SearchIntentSummary = {
  keywords: string[];
  city: string | null;
  categorySlug: string | null;
  mustHints: string[];
  preferCategory?: boolean;
  nearMe?: boolean;
};

type AiSearchResponse = {
  businesses: Business[];
  intent: SearchIntentSummary;
  modelUsed: string | null;
  fallback: boolean;
  sortedByDistance?: boolean;
  preferCategory?: boolean;
  corrections?: Array<{ from: string; to: string }>;
  correctedQuery?: string | null;
};

type UserCoords = { lat: number; lng: number };

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
  options?: { sortedByDistance?: boolean },
): string | null {
  if (fallback) return "обычный поиск (AI временно недоступен)";
  const parts: string[] = [];
  if (intent.preferCategory && intent.categorySlug) {
    const cat = categories.find((c) => c.slug === intent.categorySlug);
    parts.push(cat ? `подходящие: ${cat.name}` : "подходящая категория");
  } else if (intent.categorySlug) {
    const cat = categories.find((c) => c.slug === intent.categorySlug);
    parts.push(cat?.name ?? intent.categorySlug);
  }
  if (intent.city) parts.push(intent.city);
  if (intent.mustHints.length > 0) {
    parts.push(intent.mustHints.slice(0, 2).join(", "));
  }
  if (!intent.preferCategory && intent.keywords.length > 0) {
    parts.push(intent.keywords.slice(0, 3).join(" · "));
  }
  if (options?.sortedByDistance || intent.nearMe) {
    parts.push("рядом");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function readCachedCoords(): UserCoords | null {
  try {
    const raw = sessionStorage.getItem("krugi-user-coords");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown; at?: unknown };
    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    const at = Number(parsed.at);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // Cache for 30 minutes
    if (Number.isFinite(at) && Date.now() - at > 30 * 60_000) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function writeCachedCoords(coords: UserCoords) {
  try {
    sessionStorage.setItem(
      "krugi-user-coords",
      JSON.stringify({ ...coords, at: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function SearchResults({
  initialQuery,
  initialCategory,
  initialCity,
  initialHubId,
}: SearchResultsProps) {
  const router = useRouter();
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<UserCoords | null>(null);
  const [sortedByDistance, setSortedByDistance] = useState(false);
  const [spellHint, setSpellHint] = useState<string | null>(null);

  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);

  // Soft geolocation: use cache, then request if permission already granted / available.
  useEffect(() => {
    const cached = readCachedCoords();
    if (cached) {
      setUserCoords(cached);
    }

    if (!navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        writeCachedCoords(next);
        setUserCoords(next);
      },
      () => {
        // Denied / unavailable — keep catalog order.
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  function handleCategoryChange(slug: string | null) {
    setCategory(slug);
    const params = new URLSearchParams();
    if (initialQuery.trim()) params.set("q", initialQuery.trim());
    if (slug) params.set("category", slug);
    if (initialCity) params.set("city", initialCity);
    if (initialHubId) params.set("hub", initialHubId);
    const qs = params.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSelectedId(null);
      setAiHint(null);
      setSortedByDistance(false);
      setSpellHint(null);

      try {
        const client = createBrowserClient();
        const catsPromise = getActiveCategories(client);
        const near = userCoords
          ? { lat: userCoords.lat, lng: userCoords.lng }
          : null;

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
                ...(near ? { lat: near.lat, lng: near.lng } : {}),
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
          setAiHint(
            intentHintLabel(data.intent, cats, data.fallback, {
              sortedByDistance: Boolean(data.sortedByDistance && near),
            }),
          );
          setSortedByDistance(Boolean(data.sortedByDistance && near));
          if (data.corrections && data.corrections.length > 0) {
            const bits = data.corrections
              .slice(0, 3)
              .map((c) => `«${c.from}» → «${c.to}»`);
            setSpellHint(`Исправили опечатку: ${bits.join(", ")}`);
          } else {
            setSpellHint(null);
          }
          return;
        }

        const params = new URLSearchParams();
        if (category) params.set("category", category);
        if (initialCity) params.set("city", initialCity);
        if (initialHubId) params.set("hub", initialHubId);
        if (near) {
          params.set("lat", String(near.lat));
          params.set("lng", String(near.lng));
        }

        const [cats, searchRes] = await Promise.all([
          catsPromise,
          fetch(`/api/search/businesses?${params.toString()}`),
        ]);

        if (cancelled) return;

        if (!searchRes.ok) {
          throw new Error(`Search failed (${searchRes.status})`);
        }

        const data = (await searchRes.json()) as {
          businesses?: Business[];
          sortedByDistance?: boolean;
        };
        setCategories(cats);
        setResults(data.businesses ?? []);
        setSortedByDistance(Boolean(data.sortedByDistance && near));
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
  }, [initialQuery, category, initialCity, initialHubId, userCoords]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Бизнесы
      </h1>

      <div className="max-w-2xl">
        <SearchBar initialQuery={initialQuery} variant="hero" />
      </div>

      <CategoryFilter
        categories={categories}
        onChange={handleCategoryChange}
        selected={category}
      />

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
              {sortedByDistance && (
                <>
                  {" "}
                  · <span className="text-slate-600">сначала ближайшие</span>
                </>
              )}
            </>
          )}
        </p>
        {!loading && spellHint && (
          <p className="text-xs text-brand-orange">{spellHint}</p>
        )}
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

          <BusinessList
            businesses={results}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />
        </>
      )}
    </div>
  );
}
