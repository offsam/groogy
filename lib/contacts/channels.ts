/**
 * Contact channel registry — one place that knows every channel a card can
 * have: label, how the value is entered, and how it turns into a link.
 *
 * Channels with a dedicated DB column (phone, email, website, instagram,
 * telegram, yelp, google maps, booking) carry `column`. Everything else is
 * stored in the `contact_links` jsonb array, so a new network needs a registry
 * entry, not a migration.
 */

/**
 * The `contact_links` column ships in migration 20260730180000. Until that
 * migration is applied, every query touching the column fails with 42703 and
 * takes the whole business card down — so reads, writes and the editor stay
 * off. Flip to `true` right after applying the migration.
 */
export const CONTACT_LINKS_COLUMN_READY = false;

export type ContactChannelId =
  | "phone"
  | "email"
  | "website"
  | "whatsapp"
  | "telegram"
  | "viber"
  | "signal"
  | "messenger"
  | "wechat"
  | "line"
  | "skype"
  | "discord"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "x"
  | "threads"
  | "linkedin"
  | "snapchat"
  | "pinterest"
  | "reddit"
  | "twitch"
  | "vk"
  | "odnoklassniki"
  | "yelp"
  | "google_maps"
  | "nextdoor"
  | "tripadvisor"
  | "booking"
  | "opentable"
  | "zillow"
  | "etsy"
  | "custom";

export type ContactChannelGroup =
  | "direct"
  | "messengers"
  | "social"
  | "platforms";

/** How the value is typed in and turned into a link. */
export type ContactChannelKind = "phone" | "email" | "url" | "handle";

export type ContactChannel = {
  id: ContactChannelId;
  label: string;
  group: ContactChannelGroup;
  kind: ContactChannelKind;
  /** Dedicated DB column; absent channels live in `contact_links`. */
  column?:
    | "phone"
    | "email"
    | "website"
    | "instagram_url"
    | "telegram_url"
    | "yelp_url"
    | "google_maps_url"
    | "booking_url";
  /** `https://<base><handle>` for handle channels. */
  handleBase?: string;
  /** Hosts that identify this channel in a pasted URL. */
  hosts?: readonly string[];
  placeholder: string;
  /** Free-text title instead of a fixed label. */
  needsLabel?: boolean;
};

export const CONTACT_CHANNEL_GROUP_LABELS: Record<ContactChannelGroup, string> =
  {
    direct: "Прямая связь",
    messengers: "Мессенджеры",
    social: "Соцсети",
    platforms: "Площадки и профили",
  };

