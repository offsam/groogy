"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";

type SearchBarProps = {
  variant?: "hero" | "compact";
  initialQuery?: string;
};

export function SearchBar({ variant = "compact", initialQuery = "" }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  if (variant === "hero") {
    return (
      <form
        className="flex w-full items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-200/60 focus-within:border-slate-400"
        onSubmit={handleSubmit}
      >
        <Sparkles aria-hidden="true" className="ml-3 size-5 shrink-0 text-brand-orange" />
        <input
          aria-label="AI-поиск компаний"
          className="w-full bg-transparent py-2.5 text-base outline-none placeholder:text-slate-400 sm:py-3"
          name="query"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Например: детский стоматолог в Irvine…"
          type="search"
          value={query}
        />
        <button
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand-blue px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-deep sm:px-5 sm:py-3"
          type="submit"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Найти</span>
        </button>
      </form>
    );
  }

  return (
    <form
      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-slate-400 focus-within:bg-white"
      onSubmit={handleSubmit}
    >
      <Search aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
      <input
        aria-label="Поиск компаний"
        className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        name="query"
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Найти компанию"
        type="search"
        value={query}
      />
    </form>
  );
}
