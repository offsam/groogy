"use client";

import Link from "next/link";
import type {
  CommentRecommendation,
  RecommendationTargetBucket,
} from "@/lib/import-review/recommendation-queries";

type Props = {
  items: CommentRecommendation[];
  total: number;
  page: number;
  pageSize: number;
  bucket: RecommendationTargetBucket | "all";
  bucketCounts: Record<string, number>;
  status: string;
};

const BUCKET_TABS: {
  id: RecommendationTargetBucket | "all";
  label: string;
}[] = [
  { id: "all", label: "Все" },
  { id: "professional", label: "Профи" },
  { id: "business", label: "Бизнесы" },
  { id: "service", label: "Услуги" },
  { id: "other", label: "Прочее" },
  { id: "unclassified", label: "Без якоря" },
];

function bucketLabel(bucket: string | null | undefined): string {
  switch (bucket) {
    case "professional":
      return "профи";
    case "business":
      return "бизнес";
    case "service":
      return "услуга";
    case "other":
      return "прочее";
    default:
      return "без якоря";
  }
}

function bucketTone(bucket: string | null | undefined): string {
  switch (bucket) {
    case "professional":
      return "bg-brand-blue/10 text-brand-blue-deep";
    case "business":
      return "bg-sky-100 text-sky-900";
    case "service":
      return "bg-brand-orange/15 text-orange-900";
    case "other":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-amber-50 text-amber-900";
  }
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

function mentionsLabel(n: number, kind: string, channel?: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "упоминание"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
        ? "упоминания"
        : "упоминаний";
  if (kind === "event") return `${n} ${word} / репостов`;
  if (channel === "telegram") return `${n} ${word} в Telegram`;
  return `${n} ${word} в комментариях`;
}

function categoryTone(category: string | null, kind: string): string {
  if (kind === "event" || (category || "").includes("событ")) {
    return "bg-brand-green/15 text-emerald-800";
  }
  const c = (category || "").toLowerCase();
  if (c.includes("лечу") || c.includes("посыл")) {
    return "bg-brand-green/15 text-emerald-800";
  }
  if (c.includes("перевод")) {
    return "bg-brand-orange/15 text-orange-900";
  }
  if (c.includes("риелтор")) {
    return "bg-sky-100 text-sky-900";
  }
  return "bg-brand-blue/10 text-brand-blue-deep";
}

function telegramFromWebsites(websites: string[]): {
  label: string;
  href: string;
} | null {
  for (const w of websites) {
    const m = w.match(/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{3,})/i);
    if (m?.[1]) {
      return { label: `@${m[1]}`, href: `https://t.me/${m[1]}` };
    }
  }
  return null;
}

