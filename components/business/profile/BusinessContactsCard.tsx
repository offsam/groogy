"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, Globe, Mail, Navigation, Phone, CalendarCheck } from "lucide-react";
import {
  FacebookIcon,
  GoogleIcon,
  InstagramIcon,
  TelegramIcon,
  YelpIcon,
} from "@/components/brand/BrandIcons";
import { QuickAuthModal } from "@/components/auth/QuickAuthModal";
import { EditPencil } from "@/components/business/profile/edit/EditPencil";
import {
  EMPTY_PRESENCE_FLAGS,
  hasAnyPresenceFlag,
  type BusinessPresenceFlags,
} from "@/lib/business/presence-flags";
import {
  hasGoogleMapsPresence,
  resolveFacebookUrl,
  resolveGoogleMapsUrl,
  resolveInstagramUrl,
  resolveTelegramUrl,
  resolveWebsiteUrl,
  resolveYelpUrl,
  telegramContactLabel,
  type BusinessPresence,
} from "@/lib/business/presence";
import { cn } from "@/lib/utils";
import { formatWebsiteHost } from "@/lib/supabase/mappers";

type BusinessContactsCardProps = {
  businessId: string;
  businessSlug: string;
  businessName: string;
  /** Present for owners/edit; null for guests (load via API after auth). */
  phone?: string | null;
  email?: string | null;
  extraPhones?: string[];
  fallbackPhone?: string | null;
  fallbackEmail?: string | null;
  presence: BusinessPresence;
  presenceFlags?: BusinessPresenceFlags | null;
  routeUrl?: string | null;
  initiallyRevealed?: boolean;
  isAuthenticated?: boolean;
  editMode?: boolean;
  onEdit?: () => void;
};

type ContactItem = {
  key: string;
  title: string;
  href: string;
  icon: ReactNode;
  label: ReactNode;
  external?: boolean;
};

type ContactsApiResponse = {
  phone?: string | null;
  email?: string | null;
  extraPhones?: string[];
  website?: string | null;
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  sourceUrl?: string | null;
  sourceKind?: "telegram" | "facebook" | "platform" | null;
  facebookUrl?: string | null;
  yelpUrl?: string | null;
  googleMapsUrl?: string | null;
  routeUrl?: string | null;
  addressLine?: string | null;
};

