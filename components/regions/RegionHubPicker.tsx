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
import { cn } from "@/lib/utils";

type RegionHubPickerProps = {
  selected: RegionHub[];
  onChange: (hubIds: RegionHubId[]) => void;
  variant?: "light" | "dark";
  className?: string;
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
};

function idsOf(hubs: RegionHub[]): RegionHubId[] {
  return hubs.map((h) => h.id);
}

function sameIds(a: RegionHubId[], b: RegionHubId[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function RegionHubPicker({
  selected,
  onChange,
  variant = "light",
  className,
  trigger,
}: RegionHubPickerProps) {
  const options = getSelectableRegionHubs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RegionHubId[]>(() => idsOf(selected));
  const draftRef = useRef(draft);
  const rootRef = useRef<HTMLDivElement>(null);
  const dark = variant === "dark";

  draftRef.current = draft;

  useEffect(() => {
    if (!open) setDraft(idsOf(selected));
  }, [selected, open]);

  function commit(next: RegionHubId[]) {
    const unique = [...new Set(next)];
    const finalIds = unique.length > 0 ? unique : [options[0].id];
    setDraft(finalIds);
    draftRef.current = finalIds;
    if (!sameIds(finalIds, idsOf(selected))) {
      onChange(finalIds);
    }
  }

  function closeWithDraft() {
    commit(draftRef.current);
    setOpen(false);
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
    // closeWithDraft reads draft via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onChange, selected]);

  function selectOnly(id: RegionHubId) {
    commit([id]);
    setOpen(false);
  }

  function toggleExtra(id: RegionHubId, event: MouseEvent) {
    event.stopPropagation();
    setDraft((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  }

  const draftSet = new Set(draft);

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
            "absolute left-0 top-full z-[1100] mt-2 min-w-[260px] overflow-hidden rounded-xl shadow-xl",
            dark
              ? "border border-white/15 bg-slate-950/95 backdrop-blur-md"
              : "border border-slate-200 bg-white",
          )}
          role="listbox"
        >
          <p
            className={cn(
              "border-b px-3 py-2 text-[11px] leading-snug",
              dark
                ? "border-white/10 text-white/50"
                : "border-slate-100 text-slate-500",
            )}
          >
            Нажмите название — один район. «+» — добавить ещё.
          </p>
          <ul className="py-1">
            {options.map((option) => {
              const checked = draftSet.has(option.id);
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
                  </div>
                </li>
              );
            })}
          </ul>
          {draft.length > 1 ? (
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
                Готово · {draft.length}{" "}
                {draft.length === 1
                  ? "район"
                  : draft.length < 5
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
