"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function recommendationsLabel(count: number): string {
  return `${count} ${pluralRu(count, "рекомендация", "рекомендации", "рекомендаций")}`;
}

/** Static badge for listing / mini cards (safe inside Links). */
export function CommunityRecommendationBadge({
  count,
  compact = false,
  className,
}: {
  count: number;
  compact?: boolean;
  className?: string;
}) {
  if (count <= 0) return null;
  const badgeClass = compact
    ? "rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
    : "rounded-lg px-2 py-1 text-xs font-semibold";
  return (
    <span
      className={`inline-flex items-center bg-brand-green/15 text-emerald-800 ${badgeClass} ${className ?? ""}`}
      title="Рекомендовали другие в открытых источниках"
    >
      {recommendationsLabel(count)}
    </span>
  );
}

/** Public: digit only; click expands source links (not recommendation text). */
export function CommunityRecommendationCount({
  count,
  sourceUrls,
  className,
}: {
  count: number;
  sourceUrls: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (count <= 0) return null;

  const urls = sourceUrls.filter((u) => u.trim());

  return (
    <div className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-lg bg-brand-green/15 px-2 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-brand-green/25"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        title="Источники рекомендаций"
      >
        {recommendationsLabel(count)}
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Откуда рекомендации
          </p>
          {urls.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 truncate text-brand-blue hover:underline"
                  >
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{sourceHost(url)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-slate-500">Ссылки на источники пока нет.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** Admin-only: both third-party and self-ad counts. */
export function AdminOriginCountBadges({
  thirdParty,
  selfAd,
  compact = false,
}: {
  thirdParty: number | null | undefined;
  selfAd: number | null | undefined;
  compact?: boolean;
}) {
  const t = Math.max(0, Number(thirdParty ?? 0));
  const s = Math.max(0, Number(selfAd ?? 0));
  if (t <= 0 && s <= 0) return null;
  const badgeClass = compact
    ? "rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
    : "rounded-lg px-2 py-1 text-xs font-semibold";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {t > 0 ? (
        <span
          className={`${badgeClass} bg-brand-green/15 text-emerald-800`}
          title="Рекомендовали другие"
        >
          чужие ×{t}
        </span>
      ) : null}
      {s > 0 ? (
        <span
          className={`${badgeClass} bg-brand-orange/15 text-brand-orange`}
          title="Рекламировали себя"
        >
          сами ×{s}
        </span>
      ) : null}
    </div>
  );
}