const chipClass =
  "inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600";

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return phone;
}

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function uniquePhones(phones: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of phones) {
    const value = raw?.trim();
    if (!value) continue;
    const key = phoneDigits(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function InstagramHandle({ url }: { url: string }) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const handle = u.pathname.replace(/\//g, "");
    return handle ? `@${handle}` : formatWebsiteHost(url);
  } catch {
    return formatWebsiteHost(url);
  }
}

function buildItems(input: {
  phones: string[];
  email: string | null;
  presence: BusinessPresence;
  businessName: string;
  routeUrl: string | null;
}): ContactItem[] {
  const website = resolveWebsiteUrl(input.presence);
  const instagram = resolveInstagramUrl(input.presence);
  const telegram = resolveTelegramUrl(input.presence);
  const facebook = resolveFacebookUrl(input.presence);
  const yelp = resolveYelpUrl(input.presence);
  const googleHref = hasGoogleMapsPresence(input.presence)
    ? resolveGoogleMapsUrl(input.presence, input.businessName)
    : null;
  const coordsRoute =
    typeof input.presence.latitude === "number" &&
    Number.isFinite(input.presence.latitude) &&
    typeof input.presence.longitude === "number" &&
    Number.isFinite(input.presence.longitude)
      ? `https://www.google.com/maps/dir/?api=1&destination=${input.presence.latitude},${input.presence.longitude}`
      : null;
  const routeHref =
    input.routeUrl?.trim() ||
    coordsRoute ||
    (input.businessName.trim()
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(input.businessName.trim())}`
      : null);
  const showRoute = Boolean(routeHref && routeHref !== googleHref);
  const booking = input.presence.bookingUrl?.trim() || null;

  const items: ContactItem[] = [];
  if (booking) {
    items.push({
      key: "booking",
      title: "Онлайн-запись",
      href: booking,
      icon: <CalendarCheck aria-hidden="true" className="size-3.5" />,
      label: "Записаться",
      external: true,
    });
  }
  input.phones.forEach((resolvedPhone, index) => {
    items.push({
      key: `phone-${index}`,
      title: index === 0 ? "Телефон" : `Телефон ${index + 1}`,
      href: `tel:${resolvedPhone}`,
      icon: <Phone aria-hidden="true" className="size-3.5" />,
      label: formatPhoneDisplay(resolvedPhone),
    });
  });
  if (input.email) {
    items.push({
      key: "email",
      title: "Email",
      href: `mailto:${input.email}`,
      icon: <Mail aria-hidden="true" className="size-3.5" />,
      label: input.email,
    });
  }
  if (telegram) {
    items.push({
      key: "telegram",
      title: telegramContactLabel(telegram),
      href: telegram,
      icon: <TelegramIcon className="size-3.5" />,
      label: telegramContactLabel(telegram),
      external: true,
    });
  }
  if (website) {
    items.push({
      key: "website",
      title: "Сайт",
      href: website,
      icon: <Globe aria-hidden="true" className="size-3.5" />,
      label: formatWebsiteHost(website),
      external: true,
    });
  }
  if (instagram) {
    items.push({
      key: "instagram",
      title: "Instagram",
      href: instagram,
      icon: <InstagramIcon className="size-3.5 text-[#E4405F]" />,
      label: <InstagramHandle url={instagram} />,
      external: true,
    });
  }
  if (facebook) {
    items.push({
      key: "facebook",
      title: "Facebook",
      href: facebook,
      icon: <FacebookIcon className="size-3.5" />,
      label: "Facebook",
      external: true,
    });
  }
  if (yelp) {
    items.push({
      key: "yelp",
      title: "Yelp",
      href: yelp,
      icon: <YelpIcon className="size-3.5" />,
      label: "Yelp",
      external: true,
    });
  }
  if (googleHref) {
    items.push({
      key: "google",
      title: "Google Maps",
      href: googleHref,
      icon: <GoogleIcon className="size-3.5" />,
      label: "Google Maps",
      external: true,
    });
  }
  if (showRoute && routeHref) {
    items.push({
      key: "route",
      title: "Маршрут",
      href: routeHref,
      icon: <Navigation aria-hidden="true" className="size-3.5" />,
      label: "Маршрут",
      external: true,
    });
  }
  return items;
}

function flagChips(flags: BusinessPresenceFlags): Array<{ key: string; title: string; icon: ReactNode }> {
  const chips: Array<{ key: string; title: string; icon: ReactNode }> = [];
  if (flags.hasPhone) {
    chips.push({
      key: "phone",
      title: "Телефон",
      icon: <Phone aria-hidden="true" className="size-3.5" />,
    });
  }
  if (flags.hasTelegram) {
    chips.push({
      key: "telegram",
      title: "Telegram",
      icon: <TelegramIcon className="size-3.5" />,
    });
  }
  if (flags.hasWebsite) {
    chips.push({
      key: "website",
      title: "Сайт",
      icon: <Globe aria-hidden="true" className="size-3.5" />,
    });
  }
  if (flags.hasInstagram) {
    chips.push({
      key: "instagram",
      title: "Instagram",
      icon: <InstagramIcon className="size-3.5 text-[#E4405F]" />,
    });
  }
  if (flags.hasGoogleMaps) {
    chips.push({
      key: "google",
      title: "Google Maps",
      icon: <GoogleIcon className="size-3.5" />,
    });
  }
  if (flags.hasEmail) {
    chips.push({
      key: "email",
      title: "Email",
      icon: <Mail aria-hidden="true" className="size-3.5" />,
    });
  }
  if (flags.hasYelp) {
    chips.push({
      key: "yelp",
      title: "Yelp",
      icon: <YelpIcon className="size-3.5" />,
    });
  }
  if (flags.hasFacebook) {
    chips.push({
      key: "facebook",
      title: "Facebook",
      icon: <FacebookIcon className="size-3.5" />,
    });
  }
  return chips;
}

/**
 * Contacts under the map.
 * Guests see locked flag chips; after auth, contacts load from /api/business/[slug]/contacts.
 * Owners in edit mode receive plaintext from SSR and skip the API.
 */
export function BusinessContactsCard({
  businessId,
  businessSlug,
  businessName,
  phone = null,
  email = null,
  extraPhones = [],
  fallbackPhone = null,
  fallbackEmail = null,
  presence,
  presenceFlags = null,
  routeUrl = null,
  initiallyRevealed = false,
  isAuthenticated = false,
  editMode = false,
  onEdit,
}: BusinessContactsCardProps) {
  const hasServerContacts = Boolean(
    phone?.trim() ||
      email?.trim() ||
      presence.website?.trim() ||
      presence.instagramUrl?.trim() ||
      presence.telegramUrl?.trim() ||
      presence.yelpUrl?.trim() ||
      presence.googleMapsUrl?.trim() ||
      extraPhones.some((p) => p?.trim()) ||
      fallbackPhone?.trim() ||
      fallbackEmail?.trim(),
  );

  const [revealed, setRevealed] = useState(
    Boolean(initiallyRevealed && (isAuthenticated || editMode) && hasServerContacts),
  );
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<ContactsApiResponse | null>(null);
  const tracked = useRef(revealed);

  const flags = presenceFlags ?? EMPTY_PRESENCE_FLAGS;
  const previewChips = flagChips(flags);

  const activePresence: BusinessPresence = fetched
    ? {
        website: fetched.website,
        instagramUrl: fetched.instagramUrl,
        telegramUrl: fetched.telegramUrl,
        sourceUrl: fetched.sourceUrl,
        sourceKind: fetched.sourceKind,
        facebookUrl: fetched.facebookUrl,
        yelpUrl: fetched.yelpUrl,
        googleMapsUrl: fetched.googleMapsUrl,
        latitude: presence.latitude,
        longitude: presence.longitude,
      }
    : presence;

  const phones = uniquePhones([
    fetched?.phone ?? phone,
    ...(fetched?.extraPhones ?? []),
    ...extraPhones,
    fallbackPhone,
  ]);
  const resolvedEmail =
    (fetched?.email ?? email)?.trim() || fallbackEmail?.trim() || null;

  const items = buildItems({
    phones,
    email: resolvedEmail,
    presence: activePresence,
    businessName,
    routeUrl: fetched?.routeUrl ?? routeUrl,
  });

  const showLocked =
    !revealed && (hasAnyPresenceFlag(flags) || previewChips.length > 0 || items.length > 0);
  const lockedChips =
    previewChips.length > 0
      ? previewChips
      : items.map((item) => ({
          key: item.key,
          title: item.title,
          icon: item.icon,
        }));

  async function loadContacts() {
    // Edit mode already has plaintext contacts from SSR.
    if (editMode && hasServerContacts) {
      setRevealed(true);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/business/${encodeURIComponent(businessSlug)}/contacts`);
      if (res.status === 401) {
        setAuthOpen(true);
        return;
      }
      if (!res.ok) {
        throw new Error(`contacts_${res.status}`);
      }
      const data = (await res.json()) as ContactsApiResponse;
      setFetched(data);
      setRevealed(true);
      tracked.current = true;
    } catch {
      setLoadError("Не удалось загрузить контакты. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuthenticated || revealed || editMode) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#business-contacts") return;
    void loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hash auto-reveal once
  }, [isAuthenticated, revealed, editMode, businessSlug]);

  if (!hasAnyPresenceFlag(flags) && items.length === 0 && !editMode && !showLocked) {
    return null;
  }

  function onShowContacts() {
    if (!isAuthenticated && !editMode) {
      setAuthOpen(true);
      return;
    }
    void loadContacts();
  }

  const nextPath =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search || ""}#business-contacts`
      : `/business/${businessSlug}#business-contacts`;

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4"
      id="business-contacts"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Контакты</h2>
        {editMode && onEdit ? (
          <EditPencil label="Редактировать контакты" onClick={onEdit} />
        ) : null}
      </div>

      {items.length === 0 && editMode && revealed ? (
        <p className="mt-2 text-sm text-slate-500">
          Контакты ещё не указаны — добавьте телефон или ссылки.
        </p>
      ) : null}

      {showLocked ? (
        <>
          <div
            aria-label="Доступные контакты"
            className="mt-3 flex flex-wrap gap-2"
          >
            {lockedChips.map((item) => (
              <span
                key={item.key}
                aria-hidden="true"
                className={cn(chipClass, "cursor-default opacity-80")}
                title={item.title}
              >
                {item.icon}
              </span>
            ))}
          </div>
          <button
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            disabled={loading}
            style={{ color: "#ffffff" }}
            type="button"
            onClick={onShowContacts}
          >
            <Eye aria-hidden="true" className="size-4" style={{ color: "#ffffff" }} />
            {loading ? "Загрузка…" : "Показать контакты"}
          </button>
          {loadError ? (
            <p className="mt-2 text-sm text-red-600">{loadError}</p>
          ) : null}
        </>
      ) : null}

      {revealed && items.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <a
                className="flex min-h-11 items-center gap-3 rounded-xl px-1 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-blue sm:min-h-0 sm:py-1.5"
                href={item.href}
                title={item.title}
                {...(item.external
                  ? { rel: "noopener noreferrer", target: "_blank" }
                  : {})}
              >
                <span className={cn(chipClass, "size-8")}>{item.icon}</span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {item.label}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <QuickAuthModal
        nextPath={nextPath}
        open={authOpen}
        subtitle="После входа контакты откроются на этой странице."
        title="Войдите, чтобы увидеть контакты"
        onClose={() => setAuthOpen(false)}
      />
    </section>
  );
}
