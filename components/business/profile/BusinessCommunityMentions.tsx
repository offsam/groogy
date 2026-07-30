"use client";

import {
  COMMUNITY_MENTION_CHANNEL_LABELS,
  COMMUNITY_MENTION_KIND_LABELS,
  type CommunityMention,
} from "@/types/community-mention";
import {
  AdminOriginCountBadges,
  CommunityRecommendationCount,
} from "@/components/shared/CommunityRecommendationCount";
import { thirdPartySourceUrlsFromMentions } from "@/lib/community-mentions/source-urls";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function BusinessCommunityMentions({
  mentions,
  compact = false,
  /** Public: count + source links. Admin: snippets + both counters. */
  mode = "public",
  thirdPartyCount,
  selfAdCount,
}: {
  mentions: CommunityMention[];
  compact?: boolean;
  mode?: "public" | "admin";
  thirdPartyCount?: number | null;
  selfAdCount?: number | null;
}) {
  const publicCount =
    thirdPartyCount != null
      ? Math.max(0, Number(thirdPartyCount))
      : mentions.length;
  const sourceUrls = thirdPartySourceUrlsFromMentions(
    mentions.map((m) => ({ sourceUrl: m.sourceUrl, kind: m.kind })),
  );

  if (mode === "public") {
    if (publicCount <= 0 && sourceUrls.length === 0) return null;
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-900">
          Рекомендации сообщества
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Сколько раз рекомендовали другие — нажмите, чтобы открыть источники.
        </p>
        <div className="mt-3">
          <CommunityRecommendationCount
            count={Math.max(publicCount, sourceUrls.length)}
            sourceUrls={sourceUrls}
          />
        </div>
      </div>
    );
  }

  const items = compact ? mentions.slice(0, 2) : mentions;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          Рекомендации сообщества
        </h2>
        <AdminOriginCountBadges
          thirdParty={thirdPartyCount ?? mentions.length}
          selfAd={selfAdCount}
        />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Упоминания из комментариев — видны админу (тексты + сами/чужие).
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Пока нет прикреплённых упоминаний.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((m) => {
            const date = formatDate(m.publishedAt ?? m.createdAt);
            return (
              <li
                key={m.id}
                className="rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  <span>{COMMUNITY_MENTION_KIND_LABELS[m.kind]}</span>
                  <span aria-hidden="true">·</span>
                  <span>{COMMUNITY_MENTION_CHANNEL_LABELS[m.sourceChannel]}</span>
                  {m.sourceLabel ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="normal-case tracking-normal text-slate-600">
                        {m.sourceLabel}
                      </span>
                    </>
                  ) : null}
                  {date ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="normal-case tracking-normal">{date}</span>
                    </>
                  ) : null}
                </div>
                <p
                  className={`mt-2 text-sm leading-relaxed text-slate-700 ${
                    compact ? "line-clamp-4" : ""
                  }`}
                >
                  {m.snippet}
                </p>
                {m.sourceUrl ? (
                  <a
                    href={m.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block text-xs text-brand-blue hover:underline"
                  >
                    Источник
                  </a>
                ) : null}
                {m.authorLabel ? (
                  <p className="mt-1.5 text-xs text-slate-500">{m.authorLabel}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {compact && mentions.length > items.length ? (
        <p className="mt-3 text-sm text-slate-500">
          Ещё {mentions.length - items.length} в разделе «Отзывы»
        </p>
      ) : null}
    </div>
  );
}
