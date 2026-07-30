"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, Plus } from "lucide-react";
import {
  getSelectableRegionHubs,
  type RegionHub,
  type RegionHubId,
} from "@/lib/regions/hubs";
import type { PlaceToken } from "@/lib/geo/place-tokens";
import { cn } from "@/lib/utils";

type PlaceSearchHit = {
  kind: "city" | "county";
  geoid: string;
  name: string;
  stateCode: string;
  countyGeoid?: string | null;
  label: string;
};

type RegionHubPickerProps = {
  selected: RegionHub[];
  onChange: (hubIds: RegionHubId[]) => void;
  /** When user picks a city/county from USA search. */
  onPlaceSelect?: (token: PlaceToken) => void;
  variant?: "light" | "dark";
  className?: string;
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
};

function idsOf(hubs: RegionHub[]): RegionHubId[] {
  return hubs
    .map((h) => h.id)
    .filter((id): id is RegionHubId => id !== "default");
}

function sameIds(a: RegionHubId[], b: RegionHubId[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function normalizeDraft(next: RegionHubId[]): RegionHubId[] {
  const unique = [...new Set(next.filter((id) => id !== "default"))];
  if (unique.includes("usa-overview")) {
    return unique.length === 1
      ? ["usa-overview"]
      : unique.filter((id) => id !== "usa-overview");
  }
  return unique;
}

export function RegionHubPicker({
  selected,
  onChange,
  onPlaceSelect,
  variant = "light",
  className,
  trigger,
}: RegionHubPickerProps) {
  const options = getSelectableRegionHubs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RegionHubId[]>(() => idsOf(selected));
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const draftRef = useRef(draft);
  const rootRef = useRef<HTMLDivElement>(null);
  const dark = variant === "dark";

  draftRef.current = draft;

  useEffect(() => {
    if (!open) setDraft(idsOf(selected));
  }, [selected, open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/geo/places/search?q=${encodeURIComponent(q)}`,
        );
        const data = (await res.json()) as { results?: PlaceSearchHit[] };
        if (!cancelled) setHits(data.results ?? []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  function commit(next: RegionHubId[]) {
    let finalIds = normalizeDraft(next);
    if (finalIds.length === 0) {
      if (idsOf(selected).includes("usa-overview")) {
        finalIds = ["usa-overview"];
      } else {
        setDraft(idsOf(selected));
        draftRef.current = idsOf(selected);
        return;
      }
    }
    setDraft(finalIds);
    draftRef.current = finalIds;
    if (!sameIds(finalIds, idsOf(selected))) {
      onChange(finalIds);
    }
  }

  function closeWithDraft() {
    commit(draftRef.current);
    setOpen(false);
    setQuery("");
    setHits([]);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: globalThis.MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeWithDraft();
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeWithDraft();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onChange, selected]);

  function selectOnly(id: RegionHubId) {
    commit([id]);
    setOpen(false);
    setQuery("");
    setHits([]);
  }

  function toggleExtra(id: RegionHubId, event: MouseEvent) {
    event.stopPropagation();
    if (id === "usa-overview") {
      setDraft(["usa-overview"]);
      return;
    }
    setDraft((prev) => {
      const withoutUsa = prev.filter((x) => x !== "usa-overview");
      if (withoutUsa.includes(id)) {
        if (withoutUsa.length === 1) return withoutUsa;
        return withoutUsa.filter((x) => x !== id);
      }
      return [...withoutUsa, id];
    });
  }

  function pickPlace(hit: PlaceSearchHit) {
    if (!onPlaceSelect) return;
    const token: PlaceToken =
      hit.kind === "county"
        ? { kind: "county", geoid: hit.geoid, label: hit.label }
        : {
            kind: "city",
            geoid: hit.geoid,
            label: hit.label,
            countyGeoid: hit.countyGeoid ?? null,
          };
    onPlaceSelect(token);
    setOpen(false);
    setQuery("");
    setHits([]);
  }

  const draftSet = new Set(draft);
  const multiDraft = draft.filter((id) => id !== "usa-overview");

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      {trigger({
        open,
        toggle: () => {
          if (open) closeWithDraft();
          else {
            setDraft(idsOf(selected));
            setOpen(true);
          }
        },
      })}

      {open ? (
        <div
          aria-label="Выбор регионов"
          aria-multiselectable
          className={cn(
            "absolute left-0 top-full z-[1100] mt-2 min-w-[280px] overflow-hidden rounded-xl shadow-xl",
            dark
              ? "border border-white/15 bg-slate-950/95 backdrop-blur-md"
              : "border border-slate-200 bg-white",
          )}
          role="listbox"
        >
          <div
            className={cn(
              "border-b px-3 py-2",
              dark ? "border-white/10" : "border-slate-100",
            )}
          >
            <input
              aria-label="Поиск города или округа США"
              className={cn(
                "w-full rounded-lg border px-2.5 py-2 text-sm outline-none",
                dark
                  ? "border-white/15 bg-white/5 text-white placeholder:text-white/40"
                  : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400",
              )}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Город или округ США…"
              type="search"
              value={query}
            />
            {query.trim().length >= 2 ? (
              <ul className="mt-2 max-h-40 overflow-y-auto">
                {searching ? (
                  <li
                    className={cn(
                      "px-1 py-1.5 text-xs",
                      dark ? "text-white/50" : "text-slate-500",
                    )}
                  >
                    Поиск…
                  </li>
                ) : hits.length === 0 ? (
                  <li
                    className={cn(
                      "px-1 py-1.5 text-xs",
                      dark ? "text-white/50" : "text-slate-500",
                    )}
                  >
                    Ничего не найдено
                  </li>
                ) : (
                  hits.map((hit) => (
                    <li key={`${hit.kind}-${hit.geoid}`}>
                      <button
                        className={cn(
                          "w-full rounded-lg px-2 py-1.5 text-left text-sm transition",
                          dark
                            ? "text-white/90 hover:bg-white/10"
                            : "text-slate-800 hover:bg-slate-100",
                        )}
                        onClick={() => pickPlace(hit)}
                        type="button"
                      >
                        <span className="font-medium">{hit.label}</span>
                        <span
                          className={cn(
                            "ml-1.5 text-[11px]",
                            dark ? "text-white/45" : "text-slate-400",
                          )}
                        >
                          {hit.kind === "county" ? "округ" : "город"}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
          <p
            className={cn(
              "border-b px-3 py-2 text-[11px] leading-snug",
              dark
                ? "border-white/10 text-white/50"
                : "border-slate-100 text-slate-500",
            )}
          >
            США — вся страна. Быстрый выбор — районы CA. «+» — добавить ещё.
          </p>
          <ul className="py-1">
            {options.map((option) => {
              const checked = draftSet.has(option.id);
              const isUsa = option.id === "usa-overview";
              return (
                <li key={option.id}>
                  <div
                    className={cn(
                      "flex w-full items-center gap-1 px-1.5 py-0.5",
                      checked && (dark ? "bg-white/10" : "bg-slate-50"),
                    )}
                  >
                    <button
                      aria-selected={checked}
                      className={cn(
                        "min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm transition",
                        dark
                          ? "text-white/90 hover:bg-white/10"
                          : "text-slate-800 hover:bg-slate-100",
                        checked &&
                          (dark ? "text-white" : "font-medium text-slate-950"),
                      )}
                      onClick={() => selectOnly(option.id)}
                      role="option"
                      type="button"
                    >
                      {option.shortLabel}
                    </button>
                    {isUsa ? (
                      <span className="flex size-8 shrink-0 items-center justify-center">
                        {checked ? (
                          <Check
                            aria-hidden
                            className={cn(
                              "size-3.5",
                              dark ? "text-brand-yellow" : "text-slate-900",
                            )}
                            strokeWidth={2.5}
                          />
                        ) : null}
                      </span>
                    ) : (
                      <button
                        aria-label={
                          checked
                            ? `Убрать ${option.shortLabel}`
                            : `Добавить ${option.shortLabel}`
                        }
                        aria-pressed={checked}
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-lg transition",
                          checked
                            ? dark
                              ? "bg-brand-yellow text-slate-950"
                              : "bg-slate-900 text-white"
                            : dark
                              ? "text-white/55 hover:bg-white/10 hover:text-white"
                              : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                        )}
                        onClick={(e) => toggleExtra(option.id, e)}
                        type="button"
                      >
                        {checked ? (
                          <Check
                            aria-hidden
                            className="size-3.5"
                            strokeWidth={2.5}
                          />
                        ) : (
                          <Plus
                            aria-hidden
                            className="size-3.5"
                            strokeWidth={2.5}
                          />
                        )}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {multiDraft.length > 1 ? (
            <div
              className={cn(
                "border-t px-3 py-2",
                dark ? "border-white/10" : "border-slate-100",
              )}
            >
              <button
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-sm font-medium transition",
                  dark
                    ? "bg-white/15 text-white hover:bg-white/20"
                    : "bg-slate-900 text-white hover:bg-slate-800",
                )}
                onClick={() => closeWithDraft()}
                type="button"
              >
                Готово · {multiDraft.length}{" "}
                {multiDraft.length === 1
                  ? "район"
                  : multiDraft.length < 5
                    ? "района"
                    : "районов"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
