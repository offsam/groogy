"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Collapse long copy; «Показать полностью» expands. */
const COLLAPSE_CHARS = 320;

/**
 * Public narrative + optional original (usually EN).
 * - Top right: «Посмотреть оригинал» / «Показать перевод»
 * - Bottom: «Показать полностью» / «Скрыть» when text is long
 * Default view is Russian (translated) copy.
 */
export function DescriptionWithOriginal({
  text,
  original,
  heading,
  className,
  textClassName,
  headingClassName,
  collapseChars = COLLAPSE_CHARS,
}: {
  text: string;
  /** Source-language copy as the author wrote it. Hidden until toggled. */
  original?: string | null;
  /** Optional section title — shares the top row with the original toggle. */
  heading?: string;
  className?: string;
  textClassName?: string;
  headingClassName?: string;
  collapseChars?: number;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const originalClean = (original || "").trim();
  const textClean = text.trim();
  const canToggle =
    Boolean(originalClean) &&
    originalClean !== textClean &&
    originalClean.length >= 8;

  const active = showOriginal ? originalClean : textClean;
  const needsCollapse = active.length > collapseChars;
  const visible =
    expanded || !needsCollapse
      ? active
      : `${active.slice(0, collapseChars).replace(/\s+\S*$/, "").trimEnd()}…`;

  return (
    <div className={cn("space-y-2", className)}>
      {(heading || canToggle) && (
        <div className="flex items-start justify-between gap-3">
          {heading ? (
            <h2
              className={cn(
                "min-w-0 text-base font-semibold text-slate-900",
                headingClassName,
              )}
            >
              {heading}
            </h2>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {canToggle ? (
            <button
              type="button"
              onClick={() => {
                setShowOriginal((v) => !v);
                setExpanded(false);
              }}
              className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-brand-blue hover:underline"
            >
              {showOriginal ? "Показать перевод" : "Посмотреть оригинал"}
            </button>
          ) : null}
        </div>
      )}

      <div
        className={cn(
          "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800",
          textClassName,
        )}
      >
        {visible}
      </div>

      {needsCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
        >
          {expanded ? "Скрыть" : "Показать полностью"}
        </button>
      ) : null}
    </div>
  );
}
