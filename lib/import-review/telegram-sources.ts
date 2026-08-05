export type TelegramSourceId =
  | "tg_sacramento_adaptation"
  | "tg_sacramento_rusrek"
  | "tg_sf_rusrek"
  | "tg_sf_general"
  | "tg_sd_rusrek"
  | "tg_sd_general"
  | "tg_fun_for_mom"
  | "tg_la_orange_county"
  | "tg_irvine_friends";

export type TelegramSourceMeta = {
  id: TelegramSourceId;
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  /** Public @username without @, if any */
  username: string | null;
  homepage: string;
  regionHint: string;
  /** Collector prefix / data dir key */
  prefix: string;
  /** Telethon chat id (-100…) */
  chatId: number;
  /** Display label stored in source_groups */
  groupLabel: string;
};

export const TELEGRAM_SOURCES: Record<TelegramSourceId, TelegramSourceMeta> = {
  tg_sacramento_adaptation: {
    id: "tg_sacramento_adaptation",
    slug: "sacramento-adaptation",
    title: "Адаптация в Сакраменто",
    shortTitle: "Sacramento · адаптация",
    description:
      "Telegram: работа, услуги, рекомендации русскоязычных в Sacramento",
    username: "adaptationinsacramento",
    homepage: "https://t.me/adaptationinsacramento",
    regionHint: "Sacramento",
    prefix: "sacramento_adaptation",
    chatId: -1001733592780,
    groupLabel: "Sacramento_Adaptation",
  },
  tg_sacramento_rusrek: {
    id: "tg_sacramento_rusrek",
    slug: "sacramento-rusrek",
    title: "Работа Sacramento (RusRek)",
    shortTitle: "Sacramento · RusRek",
    description: "Telegram-доска объявлений RusRek: работа и услуги Sacramento",
    username: "Chat_Sacramento_RusRek",
    homepage: "https://t.me/Chat_Sacramento_RusRek",
    regionHint: "Sacramento",
    prefix: "sacramento_rusrek",
    chatId: -1001677357732,
    groupLabel: "Sacramento_RusRek",
  },
  tg_sf_rusrek: {
    id: "tg_sf_rusrek",
    slug: "sf-rusrek",
    title: "Работа San Francisco (RusRek)",
    shortTitle: "SF · RusRek",
    description: "Telegram-доска объявлений RusRek: работа и услуги SF Bay Area",
    username: "chat_rusrek_sanfrancisco",
    homepage: "https://t.me/chat_rusrek_sanfrancisco",
    regionHint: "San Francisco",
    prefix: "sf_rusrek",
    chatId: -1001573930932,
    groupLabel: "SF_RusRek",
  },
  tg_sf_general: {
    id: "tg_sf_general",
    slug: "sf-general",
    title: "Сан-Франциско чат",
    shortTitle: "SF · чат",
    description: "Общий русскоязычный чат Сан-Франциско",
    username: "San_FranciscoChat",
    homepage: "https://t.me/San_FranciscoChat",
    regionHint: "San Francisco",
    prefix: "sf_general",
    chatId: -1001252383425,
    groupLabel: "SF_General",
  },
  tg_sd_rusrek: {
    id: "tg_sd_rusrek",
    slug: "sd-rusrek",
    title: "Работа San Diego (RusRek)",
    shortTitle: "SD · RusRek",
    description: "Telegram-доска объявлений RusRek: работа и услуги San Diego",
    username: "chat_rusrek_sandiego",
    homepage: "https://t.me/chat_rusrek_sandiego",
    regionHint: "San Diego",
    prefix: "sd_rusrek",
    chatId: -1001877641731,
    groupLabel: "SD_RusRek",
  },
  tg_sd_general: {
    id: "tg_sd_general",
    slug: "sd-general",
    title: "Сан-Диего чат",
    shortTitle: "SD · чат",
    description: "Общий русскоязычный чат Сан-Диего",
    username: "sandiegov",
    homepage: "https://t.me/sandiegov",
    regionHint: "San Diego",
    prefix: "sd_general",
    chatId: -1001261966562,
    groupLabel: "SD_General",
  },
  tg_fun_for_mom: {
    id: "tg_fun_for_mom",
    slug: "fun-for-mom",
    title: "Fun for Mom",
    shortTitle: "Fun for Mom",
    description: "Рекомендации мастеров и услуг (Orange County)",
    username: null,
    homepage: "https://t.me/",
    regionHint: "Orange County",
    prefix: "fun_for_mom",
    chatId: -1001333533747,
    groupLabel: "Fun for Mom",
  },
  tg_la_orange_county: {
    id: "tg_la_orange_county",
    slug: "la-orange-county",
    title: "LA / Orange County",
    shortTitle: "LA / OC",
    description: "Русскоязычный чат LA и Orange County",
    username: "LA_OrangeCounty",
    homepage: "https://t.me/LA_OrangeCounty",
    regionHint: "Los Angeles / OC",
    prefix: "la_orange_county",
    chatId: -1001955320601,
    groupLabel: "LA_OrangeCounty",
  },
  tg_irvine_friends: {
    id: "tg_irvine_friends",
    slug: "irvine-friends",
    title: "Ирвайн Друзья",
    shortTitle: "OC · Irvine Friends",
    description:
      "Русскоязычный чат Irvine / Orange County: услуги, рекомендации, объявления",
    username: "irvinefriends",
    homepage: "https://t.me/irvinefriends",
    regionHint: "Orange County",
    prefix: "irvine_friends",
    chatId: -1001880131921,
    groupLabel: "Irvine_Friends",
  },
};

/** New CA city groups to collect now (excludes legacy Fun for Mom / LA). */
export const TELEGRAM_CA_CITY_SOURCE_IDS: TelegramSourceId[] = [
  "tg_sacramento_adaptation",
  "tg_sacramento_rusrek",
  "tg_sf_rusrek",
  "tg_sf_general",
  "tg_sd_rusrek",
  "tg_sd_general",
  "tg_irvine_friends",
];

export const TELEGRAM_SOURCE_LIST = Object.values(TELEGRAM_SOURCES);

export function telegramSourceBySlug(
  slug: string,
): TelegramSourceMeta | null {
  return TELEGRAM_SOURCE_LIST.find((s) => s.slug === slug) ?? null;
}

export function telegramSourceByGroupLabel(
  label: string,
): TelegramSourceMeta | null {
  return TELEGRAM_SOURCE_LIST.find((s) => s.groupLabel === label) ?? null;
}

export function telegramSourceHref(slug: string, status?: string) {
  const base = `/admin/telegram-groups/${slug}`;
  if (!status || status === "pending") return base;
  return `${base}?status=${encodeURIComponent(status)}`;
}
