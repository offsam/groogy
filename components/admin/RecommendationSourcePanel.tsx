import { AdminOriginCountBadges } from "@/components/shared/CommunityRecommendationCount";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";

/** Texts + counters that make a recommendation readable in admin preview. */
export function RecommendationSourcePanel({
  item,
  className,
}: {
  item: CommentRecommendation;
  className?: string;
}) {
  const snippets = (item.request_snippets || []).filter((t) => t.trim());
  const comments = (item.comment_texts || []).filter((t) => t.trim());
  const urls = (item.source_post_urls || []).filter((t) => t.trim());
  const texts = [...snippets, ...comments];
  const uniqueTexts: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    const key = t.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTexts.push(t);
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-brand-green/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
          Рекомендация
        </span>
        <AdminOriginCountBadges
          compact
          selfAd={item.self_ad_mention_count}
          thirdParty={item.third_party_mention_count}
        />
        {item.mention_count > 0 ? (
          <span className="text-[11px] text-slate-500">
            всего упоминаний: {item.mention_count}
          </span>
        ) : null}
      </div>

      {uniqueTexts.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Тексты из источников
          </p>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {uniqueTexts.slice(0, 8).map((text, i) => (
              <li
                key={i}
                className="rounded-lg bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700"
              >
                {text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Текстов рекомендации в записи нет.
        </p>
      )}

      {urls.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ссылки на посты
          </p>
          <ul className="space-y-1">
            {urls.slice(0, 6).map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-sm font-medium text-brand-blue hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
