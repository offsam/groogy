import Link from "next/link";
import type { ReactNode } from "react";
import {
  Calendar,
  ExternalLink,
  Globe,
  MapPin,
  Phone,
  Ticket,
} from "lucide-react";
import { AdminLensBar } from "@/components/admin/AdminLensBar";
import { BusinessMiniMap } from "@/components/business/profile/BusinessMiniMap";
import {
  CategoryAccentBar,
  CategoryMediaFallback,
} from "@/components/platform/CategoryCardChrome";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import { EntitySourceCard } from "@/components/shared/EntitySourceCard";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { TelegramIcon } from "@/components/brand/BrandIcons";
import { ClaimEventButton } from "@/components/claims/ClaimEventButton";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import type { PlatformEvent } from "@/lib/events/queries";
import { structureEventFromText } from "@/lib/events/structure-event-from-text";
import { eventTimingLabel } from "@/lib/events/timing";
import { CARD_THEMES } from "@/lib/platform/card-themes";

/** Narrative only — phones/links/address/price stay in dedicated blocks (contact metrics). */
function publicEventDescription(event: PlatformEvent): string | null {
  const raw = (event.description || event.source_body || "").trim();
  if (!raw) return null;
  const structured = structureEventFromText(raw).description;
  return redactContactsFromPublicText(structured || event.description || null);
}

function publicEventOriginal(event: PlatformEvent): string | null {
  const raw = (event.description_original || "").trim();
  if (!raw) return null;
  const structured = structureEventFromText(raw).description;
  return redactContactsFromPublicText(structured || raw);
}

function formatRuDateTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
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

function formatLabel(format: string | null): string | null {
  if (!format || format === "unknown") return null;
  if (format === "online") return "Онлайн";
  if (format === "offline") return "Офлайн";
  if (format === "hybrid") return "Гибрид";
  return format;
}

function telegramLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\//, "");
    return path ? `@${path.split("/")[0]}` : "Telegram";
  } catch {
    return "Telegram";
  }
}

function LocationBlock({
  event,
  showMap,
}: {
  event: PlatformEvent;
  showMap: boolean;
}) {
  const address = event.address_line?.trim() || null;
  const city = event.city?.trim() || null;
  if (!address && !city && !showMap) return null;

  return (
    <section
      aria-label="Где"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
    >
      <div className="space-y-2 px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">Где</h2>
        {address ? (
          <p className="flex items-start gap-2 text-[15px] leading-snug text-slate-800">
            <MapPin
              className="mt-0.5 size-4 shrink-0 text-brand-green"
              aria-hidden
            />
            <span>{address}</span>
          </p>
        ) : null}
        {city ? (
          <p className={`text-sm text-slate-500 ${address ? "pl-6" : ""}`}>
            {city}
          </p>
        ) : null}
        {!address && !city ? (
          <p className="text-sm text-slate-500">Место уточняется</p>
        ) : null}
      </div>
      {showMap ? (
        <div className="border-t border-slate-100">
          <BusinessMiniMap
            lat={Number(event.latitude)}
            lng={Number(event.longitude)}
            zoom={14}
          />
        </div>
      ) : null}
    </section>
  );
}

function ContactsBlock({ event }: { event: PlatformEvent }) {
  const phone = event.phone?.trim() || null;
  const telegram = event.telegram_url?.trim() || null;
  const registration = event.registration_url?.trim() || null;
  const source = event.source_url?.trim() || null;
  if (!phone && !telegram && !registration && !source) return null;

  const sourceKind = source
    ? /facebook\.com|fb\.com/i.test(source)
      ? ("facebook" as const)
      : /t\.me\/|telegram\.me/i.test(source)
        ? ("telegram" as const)
        : null
    : null;

  return (
    <section
      aria-label="Контакты"
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold text-slate-900">Контакты</h2>
      <ul className="space-y-2">
        {phone ? (
          <li>
            <a
              href={`tel:${phone.replace(/[^\d+]/g, "")}`}
              className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 transition hover:border-brand-blue/40 hover:bg-slate-50"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
                <Phone className="size-4" aria-hidden />
              </span>
              {phone}
            </a>
          </li>
        ) : null}
        {telegram ? (
          <li>
            <a
              href={telegram}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 transition hover:border-brand-blue/40 hover:bg-slate-50"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                <TelegramIcon className="size-4" />
              </span>
              {telegramLabel(telegram)}
            </a>
          </li>
        ) : null}
        {registration ? (
          <li>
            <a
              href={registration}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 transition hover:border-brand-blue/40 hover:bg-slate-50"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-green/15 text-emerald-800">
                <Globe className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">
                Регистрация / сайт
              </span>
              <ExternalLink className="size-3.5 shrink-0 text-slate-400" />
            </a>
          </li>
        ) : null}
      </ul>
      {source ? (
        <EntitySourceCard
          anchorId="event-source"
          className="border-0 bg-transparent p-0 shadow-none"
          hasSource
          initiallyRevealed
          isAuthenticated
          sourceKind={sourceKind}
          sourceUrl={source}
        />
      ) : null}
    </section>
  );
}