export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  {
    id: "phone",
    label: "Телефон",
    group: "direct",
    kind: "phone",
    column: "phone",
    placeholder: "(714) 555-1212",
  },
  {
    id: "email",
    label: "Email",
    group: "direct",
    kind: "email",
    column: "email",
    placeholder: "hello@example.com",
  },
  {
    id: "website",
    label: "Сайт",
    group: "direct",
    kind: "url",
    column: "website",
    placeholder: "example.com",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    group: "messengers",
    kind: "phone",
    hosts: ["wa.me", "api.whatsapp.com", "whatsapp.com"],
    placeholder: "(714) 555-1212",
  },
  {
    id: "telegram",
    label: "Telegram",
    group: "messengers",
    kind: "handle",
    column: "telegram_url",
    handleBase: "t.me/",
    hosts: ["t.me", "telegram.me"],
    placeholder: "@username",
  },
  {
    id: "viber",
    label: "Viber",
    group: "messengers",
    kind: "phone",
    hosts: ["viber.click", "invite.viber.com"],
    placeholder: "(714) 555-1212",
  },
  {
    id: "signal",
    label: "Signal",
    group: "messengers",
    kind: "phone",
    hosts: ["signal.me"],
    placeholder: "(714) 555-1212",
  },
  {
    id: "messenger",
    label: "Facebook Messenger",
    group: "messengers",
    kind: "handle",
    handleBase: "m.me/",
    hosts: ["m.me", "messenger.com"],
    placeholder: "@username",
  },
  {
    id: "wechat",
    label: "WeChat",
    group: "messengers",
    kind: "handle",
    hosts: ["wechat.com"],
    placeholder: "wechat_id",
  },
  {
    id: "line",
    label: "LINE",
    group: "messengers",
    kind: "handle",
    handleBase: "line.me/ti/p/~",
    hosts: ["line.me"],
    placeholder: "@line_id",
  },
  {
    id: "skype",
    label: "Skype",
    group: "messengers",
    kind: "handle",
    hosts: ["join.skype.com", "skype.com"],
    placeholder: "live:username",
  },
  {
    id: "discord",
    label: "Discord",
    group: "messengers",
    kind: "url",
    hosts: ["discord.gg", "discord.com"],
    placeholder: "discord.gg/…",
  },
  {
    id: "instagram",
    label: "Instagram",
    group: "social",
    kind: "handle",
    column: "instagram_url",
    handleBase: "instagram.com/",
    hosts: ["instagram.com"],
    placeholder: "@username",
  },
  {
    id: "facebook",
    label: "Facebook",
    group: "social",
    kind: "url",
    hosts: ["facebook.com", "fb.com", "fb.me"],
    placeholder: "facebook.com/page",
  },
  {
    id: "tiktok",
    label: "TikTok",
    group: "social",
    kind: "handle",
    handleBase: "tiktok.com/@",
    hosts: ["tiktok.com", "vm.tiktok.com"],
    placeholder: "@username",
  },
  {
    id: "youtube",
    label: "YouTube",
    group: "social",
    kind: "url",
    hosts: ["youtube.com", "youtu.be"],
    placeholder: "youtube.com/@channel",
  },
  {
    id: "x",
    label: "X (Twitter)",
    group: "social",
    kind: "handle",
    handleBase: "x.com/",
    hosts: ["x.com", "twitter.com"],
    placeholder: "@username",
  },
  {
    id: "threads",
    label: "Threads",
    group: "social",
    kind: "handle",
    handleBase: "threads.net/@",
    hosts: ["threads.net", "threads.com"],
    placeholder: "@username",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    group: "social",
    kind: "url",
    hosts: ["linkedin.com"],
    placeholder: "linkedin.com/in/…",
  },
  {
    id: "snapchat",
    label: "Snapchat",
    group: "social",
    kind: "handle",
    handleBase: "snapchat.com/add/",
    hosts: ["snapchat.com"],
    placeholder: "@username",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    group: "social",
    kind: "handle",
    handleBase: "pinterest.com/",
    hosts: ["pinterest.com"],
    placeholder: "@username",
  },
  {
    id: "reddit",
    label: "Reddit",
    group: "social",
    kind: "url",
    hosts: ["reddit.com"],
    placeholder: "reddit.com/r/…",
  },
  {
    id: "twitch",
    label: "Twitch",
    group: "social",
    kind: "handle",
    handleBase: "twitch.tv/",
    hosts: ["twitch.tv"],
    placeholder: "@username",
  },
  {
    id: "vk",
    label: "VK",
    group: "social",
    kind: "handle",
    handleBase: "vk.com/",
    hosts: ["vk.com", "vk.ru"],
    placeholder: "@username",
  },
  {
    id: "odnoklassniki",
    label: "Одноклассники",
    group: "social",
    kind: "url",
    hosts: ["ok.ru", "odnoklassniki.ru"],
    placeholder: "ok.ru/profile/…",
  },
  {
    id: "yelp",
    label: "Yelp",
    group: "platforms",
    kind: "url",
    column: "yelp_url",
    hosts: ["yelp.com"],
    placeholder: "yelp.com/biz/…",
  },
  {
    id: "google_maps",
    label: "Google Maps",
    group: "platforms",
    kind: "url",
    column: "google_maps_url",
    hosts: ["google.com", "maps.app.goo.gl", "goo.gl"],
    placeholder: "ссылка на профиль в картах",
  },
  {
    id: "nextdoor",
    label: "Nextdoor",
    group: "platforms",
    kind: "url",
    hosts: ["nextdoor.com"],
    placeholder: "nextdoor.com/pages/…",
  },
  {
    id: "tripadvisor",
    label: "Tripadvisor",
    group: "platforms",
    kind: "url",
    hosts: ["tripadvisor.com"],
    placeholder: "tripadvisor.com/…",
  },
  {
    id: "booking",
    label: "Онлайн-запись",
    group: "platforms",
    kind: "url",
    column: "booking_url",
    hosts: ["calendly.com", "square.site", "booksy.com", "setmore.com"],
    placeholder: "ссылка на запись",
  },
  {
    id: "opentable",
    label: "OpenTable",
    group: "platforms",
    kind: "url",
    hosts: ["opentable.com"],
    placeholder: "opentable.com/r/…",
  },
  {
    id: "zillow",
    label: "Zillow",
    group: "platforms",
    kind: "url",
    hosts: ["zillow.com"],
    placeholder: "zillow.com/profile/…",
  },
  {
    id: "etsy",
    label: "Etsy",
    group: "platforms",
    kind: "url",
    hosts: ["etsy.com"],
    placeholder: "etsy.com/shop/…",
  },
  {
    id: "custom",
    label: "Другая ссылка",
    group: "platforms",
    kind: "url",
    needsLabel: true,
    placeholder: "https://…",
  },
];

