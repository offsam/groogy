"use client";

import { useEffect, useId, useRef, useState } from "react";

import { searchCitiesAction } from "@/lib/master-data/actions";
import {
  abbreviationFromStateCode,
  formatCityLabel,
} from "@/lib/master-data/location";
import { cn } from "@/lib/utils";
import type { CitySearchResult, UsStateOption } from "@/types/master-data";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type CityComboboxProps = {
  value: string;
  stateCode?: string | null;
  states?: UsStateOption[];
  onCityChange: (city: string) => void;
  onSelect: (result: {
    city: string;
    cityGeoid: string;
    stateCode: string;
    stateAbbreviation: string;
  }) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
};

export function CityCombobox({
  value,
  stateCode,
  states = [],
  onCityChange,
  onSelect,
  id,
  className,
  disabled,
  placeholder = "Начните вводить город…",
}: CityComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CitySearchResult[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setPending(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      void (async () => {
        setPending(true);
        const result = await searchCitiesAction(q, stateCode || null);
        if (requestId !== requestIdRef.current) return;
        setPending(false);
        if (!result.ok) {
          setError(result.message);
          setResults([]);
          return;
        }
        setError(null);
        setResults(result.cities);
        setOpen(true);
      })();
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, stateCode]);

  return (
    <div className="relative" ref={wrapRef}>
      <div className="relative">
        <input
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open && results.length > 0}
          autoComplete="off"
          className={cn(
            "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2",
            className,
          )}
          disabled={disabled}
          id={id}
          onChange={(e) => {
            onCityChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          role="combobox"
          type="text"
          value={value}
        />
        {pending && (
          <BrandPinLoader size="sm" className="absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {open && results.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          id={listId}
          role="listbox"
        >
          {results.map((city) => (
            <li
              aria-selected={false}
              key={city.geoid}
              role="option"
            >
              <button
                className="w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                onClick={() => {
                  const abbr = abbreviationFromStateCode(city.stateCode, states);
                  onSelect({
                    city: city.name,
                    cityGeoid: city.geoid,
                    stateCode: city.stateCode,
                    stateAbbreviation: abbr,
                  });
                  setOpen(false);
                }}
                type="button"
              >
                {formatCityLabel(city, states)}
                {city.population != null ? (
                  <span className="ml-2 text-xs text-slate-400">
                    ~{city.population.toLocaleString("en-US")}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open &&
        !pending &&
        value.trim().length >= 2 &&
        results.length === 0 &&
        !error && (
          <p className="mt-1 text-xs text-slate-500">Города не найдены</p>
        )}
    </div>
  );
}
