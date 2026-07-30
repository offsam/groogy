import Link from "next/link";
import { Megaphone } from "lucide-react";
import type { EntityUpdate } from "@/types/update";

function formatPublishedAt(iso: string): string | null {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function UpdateCard({
  update,
  showOwner = false,
}: {
  update: EntityUpdate;
  showOwner?: boolean;
}) {
  const when = formatPublishedAt(update.publishedAt);
  return (
    <article className="rounded-2xl border border-sky-200/80 bg-sky-50/40 p-4 sm:p-5">
      <h3 className="inline-flex items-start gap-1.5 text-base font-semibold text-slate-900">
        <Megaphone
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-brand-blue"
        />
        <span>{update.title}</span>
      </h3>
      {update.body && update.body.trim() !== update.title.trim() ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {update.body}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {when ? <time dateTime={update.publishedAt}>{when}</time> : null}
        {showOwner && update.ownerHref && update.ownerName ? (
          <Link
            href={update.ownerHref}
            className="font-medium text-brand-blue hover:underline"
          >
            {update.ownerName}
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/** Profile section — hidden entirely when there are no updates. */
export function UpdatesSection({
  updates,
  title = "Обновления",
}: {
  updates: EntityUpdate[];
  title?: string;
}) {
  if (!updates.length) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
        <Megaphone aria-hidden="true" className="size-4 text-brand-blue" />
        {title}
      </h2>
      <div className="space-y-3">
        {updates.map((update) => (
          <UpdateCard key={update.id} update={update} />
        ))}
      </div>
    </section>
  );
}
