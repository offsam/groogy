"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { signalAppNavigation } from "@/components/layout/NavigationProgress";
import {
  AI_SEARCH_START_EVENT,
  signalAiSearch,
} from "@/components/search/AiSearchLoader";
import { PopularSearchQueries } from "@/components/search/PopularSearchQueries";

type SearchBarProps = {
  variant?: "hero" | "compact";
  initialQuery?: string;
};

export function SearchBar(props: SearchBarProps) {
  return (
    <Suspense fallback={<SearchBarFields {...props} urlQuery="" />}>
      <SearchBarWithUrl {...props} />
    </Suspense>
  );
}

function SearchBarWithUrl(props: SearchBarProps) {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  return <SearchBarFields {...props} urlQuery={urlQuery} />;
}

function SearchBarFields({
  variant = "compact",
  initialQuery = "",
  urlQuery,
}: SearchBarProps & { urlQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery || urlQuery);
  const showPopular = variant === "hero" || pathname === "/search";

  useEffect(() => {
    if (variant === "compact") setQuery(urlQuery);
  }, [urlQuery, variant]);

  useEffect(() => {
    function onStart(event: Event) {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      if (typeof detail?.query === "string") setQuery(detail.query);
    }
    window.addEventListener(AI_SEARCH_START_EVENT, onStart);
    return () => window.removeEventListener(AI_SEARCH_START_EVENT, onStart);
  }, []);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim().slice(0, 2000);
    if (q) {
      signalAiSearch(q);
    } else {
      signalAppNavigation();
    }
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  const form =
    variant === "hero" ? (
      <form
        className="flex w-full items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-200/60 focus-within:border-slate-400"
        onSubmit={handleSubmit}
      >
        <Sparkles aria-hidden="true" className="ml-3 size-5 shrink-0 text-brand-orange" />
        <input
          aria-label="AI-поиск компаний"
          className="w-full min-w-0 bg-transparent py-2.5 text-base outline-none placeholder:text-slate-400 sm:py-3"
          name="query"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Например: детский стоматолог в Irvine…"
          type="search"
          value={query}
        />
        <button
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-brand-blue px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-deep sm:px-5 sm:py-3"
          type="submit"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Найти</span>
        </button>
      </form>
    ) : (
      <form
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-slate-400 focus-within:bg-white"
        onSubmit={handleSubmit}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
        <input
          aria-label="Поиск компаний"
          className="w-full min-w-0 bg-transparent text-base outline-none placeholder:text-slate-400 sm:text-sm"
          name="query"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти компанию"
          type="search"
          value={query}
        />
      </form>
    );

  return (
    <div className="w-full">
      {form}
      {showPopular ? (
        <div className="mt-2">
          <PopularSearchQueries tone={variant === "hero" ? "dark" : "light"} />
        </div>
      ) : null}
    </div>
  );
}
