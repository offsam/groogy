"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Eye, Globe, Mail, Phone, CalendarCheck } from "lucide-react";
import {
  InstagramIcon,
  TelegramIcon,
} from "@/components/brand/BrandIcons";
import { QuickAuthModal } from "@/components/auth/QuickAuthModal";
import {
  isInstagramUrl,
  resolveInstagramUrl,
  resolveTelegramUrl,
  resolveWebsiteUrl,
  telegramContactLabel,
} from "@/lib/business/presence";
import { ContactChannelIcon } from "@/components/contacts/ContactChannelIcon";
import {
  contactDisplayLabel,
  contactHref,
  getContactChannel,
  type ContactLink,
} from "@/lib/contacts/channels";
import { formatWebsiteHost } from "@/lib/supabase/mappers";
import { cn } from "@/lib/utils";
import type { Professional } from "@/types/professional";

type ProfessionalContactsCardProps = {
  professional: Professional;
  isAuthenticated?: boolean;
  initiallyRevealed?: boolean;
};

type ContactsApiResponse = {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  contactLinks?: ContactLink[];
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
  phone: string | null;
  email: string | null;
  website: string | null;
  bookingUrl?: string | null;
  instagramUrl: string | null;
  telegramUrl: string | null;
  contactLinks?: ContactLink[];
}): ContactItem[] {
  const presence = {
    website: input.website,
    instagramUrl: input.instagramUrl,
    telegramUrl: input.telegramUrl,
  };
  const website = resolveWebsiteUrl(presence);
  const booking = input.bookingUrl?.trim() || null;
  const instagram =
    resolveInstagramUrl(presence) ||
    (input.website && isInstagramUrl(input.website)
      ? input.website.startsWith("http")
        ? input.website
        : `https://${input.website}`
      : null);
  const telegram = resolveTelegramUrl(presence);

  const items: ContactItem[] = [];
  if (input.phone?.trim()) {
    items.push({
      key: "phone",
      title: "Телефон",
      href: `tel:${input.phone.trim()}`,
      icon: <Phone aria-hidden="true" className="size-3.5" />,
      label: formatPhoneDisplay(input.phone.trim()),
    });
  }
  if (input.email?.trim()) {
    items.push({
      key: "email",
      title: "Email",
      href: `mailto:${input.email.trim()}`,
      icon: <Mail aria-hidden="true" className="size-3.5" />,
      label: input.email.trim(),
    });
  }
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
  if (telegram) {
    items.push({
      key: "telegram",
      title: "Telegram",
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
  const renderedHrefs = new Set(
    items.map((item) => item.href.toLowerCase()),
  );
  (input.contactLinks ?? []).forEach((link, index) => {
    const channel = getContactChannel(link.channel);
    if (!channel) return;
    const href = contactHref(channel.id, link.value);
    if (!href) return;
    if (renderedHrefs.has(href.toLowerCase())) return;
    renderedHrefs.add(href.toLowerCase());
    items.push({
      key: `${channel.id}-${index}`,
      title: channel.needsLabel
        ? link.label?.trim() || channel.label
        : channel.label,
      href,
      icon: <ContactChannelIcon channel={channel.id} />,
      label: contactDisplayLabel(link),
      external: !href.startsWith("tel:") && !href.startsWith("mailto:"),
    });
  });
  return items;
}

function flagChips(professional: Professional) {
  const flags = professional.presenceFlags;
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
  if (flags.hasBooking) {
    chips.push({
      key: "booking",
      title: "Запись",
      icon: <CalendarCheck aria-hidden="true" className="size-3.5" />,
    });
  }
  if (flags.hasInstagram) {
    chips.push({
      key: "instagram",
      title: "Instagram",
      icon: <InstagramIcon className="size-3.5 text-[#E4405F]" />,
    });
  }
  if (flags.hasEmail) {
    chips.push({
      key: "email",
      title: "Email",
      icon: <Mail aria-hidden="true" className="size-3.5" />,
    });
  }
  const chipped = new Set(chips.map((chip) => chip.key));
  (flags.extraChannels ?? []).forEach((channelId) => {
    const channel = getContactChannel(channelId);
    if (!channel || chipped.has(channel.id)) return;
    chipped.add(channel.id);
    chips.push({
      key: channel.id,
      title: channel.label,
      icon: <ContactChannelIcon channel={channel.id} />,
    });
  });
  return chips;
}

/**
 * Contact group for professional profiles — same interaction model as business
 * (locked chips → reveal → link rows for Telegram / Instagram / phone).
 */
export function ProfessionalContactsCard({
  professional,
  isAuthenticated = false,
  initiallyRevealed = false,
}: ProfessionalContactsCardProps) {
  const hasServerContacts = Boolean(
    professional.phone?.trim() ||
      professional.email?.trim() ||
      professional.website?.trim() ||
      professional.bookingUrl?.trim() ||
      professional.instagramUrl?.trim() ||
      professional.telegramUrl?.trim() ||
      professional.contactLinks.length > 0,
  );

  const [revealed, setRevealed] = useState(
    Boolean(initiallyRevealed && (isAuthenticated || hasServerContacts)),
  );
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<ContactsApiResponse | null>(null);

  const previewChips = flagChips(professional);
  const hasAnyFlag =
    previewChips.length > 0 ||
    professional.presenceFlags.hasPhone ||
    professional.presenceFlags.hasEmail ||
    professional.presenceFlags.hasWebsite ||
    professional.presenceFlags.hasBooking ||
    professional.presenceFlags.hasInstagram ||
    professional.presenceFlags.hasTelegram ||
    (professional.presenceFlags.extraChannels?.length ?? 0) > 0;

  const items = buildItems({
    phone: fetched?.phone ?? professional.phone,
    email: fetched?.email ?? professional.email,
    website: fetched?.website ?? professional.website,
    bookingUrl: professional.bookingUrl,
    instagramUrl: fetched?.instagramUrl ?? professional.instagramUrl,
    telegramUrl: fetched?.telegramUrl ?? professional.telegramUrl,
    contactLinks: fetched?.contactLinks ?? professional.contactLinks,
  });

  const showLocked = !revealed && hasAnyFlag;

  async function loadContacts() {
    if (hasServerContacts) {
      setRevealed(true);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/professional/${encodeURIComponent(professional.slug)}/contacts`,
      );
      if (res.status === 401) {
        setAuthOpen(true);
        return;
      }
      if (!res.ok) throw new Error(`contacts_${res.status}`);
      const data = (await res.json()) as ContactsApiResponse;
      setFetched(data);
      setRevealed(true);
    } catch {
      setLoadError("Не удалось загрузить контакты. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuthenticated || revealed) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#professional-contacts") return;
    void loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, revealed, professional.slug]);

  if (!hasAnyFlag && items.length === 0) return null;

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4"
      id="professional-contacts"
    >
      <h2 className="text-sm font-semibold text-slate-900">Контакты</h2>

      {showLocked ? (
        <>
          <div
            aria-label="Доступные контакты"
            className="mt-3 flex flex-wrap gap-2"
          >
            {previewChips.map((item) => (
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
            onClick={() => {
              if (!isAuthenticated) {
                setAuthOpen(true);
                return;
              }
              void loadContacts();
            }}
          >
            <Eye
              aria-hidden="true"
              className="size-4"
              style={{ color: "#ffffff" }}
            />
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
                className="flex items-center gap-3 rounded-xl px-1 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-blue"
                href={item.href}
                rel={item.external ? "noopener noreferrer" : undefined}
                target={item.external ? "_blank" : undefined}
                title={item.title}
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

      {revealed && items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Контакты пока не указаны</p>
      ) : null}

      <QuickAuthModal
        nextPath={
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search || ""}#professional-contacts`
            : `/professional/${professional.slug}#professional-contacts`
        }
        open={authOpen}
        subtitle="После входа откроются телефон, Telegram и Instagram."
        title="Войдите, чтобы увидеть контакты"
        onClose={() => setAuthOpen(false)}
      />
    </section>
  );
}
