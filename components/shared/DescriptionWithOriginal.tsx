"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Public narrative + optional original (usually EN) behind a toggle.
 * Default view is Russian; «Показать оригинал» reveals the source text.
 */
export function DescriptionWithOriginal({
  text,
  original,
  className,
  textClassName,
}: {
  text: string;
  /** Source-language copy as the author wrote it. Hidden until toggled. */
  original?: string | null;
  className?: string;
  textClassName?: string;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const originalClean = (original || "").trim();
  const canToggle =
    Boolean(originalClean) &&
    originalClean !== text.trim() &&
    originalClean.length >= 8;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800",
          textClassName,
        )}
      >
        {showOriginal ? originalClean : text}
      </div>
      {canToggle ? (
        <button
          type="button"
          onClick={() => setShowOriginal((v) => !v)}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
        >
          {showOriginal ? "Показать перевод" : "Показать оригинал"}
        </button>
      ) : null}
    </div>
  );
}
