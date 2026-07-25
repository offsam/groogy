"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, Globe, Mail, Navigation, Phone } from "lucide-react";
import {
  FacebookIcon,
  GoogleIcon,
  InstagramIcon,
  YelpIcon,
} from "@/components/brand/BrandIcons";
import { QuickAuthModal } from "@/components/auth/QuickAuthModal";
import { EditPencil } from "@/components/business/profile/edit/EditPencil";
import { trackContactRevealAction } from "@/lib/admin/actions";
import {
  hasGoogleMapsPresence,
  resolveFacebookUrl,
  resolveGoogleMapsUrl,
  resolveInstagramUrl,
  resolveWebsiteUrl,
  resolveYelpUrl,
  type BusinessPresence,
} from "@/lib/business/presence";
import { cn } from "@/lib/utils";
import { formatWebsiteHost } from "@/lib/supabase/mappers";

type BusinessContactsCardProps = {
  businessId: string;
  businessSlug: string;
  businessName: string;
  phone?: string | null;
  email?: string | null;
  /** Extra phones (e.g. Chinese line) shown after the primary number. */
  extraPhones?: string[];
  fallbackPhone?: string | null;
  fallbackEmail?: string | null;
  presence: BusinessPresence;
  routeUrl?: string | null;
  initiallyRevealed?: boolean;
  /** Logged-in users can reveal; guests see quick auth first. */
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

/**
 * Contacts under the map.
 * Locked: icon chips preview (not clickable) + «Показать контакты».
 * Unlocked: same chips become links and full link labels appear (tracks reveal).
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
  routeUrl = null,
  initiallyRevealed = false,
  isAuthenticated = false,
  editMode = false,
  onEdit,
}: BusinessContactsCardProps) {
  const phones = uniquePhones([phone, ...extraPhones, fallbackPhone]);
  const resolvedEmail = email?.trim() || fallbackEmail?.trim() || null;
  const website = resolveWebsiteUrl(presence);
  const instagram = resolveInstagramUrl(presence);
  const facebook = resolveFacebookUrl(presence);
  const yelp = resolveYelpUrl(presence);
  const googleHref = hasGoogleMapsPresence(presence)
    ? resolveGoogleMapsUrl(presence, businessName)
    : null;
  const coordsRoute =
    typeof presence.latitude === "number" &&
    Number.isFinite(presence.latitude) &&
    typeof presence.longitude === "number" &&
    Number.isFinite(presence.longitude)
      ? `https://www.google.com/maps/dir/?api=1&destination=${presence.latitude},${presence.longitude}`
      : null;
  const routeHref =
    routeUrl?.trim() ||
    coordsRoute ||
    (businessName.trim()
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(businessName.trim())}`
      : null);
  const showRoute = Boolean(routeHref && routeHref !== googleHref);

  const items: ContactItem[] = [];
  phones.forEach((resolvedPhone, index) => {
    items.push({
      key: `phone-${index}`,
      title: index === 0 ? "Телефон" : `Телефон ${index + 1}`,
      href: `tel:${resolvedPhone}`,
      icon: <Phone aria-hidden="true" className="size-3.5" />,
      label: formatPhoneDisplay(resolvedPhone),
    });
  });
  if (resolvedEmail) {
    items.push({
      key: "email",
      title: "Email",
      href: `mailto:${resolvedEmail}`,
      icon: <Mail aria-hidden="true" className="size-3.5" />,
      label: resolvedEmail,
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

  const [revealed, setRevealed] = useState(
    Boolean(initiallyRevealed && (isAuthenticated || editMode)),
  );
  const [authOpen, setAuthOpen] = useState(false);
  const tracked = useRef(revealed);

  useEffect(() => {
    if (!isAuthenticated || revealed) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#business-contacts") return;
    setRevealed(true);
    if (tracked.current) return;
    tracked.current = true;
    void trackContactRevealAction({
      businessId,
      businessSlug,
      offerId: null,
      offerSlug: null,
      surface: "business",
      path: `${window.location.pathname}${window.location.search}`,
    });
  }, [isAuthenticated, revealed, businessId, businessSlug]);

  if (items.length === 0 && !editMode) return null;

  async function reveal() {
    setRevealed(true);
    if (tracked.current) return;
    tracked.current = true;
    void trackContactRevealAction({
      businessId,
      businessSlug,
      offerId: null,
      offerSlug: null,
      surface: "business",
      path:
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : null,
    });
  }

  function onShowContacts() {
    if (!isAuthenticated && !editMode) {
      setAuthOpen(true);
      return;
    }
    void reveal();
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

      {items.length === 0 && editMode ? (
        <p className="mt-2 text-sm text-slate-500">
          Контакты ещё не указаны — добавьте телефон или ссылки.
        </p>
      ) : null}

      {items.length > 0 && !revealed ? (
        <>
          <div
            aria-label="Доступные контакты"
            className="mt-3 flex flex-wrap gap-2"
          >
            {items.map((item) => (
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
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            style={{ color: "#ffffff" }}
            type="button"
            onClick={onShowContacts}
          >
            <Eye aria-hidden="true" className="size-4" style={{ color: "#ffffff" }} />
            Показать контакты
          </button>
        </>
      ) : null}

      {items.length > 0 && revealed ? (
        <ul className="mt-2 space-y-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <a
                className="flex items-center gap-3 rounded-xl px-1 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-blue"
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
