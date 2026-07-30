"use client";

import { useEffect, useState } from "react";
import { Eye, Globe } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import {
  FacebookIcon,
  TelegramIcon,
} from "@/components/brand/BrandIcons";
import { QuickAuthModal } from "@/components/auth/QuickAuthModal";
import {
  isDirectorySourceUrl,
  isFacebookUrl,
  isPlatformOrigin,
  isTelegramUrl,
  sourceContactLabel,
  type BusinessPresence,
} from "@/lib/business/presence";
import { cn } from "@/lib/utils";

export type EntitySourceKind = BusinessPresence["sourceKind"];

type EntitySourceCardProps = {
  /** Element id for hash deep-links after auth. */
  anchorId?: string;
  hasSource: boolean;
  /** Present for owners / after reveal / SSR. */
  sourceUrl?: string | null;
  sourceKind?: EntitySourceKind;
  isAuthenticated?: boolean;
  initiallyRevealed?: boolean;
  /**
   * Authenticated fetch path that returns `{ sourceUrl, sourceKind }`.
   * Skip when `sourceUrl` is already known (owner / SSR reveal).
   */
  fetchPath?: string | null;
  /** Force-show empty state in edit mode even without source. */
  showEmpty?: boolean;
  className?: string;
};

type SourceApiResponse = {
  sourceUrl?: string | null;
  sourceKind?: EntitySourceKind;
};

const chipClass =
  "inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600";

function SourceIcon({
  kind,
  url,
}: {
  kind: EntitySourceKind;
  url: string | null;
}) {
  if (kind === "facebook" || (url && isFacebookUrl(url))) {
    return <FacebookIcon className="size-3.5" />;
  }
  if (kind === "telegram" || (url && isTelegramUrl(url))) {
    return <TelegramIcon className="size-3.5" />;
  }
  return <Globe className="size-3.5" aria-hidden />;
}

/**
 * Provenance block — original Telegram / Facebook post, directory listing,
 * or КРУГИ when the entity was created on the platform.
 */
export function EntitySourceCard({
  anchorId = "entity-source",
  hasSource,
  sourceUrl = null,
  sourceKind = null,
  isAuthenticated = false,
  initiallyRevealed = false,
  fetchPath = null,
  showEmpty = false,
  className,
}: EntitySourceCardProps) {
  const [revealed, setRevealed] = useState(
    Boolean(initiallyRevealed && (isAuthenticated || sourceUrl)),
  );
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [fetchedKind, setFetchedKind] = useState<EntitySourceKind>(null);

  const url = fetchedUrl ?? sourceUrl;
  const kind =
    fetchedKind ??
    (sourceKind === null && url && isDirectorySourceUrl(url)
      ? "directory"
      : sourceKind);
  const platform = isPlatformOrigin({ sourceKind: kind, sourceUrl: url });
  const show = hasSource || Boolean(url?.trim()) || platform || showEmpty;

  async function loadSource() {
    if (sourceUrl?.trim()) {
      setRevealed(true);
      return;
    }
    if (!fetchPath) {
      setRevealed(true);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(fetchPath);
      if (res.status === 401) {
        setAuthOpen(true);
        return;
      }
      if (!res.ok) throw new Error(`source_${res.status}`);
      const data = (await res.json()) as SourceApiResponse;
      setFetchedUrl(data.sourceUrl ?? null);
      setFetchedKind(data.sourceKind ?? null);
      setRevealed(true);
    } catch {
      setLoadError("Не удалось загрузить источник. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (platform) return;
    if (!isAuthenticated || revealed) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== `#${anchorId}`) return;
    void loadSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, revealed, fetchPath, anchorId, platform]);

  if (!show) return null;

  if (platform) {
    return (
      <section
        className={cn(
          "rounded-2xl border border-slate-200 bg-white p-4",
          className,
        )}
        id={anchorId}
      >
        <h2 className="text-sm font-semibold text-slate-900">Источник</h2>
        <div className="mt-2 flex items-center gap-3 rounded-xl px-1 py-1.5">
          <span className={cn(chipClass, "size-8 overflow-hidden p-0.5")}>
            <BrandMark className="size-full" size={28} />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
            КРУГИ
          </span>
        </div>
      </section>
    );
  }

  const resolvedUrl = url?.trim() || null;
  const label = resolvedUrl
    ? sourceContactLabel(kind, resolvedUrl)
    : "Источник";
  const icon = <SourceIcon kind={kind} url={resolvedUrl} />;

  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-4",
        className,
      )}
      id={anchorId}
    >
      <h2 className="text-sm font-semibold text-slate-900">Источник</h2>

      {!revealed && (hasSource || Boolean(fetchPath)) ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <span
              aria-hidden="true"
              className={cn(chipClass, "cursor-default opacity-80")}
              title="Источник"
            >
              {icon}
            </span>
          </div>
          <button
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            disabled={loading}
            style={{ color: "#ffffff" }}
            type="button"
            onClick={() => {
              if (!isAuthenticated) {
                setAuthOpen(true);
                return;
              }
              void loadSource();
            }}
          >
            <Eye
              aria-hidden="true"
              className="size-4"
              style={{ color: "#ffffff" }}
            />
            {loading ? "Загрузка…" : "Показать источник"}
          </button>
          {loadError ? (
            <p className="mt-2 text-sm text-red-600">{loadError}</p>
          ) : null}
        </>
      ) : resolvedUrl ? (
        <a
          className="mt-2 flex items-center gap-3 rounded-xl px-1 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-blue"
          href={resolvedUrl}
          rel="noopener noreferrer"
          target="_blank"
          title={label}
        >
          <span className={cn(chipClass, "size-8")}>{icon}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        </a>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Источник не указан</p>
      )}

      <QuickAuthModal
        nextPath={
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search || ""}#${anchorId}`
            : `/`
        }
        open={authOpen}
        subtitle="После входа откроется ссылка на оригинальный пост."
        title="Войдите, чтобы увидеть источник"
        onClose={() => setAuthOpen(false)}
      />
    </section>
  );
}