function primaryContact(item: CommentRecommendation): {
  label: string;
  href: string | null;
} {
  if (item.phones[0]) {
    return {
      label: formatPhone(item.phones[0]),
      href: `tel:${item.phones[0]}`,
    };
  }
  const tg = telegramFromWebsites(item.websites);
  if (tg) {
    return tg;
  }
  if (item.instagram[0]) {
    return {
      label: `@${item.instagram[0]}`,
      href: `https://instagram.com/${item.instagram[0]}`,
    };
  }
  if (item.websites[0]) {
    return {
      label: item.websites[0].replace(/^https?:\/\//, "").slice(0, 42),
      href: item.websites[0],
    };
  }
  return { label: "Нет контакта", href: null };
}

function sourceLabel(channel: string): string {
  if (channel === "telegram") return "Telegram";
  if (channel === "facebook") return "Facebook";
  return channel;
}

function originCounts(item: CommentRecommendation): {
  third: number;
  self: number;
} {
  const third = Math.max(0, Number(item.third_party_mention_count ?? 0));
  const self = Math.max(0, Number(item.self_ad_mention_count ?? 0));
  if (third > 0 || self > 0) {
    return { third, self };
  }
  // Legacy rows before origin counters: FB comment recs ≈ third-party.
  if (item.source_channel === "facebook" && (item.recommender_names?.length ?? 0) > 0) {
    return { third: item.mention_count, self: 0 };
  }
  return { third: 0, self: item.mention_count };
}

function OriginBadges({
  third,
  self,
}: {
  third: number;
  self: number;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {third > 0 ? (
        <span
          className="rounded-lg bg-brand-green/15 px-2 py-1 text-xs font-semibold text-emerald-800"
          title="Сколько раз рекомендовали другие"
        >
          чужие ×{third}
        </span>
      ) : null}
      {self > 0 ? (
        <span
          className="rounded-lg bg-brand-orange/15 px-2 py-1 text-xs font-semibold text-brand-orange"
          title="Сколько раз рекламировали себя"
        >
          сами ×{self}
        </span>
      ) : null}
      {third === 0 && self === 0 ? (
        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
          ×0
        </span>
      ) : null}
    </div>
  );
}

function CardGrid({
  items,
  empty,
}: {
  items: CommentRecommendation[];
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
        {empty}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const kind = item.kind || "profi";
        const contact = primaryContact(item);
        const category =
          item.category_guess ||
          (kind === "event" ? "событие" : "услуга / специалист");
        const { third, self } = originCounts(item);
        const total = Math.max(item.mention_count, third + self);
        return (
          <article
            key={item.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            {item.cover_image_url ? (
              <div className="relative aspect-[16/9] w-full bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.cover_image_url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : null}
            <div className="flex flex-1 flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold leading-snug text-slate-900">
                {item.display_name || "Без названия"}
              </h3>
              <OriginBadges third={third} self={self} />
            </div>

            <p className="mt-1 text-xs text-slate-500">
              {mentionsLabel(total, kind, item.source_channel)}
              {third > 0 && self > 0
                ? ` · ${third} чужие / ${self} сами`
                : third > 0
                  ? " · рекомендуют другие"
                  : self > 0
                    ? " · самореклама"
                    : ""}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <span
                className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${bucketTone(item.target_bucket)}`}
              >
                {bucketLabel(item.target_bucket)}
              </span>
              <span
                className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${categoryTone(category, kind)}`}
              >
                {category}
              </span>
              <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {sourceLabel(item.source_channel)}
              </span>
              {item.city ? (
                <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  {item.city}
                </span>
              ) : null}
              {kind === "event" && item.event_at ? (
                <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  {item.event_at}
                </span>
              ) : null}
              {third > 0 && self === 0 ? (
                <span className="inline-flex rounded-md bg-brand-green/15 px-2 py-1 text-xs font-medium text-emerald-800">
                  рекомендация
                </span>
              ) : null}
              {self > 0 && third === 0 ? (
                <span className="inline-flex rounded-md bg-brand-orange/15 px-2 py-1 text-xs font-medium text-orange-900">
                  самореклама
                </span>
              ) : null}
              {third > 0 && self > 0 ? (
                <span className="inline-flex rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-900">
                  смешанное
                </span>
              ) : null}
            </div>

            {kind === "event" && item.recommender_names[0] ? (
              <p className="mt-2 text-xs text-slate-500">
                Организатор / автор: {item.recommender_names[0]}
              </p>
            ) : third > 0 && item.recommender_names[0] ? (
              <p className="mt-2 text-xs text-slate-500">
                Рекомендовали: {item.recommender_names.slice(0, 3).join(", ")}
                {item.recommender_names.length > 3
                  ? ` +${item.recommender_names.length - 3}`
                  : ""}
              </p>
            ) : null}

            <div className="mt-3 space-y-1 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {kind === "event" ? "Ссылка" : "Контакт"}
              </p>
              {contact.href ? (
                <a
                  href={contact.href}
                  className="break-all font-medium text-brand-blue hover:underline"
                  target={contact.href.startsWith("http") ? "_blank" : undefined}
                  rel={
                    contact.href.startsWith("http") ? "noreferrer" : undefined
                  }
                >
                  {contact.label}
                </a>
              ) : (
                <span className="text-slate-500">{contact.label}</span>
              )}
              {kind !== "event" ? (
                <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {item.phones[0] && contact.href !== `tel:${item.phones[0]}` ? (
                    <a
                      href={`tel:${item.phones[0]}`}
                      className="block text-brand-blue hover:underline"
                    >
                      {formatPhone(item.phones[0])}
                    </a>
                  ) : null}
                  {item.instagram[0] ? (
                    <a
                      href={`https://instagram.com/${item.instagram[0]}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-brand-blue hover:underline"
                    >
                      IG @{item.instagram[0]}
                    </a>
                  ) : null}
                  {telegramFromWebsites(item.websites) &&
                  contact.href !== telegramFromWebsites(item.websites)?.href ? (
                    <a
                      href={telegramFromWebsites(item.websites)!.href}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-brand-blue hover:underline"
                    >
                      TG {telegramFromWebsites(item.websites)!.label}
                    </a>
                  ) : null}
                  {item.websites
                    .filter(
                      (w) =>
                        !/t\.me\/|telegram\.me\/|instagram\.com/i.test(w),
                    )
                    .slice(0, 2)
                    .map((w) => (
                      <a
                        key={w}
                        href={w}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all text-brand-blue hover:underline"
                      >
                        {w.replace(/^https?:\/\//, "").slice(0, 48)}
                      </a>
                    ))}
                  {item.notes?.includes("emails:") ? (
                    <p className="text-slate-500">
                      {item.notes
                        .split(";")
                        .map((p) => p.trim())
                        .find((p) => p.startsWith("emails:"))}
                    </p>
                  ) : null}
                  {item.notes?.includes("address:") ? (
                    <p className="text-slate-500">
                      {item.notes
                        .split(";")
                        .map((p) => p.trim())
                        .find((p) => p.startsWith("address:"))
                        ?.replace(/^address:/, "")
                        .trim()}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {(item.request_snippets[0] || item.comment_texts[0]) ? (
              <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-slate-500">
                {item.request_snippets[0] || item.comment_texts[0]}
              </p>
            ) : null}

                {item.source_post_urls[0] ? (
              <a
                href={item.source_post_urls[0]}
                target="_blank"
                rel="noreferrer"
                className="mt-auto pt-3 text-xs text-brand-blue hover:underline"
              >
                Исходный пост →
              </a>
            ) : (
              <div className="mt-auto pt-3" />
            )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function CommentRecommendationsPanel({
  items,
  total,
  page,
  pageSize,
  bucket,
  bucketCounts,
  status,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const profi = items.filter((i) => i.kind !== "event");

  function tabHref(nextBucket: string) {
    const q = new URLSearchParams();
    if (status && status !== "pending") q.set("status", status);
    if (nextBucket && nextBucket !== "all") q.set("bucket", nextBucket);
    if (page > 1 && nextBucket === bucket) q.set("page", String(page));
    const qs = q.toString();
    return qs ? `/admin/recommendations?${qs}` : "/admin/recommendations";
  }

  function pageHref(nextPage: number) {
    const q = new URLSearchParams();
    if (status && status !== "pending") q.set("status", status);
    if (bucket && bucket !== "all") q.set("bucket", bucket);
    if (nextPage > 1) q.set("page", String(nextPage));
    const qs = q.toString();
    return qs ? `/admin/recommendations?${qs}` : "/admin/recommendations";
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-500">
        Перед переносом в каталог карточки размечены:{" "}
        <strong className="font-medium text-slate-700">профи</strong>,{" "}
        <strong className="font-medium text-slate-700">бизнес</strong>,{" "}
        <strong className="font-medium text-slate-700">услуга</strong> (только с
        якорем — пост или контакт).{" "}
        <span className="font-medium text-amber-900">Без якоря</span> — не
        переносим. На карточке:{" "}
        <span className="font-medium text-emerald-800">чужие ×N</span> /{" "}
        <span className="font-medium text-brand-orange">сами ×N</span>. События
        — в{" "}
        <Link href="/admin/events" className="text-brand-blue hover:underline">
          /admin/events
        </Link>
        .
      </p>

      <div className="flex flex-wrap gap-2">
        {BUCKET_TABS.map((tab) => {
          const active = bucket === tab.id;
          const count = bucketCounts[tab.id] ?? 0;
          return (
            <Link
              key={tab.id}
              href={tabHref(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-brand-blue text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {tab.label}
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  active ? "bg-white/20 text-white" : "bg-white text-slate-500"
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {BUCKET_TABS.find((t) => t.id === bucket)?.label || "Карточки"}
          </h2>
          <span className="text-sm text-slate-500">{profi.length}</span>
        </div>
        <CardGrid
          items={profi}
          empty="В этой корзине карточек нет"
        />
      </section>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {total} всего · стр. {page}/{totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
                href={pageHref(page - 1)}
              >
                Назад
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
                href={pageHref(page + 1)}
              >
                Дальше
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{total} карточек на странице</p>
      )}
    </div>
  );
}
