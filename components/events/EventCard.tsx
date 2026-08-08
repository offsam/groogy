import Image from "next/image";
import Link from "next/link";
import { Calendar } from "lucide-react";
import {
  CategoryAccentBar,
  CategoryChip,
  CategoryMediaFallback,
} from "@/components/platform/CategoryCardChrome";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import { ReportEntityButton } from "@/components/support/ReportEntityButton";
import type { PlatformEvent } from "@/lib/events/queries";
import { eventTimingLabel } from "@/lib/events/timing";

function formatWhen(iso: string | null, label: string | null): string | null {
  if (label) return label;
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

export function EventCard({
  event,
  preview = false,
}: {
  event: PlatformEvent;
  /** Admin moderation: no public navigation. */
  preview?: boolean;
}) {
  const timing = eventTimingLabel(event.starts_at);
  const whenLabel = formatWhen(event.starts_at, event.event_at_label);
  const past = timing.kind === "past";

  const className = `flex h-full flex-col overflow-hidden rounded-2xl border bg-white transition ${
    past ? "border-slate-200 opacity-80" : "border-slate-200"
  } ${preview ? "" : "hover:border-slate-300 hover:shadow-sm"}`;

  const body = (
    <>
      <CategoryAccentBar muted={past} theme="events" />
      {event.cover_image_url ? (
        <div className="relative h-40 w-full bg-slate-100">
          <Image
            src={event.cover_image_url}
            alt=""
            fill
            className={`object-cover ${past ? "grayscale-[30%]" : ""}`}
            sizes="(max-width: 640px) 100vw, 33vw"
            unoptimized
          />
        </div>
      ) : (
        <div className="h-40 w-full">
          <CategoryMediaFallback icon={Calendar} theme="events" />
        </div>
      )}
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex flex-wrap gap-1.5">
          <CategoryChip muted={past} theme="events" />
          <span
            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
              past
                ? "bg-slate-200 text-slate-600"
                : timing.kind === "upcoming"
                  ? "bg-brand-green/15 text-emerald-800"
                  : "bg-slate-100 text-slate-600"
            }`}
          >
            {past ? "Уже прошло" : timing.text}
          </span>
          {past && timing.text !== "Уже прошло" ? (
            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {timing.text}
            </span>
          ) : null}
        </div>
        <p className="font-medium leading-snug text-slate-900">{event.title}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-500">
          {event.city ? <span>{event.city}</span> : null}
          {whenLabel ? <span>· {whenLabel}</span> : null}
        </div>
        {event.price_label || (event.payment_methods?.length ?? 0) > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {event.price_label ? (
              <span className="text-sm font-semibold text-slate-800">
                {event.price_label}
              </span>
            ) : null}
            <PaymentMethodIcons
              methods={event.payment_methods}
              size="sm"
            />
          </div>
        ) : null}
      </div>
    </>
  );

  if (preview) {
    return <div className={className}>{body}</div>;
  }

  return (
    <div className="relative h-full">
      <Link href={`/events/${event.slug}`} className={className}>
        {body}
      </Link>
      <ReportEntityButton
        className="absolute right-2 top-2"
        entityId={event.id}
        entityName={event.title}
        entityType="event"
      />
    </div>
  );
}