const BY_ID = new Map(CONTACT_CHANNELS.map((c) => [c.id, c]));

/** Channels stored in `contact_links` (no dedicated column). */
export const EXTRA_CONTACT_CHANNELS = CONTACT_CHANNELS.filter((c) => !c.column);

export function getContactChannel(
  id: string | null | undefined,
): ContactChannel | null {
  if (!id) return null;
  return BY_ID.get(id as ContactChannelId) ?? null;
}

/** One stored extra channel. */
export type ContactLink = {
  channel: ContactChannelId;
  value: string;
  /** Title for the «custom» channel. */
  label?: string | null;
};

function stripHandle(value: string): string {
  return value.trim().replace(/^@+/, "").replace(/^\/+/, "");
}

function phoneHref(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : null;
}

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function httpUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Clickable link for a stored value, or null when the value is unusable. */
export function contactHref(
  channelId: string,
  rawValue: string | null | undefined,
): string | null {
  const channel = getContactChannel(channelId);
  const value = rawValue?.trim();
  if (!channel || !value) return null;

  switch (channel.id) {
    case "phone":
      return phoneHref(value);
    case "email":
      return value.includes("@") ? `mailto:${value}` : null;
    case "whatsapp": {
      if (/^https?:\/\//i.test(value)) return value;
      const digits = phoneDigits(value);
      return digits.length >= 7 ? `https://wa.me/${digits}` : null;
    }
    case "viber": {
      if (/^https?:\/\//i.test(value)) return value;
      const digits = phoneDigits(value);
      return digits.length >= 7 ? `viber://chat?number=%2B${digits}` : null;
    }
    case "signal": {
      if (/^https?:\/\//i.test(value)) return value;
      const digits = phoneDigits(value);
      return digits.length >= 7 ? `https://signal.me/#p/+${digits}` : null;
    }
    case "wechat":
      return /^https?:\/\//i.test(value)
        ? value
        : `weixin://dl/chat?${stripHandle(value)}`;
    case "skype":
      return /^https?:\/\//i.test(value)
        ? value
        : `skype:${stripHandle(value)}?chat`;
    default:
      break;
  }

  if (/^https?:\/\//i.test(value)) return value;
  if (channel.kind === "handle" && channel.handleBase) {
    if (value.includes("/")) return httpUrl(value);
    return `https://${channel.handleBase}${stripHandle(value)}`;
  }
  return httpUrl(value);
}

/** Short human label under the icon (handle when we can read one). */
export function contactDisplayLabel(link: ContactLink): string {
  const channel = getContactChannel(link.channel);
  if (!channel) return link.value;
  if (channel.needsLabel) {
    return link.label?.trim() || channel.label;
  }
  const value = link.value.trim();
  if (channel.kind === "phone" || channel.kind === "email") return value;
  if (!/^https?:\/\//i.test(value) && !value.includes("/")) {
    return value.startsWith("@") ? value : `@${stripHandle(value)}`;
  }
  return channel.label;
}

/** Guess the channel from a pasted URL — used by enrichment and paste-parsing. */
export function detectContactChannel(
  rawValue: string | null | undefined,
): ContactChannelId | null {
  const value = rawValue?.trim();
  if (!value) return null;
  let host: string;
  try {
    host = new URL(httpUrl(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  for (const channel of CONTACT_CHANNELS) {
    if (
      channel.hosts?.some((h) => host === h || host.endsWith(`.${h}`))
    ) {
      return channel.id;
    }
  }
  return null;
}

/** Parse the raw jsonb column into links with a known channel. */
export function parseContactLinks(raw: unknown): ContactLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ContactLink[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const channel = getContactChannel(
      typeof row.channel === "string" ? row.channel : null,
    );
    const value = typeof row.value === "string" ? row.value.trim() : "";
    if (!channel || !value) continue;
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim().slice(0, 60)
        : null;
    const key = `${channel.id}:${value.toLowerCase()}:${label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ channel: channel.id, value: value.slice(0, 300), label });
  }
  return out;
}

/** Normalize editor output before storing (drops empty and unusable rows). */
export function serializeContactLinks(links: ContactLink[]): ContactLink[] {
  return parseContactLinks(links).filter((link) =>
    Boolean(contactHref(link.channel, link.value)),
  );
}