export function EventProfileView({
  event,
  isAdmin = false,
  preview = false,
  isOwner = false,
  autoClaim = false,
  adminChrome = null,
}: {
  event: PlatformEvent;
  isAdmin?: boolean;
  /** Admin moderation: no public back-link / navigation chrome. */
  preview?: boolean;
  isOwner?: boolean;
  autoClaim?: boolean;
  /** Queue preview: amber bar (Опубликовать) in place of live AdminLensBar. */
  adminChrome?: ReactNode;
}) {
  const timing = eventTimingLabel(event.starts_at);
  const calendarWhen =
    formatRuDateTime(event.starts_at) || event.event_at_label || null;
  const body = publicEventDescription(event);
  const originalBody = publicEventOriginal(event);
  const format = formatLabel(event.format);
  const price = event.price_label?.trim() || null;
  const payments = (event.payment_methods || [])
    .map((p) => (p || "").trim())
    .filter(Boolean);
  const lat = event.latitude != null ? Number(event.latitude) : null;
  const lng = event.longitude != null ? Number(event.longitude) : null;
  const showMap =
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  const past = timing.kind === "past";
  const theme = CARD_THEMES.events;

  const timingTone =
    timing.kind === "past"
      ? "border-slate-200 bg-slate-100 text-slate-700"
      : timing.kind === "upcoming"
        ? "border-emerald-200/80 bg-brand-green/15 text-emerald-900"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div
      className={
        preview
          ? "mx-auto max-w-5xl space-y-4"
          : "mx-auto max-w-5xl space-y-4 px-3 py-6 sm:px-6 sm:py-8"
      }
    >
      {!preview ? (
        <p className="text-sm">
          <Link href="/events" className="text-brand-blue hover:underline">
            ← Все события
          </Link>
        </p>
      ) : null}

      {adminChrome ? (
        adminChrome
      ) : isAdmin && !preview ? (
        <AdminLensBar entityId={event.id} kind="event" slug={event.slug} />
      ) : null}

      {!preview && !isOwner ? (
        <div className="flex justify-end">
          <ClaimEventButton
            autoSubmit={autoClaim}
            checkStatus
            eventId={event.id}
            eventSlug={event.slug}
          />
        </div>
      ) : null}

      {/* Poster */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <CategoryAccentBar muted={past} theme="events" />
        {event.cover_image_url ? (
          <a
            href={event.cover_image_url}
            target="_blank"
            rel="noreferrer"
            className="relative block aspect-[16/10] bg-slate-100 sm:aspect-[21/9]"
            title="Открыть афишу"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.cover_image_url}
              alt=""
              className={`h-full w-full object-cover ${past ? "grayscale-[25%] opacity-90" : ""}`}
            />
          </a>
        ) : (
          <div className="aspect-[16/10] sm:aspect-[21/9]">
            <CategoryMediaFallback icon={Calendar} theme="events" />
          </div>
        )}
      </div>

      {/* Under poster: date + price, same height, hug content */}
      {(calendarWhen || timing.text || price || payments.length > 0) ? (
        <div className="flex flex-wrap items-stretch gap-3">
          <section
            aria-label="Когда"
            className={`flex w-fit max-w-full min-w-[10.5rem] flex-col justify-between rounded-2xl border px-4 py-3 ${timingTone}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                  Когда
                </p>
                <p className="text-base font-semibold leading-tight tracking-tight sm:text-lg">
                  {timing.kind === "undated" && calendarWhen
                    ? calendarWhen
                    : timing.text}
                </p>
                {calendarWhen && timing.kind !== "undated" ? (
                  <p className="text-sm font-medium opacity-80">{calendarWhen}</p>
                ) : null}
              </div>
              <Calendar
                className="mt-0.5 size-6 shrink-0 opacity-40"
                aria-hidden
              />
            </div>
          </section>

          {price || payments.length > 0 ? (
            <section
              aria-label="Цена"
              className="flex w-fit max-w-full min-w-[10.5rem] flex-col justify-between rounded-2xl border border-brand-orange/25 bg-brand-orange/10 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-900/70">
                    Цена
                  </p>
                  {price ? (
                    <p className="text-base font-semibold leading-tight tracking-tight text-orange-950 sm:text-lg">
                      {price}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-orange-900/80">
                      Уточняйте у организатора
                    </p>
                  )}
                  {payments.length > 0 ? (
                    <PaymentMethodIcons methods={payments} />
                  ) : null}
                </div>
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/80 text-brand-orange">
                  <Ticket className="size-4" aria-hidden />
                </span>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Title + meta + CTA */}
      <header className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${theme.chip}`}>
            Событие
          </span>
          {format ? (
            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
              {format}
            </span>
          ) : null}
          {event.city ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
              <MapPin className="size-3" aria-hidden />
              {event.city}
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold leading-snug tracking-tight text-slate-900 sm:text-3xl">
          {event.title}
        </h1>
        {event.registration_url ? (
          <a
            href={event.registration_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95"
          >
            Регистрация / сайт
            <ExternalLink className="size-4" aria-hidden />
          </a>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
        <div className="space-y-4">
          <section
            aria-label="Описание"
            className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
          >
            {body ? (
              <DescriptionWithOriginal
                heading="Описание"
                text={body}
                original={originalBody}
              />
            ) : (
              <>
                <h2 className="text-base font-semibold text-slate-900">
                  Описание
                </h2>
                <p className="mt-3 text-sm text-slate-500">
                  Описание пока не добавлено.
                </p>
              </>
            )}
          </section>

          {/* Mobile: location under description */}
          <div className="lg:hidden">
            <LocationBlock event={event} showMap={showMap} />
          </div>
          <div className="lg:hidden">
            <ContactsBlock event={event} />
          </div>
        </div>

        <aside className="hidden space-y-4 lg:sticky lg:top-24 lg:block">
          <LocationBlock event={event} showMap={showMap} />
          <ContactsBlock event={event} />
        </aside>
      </div>
    </div>
  );
}
