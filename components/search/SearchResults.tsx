"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BusinessList } from "@/components/business/BusinessList";
import { BusinessCategoryTabs } from "@/components/search/BusinessCategoryTabs";
import { PopularMiniCarousel } from "@/components/search/PopularMiniCarousel";
import { endAiSearch } from "@/components/search/AiSearchLoader";
import { ErrorState, LoadingState } from "@/components/ui/DataState";
import { createBrowserClient } from "@/lib/supabase/client";
import type {
  AiSearchIntentSummary,
  AiSearchStreamEvent,
} from "@/lib/search/ai-search-stream";
import type { Business, Category } from "@/types/business";

/** Shown while we don't yet know the real result count (before `meta` arrives). */
const DEFAULT_SEARCH_SKELETON_SLOTS = 6;

async function fetchActiveBusinessCategories(
  client: ReturnType<typeof createBrowserClient>,
): Promise<Category[]> {
  const { data, error } = await client
    .from("categories")
    .select("id, slug, name, icon, sort_order")
    .eq("is_active", true)
    .eq("domain", "business")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sort_order,
  }));
}

type SearchIntentSummary = AiSearchIntentSummary;

type UserCoords = { lat: number; lng: number };

type SearchResultsProps = {
  initialQuery: string;
  initialCategory: string | null;
  initialCity: string | null;
  initialHubId: string;
  /** `all` = alphabetical full list; otherwise overview when no category */
  initialView: "overview" | "all";
};

