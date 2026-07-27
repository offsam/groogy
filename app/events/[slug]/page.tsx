import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareEntityButton } from "@/components/engagement/ShareEntityButton";
import { EntitySourceCard } from "@/components/shared/EntitySourceCard";
import { getPublishedEventBySlug } from "@/lib/events/queries";
import { eventTimingLabel } from "@/lib/events/timing";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function formatRuDateTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function formatRuDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function normalizeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw).normalize("NFC");
  } catch {
    return raw.normalize("NFC");
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: raw } = await params;
  const slug = normalizeSlug(raw);
  try {
    const client = createServiceRoleClient();
    const event = await getPublishedEventBySlug(client, slug);
    if (!event) return { title: "Событие — КРУГИ" };
    return {
      title: `${event.title} — КРУГИ`,
      description:
        (event.source_body || event.description)?.slice(0, 160) ||
        "Событие сообщества",
    };
  } catch {
    return { title: "Событие — КРУГИ" };
  }
}

export default async function EventDetailPage({ params }: PageProps) {
  const { slug: raw } = await params;
  const slug = normalizeSlug(raw);

  let event = null;
  let loadError: string | null = null;
  try {
    const client = createServiceRoleClient();
    event = await getPublishedEventBySlug(client, slug);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить событие";
  }
  if (!event) {
    if (loadError) {
      return (
        <div className="mx-auto max-w-2xl px-3 py-10 text-sm text-red-700">
          Ошибка загрузки события: {loadError}
        </div>
      );
    }
    notFound();
  }

  const timing = eventTimingLabel(event.starts_at);
  const postedLabel = formatRuDateTime(event.source_posted_at);
  const eventWhen =
    formatRuDate(event.starts_at) || event.event_at_label || null;
  const body =
    (event.source_body || event.description || "").trim() || null;

  const sourceHost = (() => {
    if (!event.source_url) return null;
    try {
      return new URL(event.source_url).hostname.replace(/^www\./, "");
    } catch {
      return "оригинал";
    }
  })();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-3 py-6 sm:px-6 sm:py-8">
      <p className="text-sm">
        <Link href="/events" className="text-brand-blue hover:underline">
          ← Все события
        </Link>
      </p>

      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-sm font-bold text-brand-blue-deep"
            aria-hidden
          >
            {event.city?.slice(0, 1) || "К"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">
              {event.city
                ? `Событие · ${event.city}`
                : "Событие сообщества"}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {postedLabel
                ? `Пост от ${postedLabel}`
                : "Дата публикации поста неизвестна"}
              {sourceHost ? ` · ${sourceHost}` : null}
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <ShareEntityButton
              title={event.title}
              url={`/events/${event.slug}`}
            />
            <span
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                timing.kind === "past"
                  ? "bg-slate-200 text-slate-700"
                  : timing.kind === "upcoming"
                    ? "bg-brand-green/15 text-emerald-800"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {timing.kind === "past" ? "Уже прошло" : timing.text}
            </span>
          </div>
        </header>

        {event.cover_image_url ? (
          <a
            href={event.cover_image_url}
            target="_blank"
            rel="noreferrer"
            className="block bg-slate-100"
            title="Открыть фото в полном размере"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.cover_image_url}
              alt=""
              className="mx-auto max-h-[80vh] w-full object-contain"
            />
          </a>
        ) : null}

        <div className="space-y-4 px-4 py-5 sm:px-5">
          <div>
            <h1 className="text-xl font-semibold leading-snug tracking-tight text-slate-900 sm:text-2xl">
              {event.title}
            </h1>
            {eventWhen ? (
              <p className="mt-2 text-sm text-slate-600">
                Дата события:{" "}
                <span className="font-medium text-slate-800">{eventWhen}</span>
                {event.event_at_label &&
                event.event_at_label !== eventWhen ? (
                  <span className="text-slate-400">
                    {" "}
                    (в посте: {event.event_at_label})
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          {body ? (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800">
              {body}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Текст поста не сохранился.</p>
          )}

          {event.format && event.format !== "unknown" ? (
            <p className="text-sm text-slate-500">
              Формат:{" "}
              {event.format === "online"
                ? "онлайн"
                : event.format === "offline"
                  ? "офлайн"
                  : event.format}
            </p>
          ) : null}

          {event.registration_url ? (
            <a
              href={event.registration_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
            >
              Регистрация / сайт
            </a>
          ) : null}
        </div>

        <footer className="space-y-3 border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-5">
          {event.source_url ? (
            <EntitySourceCard
              anchorId="event-source"
              className="border-0 bg-transparent p-0 shadow-none"
              hasSource
              initiallyRevealed
              isAuthenticated
              sourceKind={
                /facebook\.com|fb\.com/i.test(event.source_url)
                  ? "facebook"
                  : /t\.me\/|telegram\.me/i.test(event.source_url)
                    ? "telegram"
                    : null
              }
              sourceUrl={event.source_url}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Ссылка на исходный пост не сохранилась.
            </p>
          )}
          {postedLabel ? (
            <p className="text-xs text-slate-500">Опубликован {postedLabel}</p>
          ) : null}
        </footer>
      </article>
    </div>
  );
}
