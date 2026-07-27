"use client";

import Link from "next/link";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";

type Props = {
  pending: CommentRecommendation[];
  pendingTotal: number;
  publishedCount: number;
};

function primaryLink(item: CommentRecommendation): {
  label: string;
  href: string | null;
} {
  if (item.websites[0]) {
    return {
      label: item.websites[0].replace(/^https?:\/\//, "").slice(0, 48),
      href: item.websites[0],
    };
  }
  if (item.source_post_urls[0]) {
    return { label: "Пост в Facebook", href: item.source_post_urls[0] };
  }
  return { label: "Нет ссылки", href: null };
}

export function AdminEventsVerificationPanel({
  pending,
  pendingTotal,
  publishedCount,
}: Props) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            На верификации
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            События из Facebook-дампов. Старые тоже можно публиковать — дата не
            блокирует.
          </p>
        </div>
        <div className="flex gap-4 text-sm text-slate-600">
          <span>
            В очереди:{" "}
            <strong className="font-semibold text-slate-900">
              {pendingTotal}
            </strong>
          </span>
          <span>
            На платформе:{" "}
            <strong className="font-semibold text-slate-900">
              {publishedCount}
            </strong>
          </span>
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Очередь событий пуста. Опубликованные смотри на{" "}
          <Link href="/events" className="text-brand-blue hover:underline">
            /events
          </Link>
          .
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pending.map((item) => {
            const link = primaryLink(item);
            return (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                {item.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.cover_image_url}
                    alt=""
                    className="h-36 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center bg-slate-100 text-xs text-slate-400">
                    Нет обложки
                  </div>
                )}
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="text-base font-semibold leading-snug text-slate-900">
                    {item.display_name || "Без названия"}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    ×{item.mention_count} упоминаний / репостов
                    {Number(item.self_ad_mention_count ?? 0) > 0
                      ? ` · сами ×${item.self_ad_mention_count}`
                      : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex rounded-md bg-brand-green/15 px-2 py-1 text-xs font-medium text-emerald-800">
                      событие
                    </span>
                    {item.city ? (
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {item.city}
                      </span>
                    ) : null}
                    {item.event_at ? (
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {item.event_at}
                      </span>
                    ) : null}
                  </div>
                  {item.request_snippets[0] ? (
                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500">
                      {item.request_snippets[0]}
                    </p>
                  ) : null}
                  {link.href ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-auto pt-3 text-xs text-brand-blue hover:underline"
                    >
                      {link.label} →
                    </a>
                  ) : (
                    <div className="mt-auto pt-3" />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