function intentHintLabel(
  intent: SearchIntentSummary,
  categories: Category[],
  fallback: boolean,
  options?: { sortedByDistance?: boolean },
): string | null {
  if (fallback) return "обычный поиск (AI временно недоступен)";
  const parts: string[] = [];
  if (intent.queryMode === "business_name") {
    parts.push("по названию");
  } else if (intent.preferCategory && intent.categorySlug) {
    const cat = categories.find((c) => c.slug === intent.categorySlug);
    parts.push(cat ? `подходящие: ${cat.name}` : "подходящая категория");
  } else if (intent.categorySlug) {
    const cat = categories.find((c) => c.slug === intent.categorySlug);
    parts.push(cat?.name ?? intent.categorySlug);
  }
  if (intent.city) parts.push(intent.city);
  // Show at most two distinct hint stems (avoid dumping whole RU+EN expansion).
  if (intent.mustHints.length > 0) {
    const compact = intent.mustHints.filter((h) => !h.includes(" ")).slice(0, 2);
    if (compact.length > 0) parts.push(compact.join(", "));
  }
  if (
    intent.queryMode !== "service_need" &&
    intent.queryMode !== "browse" &&
    !intent.preferCategory &&
    intent.keywords.length > 0
  ) {
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

function sortAlphabetical(list: Business[]): Business[] {
  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
  );
}

function overviewHref(hubId: string): string {
  const q = new URLSearchParams();
  if (hubId) q.set("hub", hubId);
  const s = q.toString();
  return s ? `/search?${s}` : "/search";
}

export function SearchResults({
  initialQuery,
  initialCategory,
  initialCity,
  initialHubId,
  initialView,
}: SearchResultsProps) {
  const hasQuery = Boolean(initialQuery.trim());
  const isOverview = !hasQuery && !initialCategory && initialView !== "all";
  const isAllView = !hasQuery && !initialCategory && initialView === "all";
  const isCategoryView = !hasQuery && Boolean(initialCategory);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<UserCoords | null>(null);
  const [sortedByDistance, setSortedByDistance] = useState(false);
  const [spellHint, setSpellHint] = useState<string | null>(null);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [matchKind, setMatchKind] = useState<"exact" | "similar" | "empty" | null>(
    null,
  );
  const [totalSlots, setTotalSlots] = useState(0);
  const [streamingCards, setStreamingCards] = useState(false);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );

  useEffect(() => {
    const cached = readCachedCoords();
    if (cached) setUserCoords(cached);
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
      () => {},
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSelectedId(null);
      setAiHint(null);
      setSortedByDistance(false);
      setSpellHint(null);
      setMatchMessage(null);
      setMatchKind(null);

      try {
        const client = createBrowserClient();
        const catsPromise = fetchActiveBusinessCategories(client);
        const near = userCoords
          ? { lat: userCoords.lat, lng: userCoords.lng }
          : null;

        if (hasQuery) {
          setResults([]);
          setTotalSlots(0);
          setStreamingCards(false);

          const [cats, aiRes] = await Promise.all([
            catsPromise,
            fetch("/api/search/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                q: initialQuery.trim().slice(0, 2000),
                categorySlug: initialCategory,
                city: initialCity,
                hubId: initialHubId,
                ...(near ? { lat: near.lat, lng: near.lng } : {}),
              }),
            }),
          ]);

          if (cancelled) return;
          setCategories(cats);

          if (!aiRes.ok || !aiRes.body) {
            const status = aiRes.status;
            if (status === 429) {
              throw new Error("Слишком много запросов — подождите немного");
            }
            if (status === 413) {
              throw new Error("Слишком длинный запрос — вставьте адрес или название короче");
            }
            throw new Error("Не удалось выполнить поиск");
          }

          // Real backend streaming (NDJSON): cards land one at a time as the
          // search pipeline finishes, instead of one big batch at the end.
          const reader = aiRes.body.getReader();
          streamReaderRef.current = reader;
          const decoder = new TextDecoder();
          let buf = "";
          let streamErrorMessage: string | null = null;
          let sawMeta = false;

          while (true) {
            const { done: streamDone, value } = await reader.read();
            if (streamDone) break;
            if (cancelled) {
              void reader.cancel().catch(() => {});
              return;
            }
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              let event: AiSearchStreamEvent;
              try {
                event = JSON.parse(trimmed) as AiSearchStreamEvent;
              } catch {
                continue;
              }
              if (event.type === "meta") {
                sawMeta = true;
                setMatchKind(event.matchKind ?? null);
                setMatchMessage(event.message ?? null);
                setAiHint(
                  intentHintLabel(event.intent, cats, event.fallback, {
                    sortedByDistance: Boolean(event.sortedByDistance && near),
                  }),
                );
                setSortedByDistance(Boolean(event.sortedByDistance && near));
                if (event.corrections && event.corrections.length > 0) {
                  const bits = event.corrections
                    .slice(0, 3)
                    .map((c) => `«${c.from}» → «${c.to}»`);
                  setSpellHint(`Исправили опечатку: ${bits.join(", ")}`);
                } else if (event.message) {
                  // Prefer match message over generic correctedQuery for empty/similar.
                  setSpellHint(null);
                } else if (event.correctedQuery) {
                  setSpellHint(`Ищем: ${event.correctedQuery}`);
                }
                setTotalSlots(event.total);
                setStreamingCards(event.total > 0);
                setLoading(false);
              } else if (event.type === "card") {
                setResults((prev) => [...prev, event.business]);
              } else if (event.type === "error") {
                streamErrorMessage = event.message || "Не удалось выполнить поиск";
              }
            }
          }

          streamReaderRef.current = null;
          setStreamingCards(false);
          endAiSearch();
          if (streamErrorMessage && !sawMeta) {
            throw new Error(streamErrorMessage);
          }
          return;
        }

        // Overview / Все / category: fetch hub catalog (no category filter on overview & all)
        const params = new URLSearchParams();
        if (initialCategory) params.set("category", initialCategory);
        if (initialCity) params.set("city", initialCity);
        if (initialHubId) params.set("hub", initialHubId);
        // Distance sort only for search query flows; list screens stay A–Z
        if (hasQuery && near) {
          params.set("lat", String(near.lat));
          params.set("lng", String(near.lng));
        }

        const [cats, searchRes] = await Promise.all([
          catsPromise,
          fetch(`/api/search/businesses?${params.toString()}`),
        ]);

        if (cancelled) return;
        if (!searchRes.ok) throw new Error(`Search failed (${searchRes.status})`);

        const data = (await searchRes.json()) as {
          businesses?: Business[];
          sortedByDistance?: boolean;
        };
        setCategories(cats);
        setResults(data.businesses ?? []);
        setSortedByDistance(false);
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
      streamReaderRef.current?.cancel().catch(() => {});
      streamReaderRef.current = null;
    };
  }, [
    initialQuery,
    initialCategory,
    initialCity,
    initialHubId,
    userCoords,
    hasQuery,
  ]);

  useEffect(() => {
    // The query flow calls endAiSearch() itself once its stream finishes
    // (see load() above). This only covers landing on /search without a
    // query, so a stuck radar from a mid-search back-navigation clears.
    if (hasQuery) return;
    endAiSearch();
  }, [hasQuery]);

  const listResults = useMemo(() => {
    if (hasQuery) return results;
    // Category view: API already filtered. Uncategorized never appear here.
    // Все: everything including uncategorized, A–Z.
    // Overview uses popular carousel from full results.
    if (isAllView || isCategoryView) return sortAlphabetical(results);
    return results;
  }, [hasQuery, isAllView, isCategoryView, results]);

  const categoryLabel =
    categories.find((c) => c.slug === initialCategory)?.name ||
    initialCategory;
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const business of results) {
      if (!business.categoryId) continue;
      counts[business.categoryId] = (counts[business.categoryId] ?? 0) + 1;
    }
    return counts;
  }, [results]);

  // Trailing shimmer slots while AI search results are still streaming in —
  // exact count once we know it (meta.total), a guess before that.
  const pendingSlots = useMemo(() => {
    if (!hasQuery) return 0;
    if (loading) return DEFAULT_SEARCH_SKELETON_SLOTS;
    if (streamingCards) return Math.max(totalSlots - results.length, 0);
    return 0;
  }, [hasQuery, loading, streamingCards, totalSlots, results.length]);

  return (
    <div className="search-page space-y-4 sm:space-y-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
        Бизнесы
      </h1>

      {isOverview ? (
        <>
          {error ? (
            <ErrorState
              detail={error}
              message="Не удалось загрузить бизнесы"
            />
          ) : loading ? (
            <LoadingState label="Загружаем популярное…" />
          ) : (
            <PopularMiniCarousel businesses={results} />
          )}
          <BusinessCategoryTabs
            categoryCounts={categoryCounts}
            categories={categories}
            hubParam={initialHubId || null}
            totalCount={results.length}
          />
        </>
      ) : null}

      {(isAllView || isCategoryView) && !hasQuery ? (
        <div className="flex items-center justify-between gap-3">
          <Link
            href={overviewHref(initialHubId)}
            className="text-sm font-medium text-brand-blue hover:underline"
          >
            ← Назад
          </Link>
          <p className="text-sm text-slate-500">
            {isAllView ? "Все · А–Я" : `${categoryLabel} · А–Я`}
            {!loading ? (
              <>
                {" "}
                ·{" "}
                <span className="font-semibold text-slate-900">
                  {listResults.length}
                </span>
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {hasQuery ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            {loading ? (
              <>
                Ищем «
                <span className="font-medium text-slate-900">{initialQuery}</span>
                »
              </>
            ) : matchKind === "similar" ? (
              <>
                Похожие:{" "}
                <span className="font-semibold text-slate-900">
                  {results.length}
                </span>
                {" "}
                к запросу «
                <span className="font-medium text-slate-900">{initialQuery}</span>
                »
              </>
            ) : matchKind === "empty" ? (
              <>
                По запросу «
                <span className="font-medium text-slate-900">{initialQuery}</span>
                » ничего не нашли
              </>
            ) : (
              <>
                Найдено:{" "}
                <span className="font-semibold text-slate-900">
                  {results.length}
                </span>
                {" "}
                по запросу «
                <span className="font-medium text-slate-900">{initialQuery}</span>
                »
                {sortedByDistance ? (
                  <>
                    {" "}
                    · <span className="text-slate-600">сначала ближайшие</span>
                  </>
                ) : null}
              </>
            )}
          </p>
          {!loading && spellHint ? (
            <p className="text-xs text-brand-orange">{spellHint}</p>
          ) : null}
          {!loading && aiHint ? (
            <p className="text-xs text-slate-400">AI понял: {aiHint}</p>
          ) : null}
        </div>
      ) : null}

      {hasQuery && !loading && matchMessage ? (
        <p
          className={
            matchKind === "empty"
              ? "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
              : "rounded-xl border border-brand-orange/30 bg-brand-orange/5 px-3 py-2.5 text-sm text-slate-800"
          }
        >
          {matchMessage}
        </p>
      ) : null}

      {!isOverview ? (
        error ? (
          <ErrorState
            detail={error}
            message="Не удалось загрузить результаты поиска"
          />
        ) : loading && !hasQuery ? (
          <LoadingState label="Загружаем компании…" />
        ) : (
          <BusinessList
            businesses={listResults}
            onSelect={setSelectedId}
            pendingSlots={pendingSlots}
            reveal={hasQuery}
            selectedId={selectedId}
          />
        )
      ) : null}
    </div>
  );
}
