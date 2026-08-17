export type TelegramSourceId =
  | "tg_sacramento_adaptation"
  | "tg_sacramento_rusrek"
  | "tg_sacramento_rent_rusrek"
  | "tg_sf_rusrek"
  | "tg_sf_general"
  | "tg_sd_rusrek"
  | "tg_sd_general"
  | "tg_fun_for_mom"
  | "tg_la_orange_county"
  | "tg_irvine_friends"
  | "tg_la_rent_rusrek"
  | "tg_russians_in_la"
  | "tg_ny_rusrek_chat"
  | "tg_ny_chat"
  | "tg_ny_rusrek_general"
  | "tg_ny_group"
  | "tg_ny_for_everyone"
  | "tg_ny_svoi"
  | "tg_seattle_rusrek"
  | "tg_miami_rusrek"
  | "tg_miami_ru"
  | "tg_houston_rusrek"
  | "tg_chicago_rusrek"
  | "tg_atlanta_chat"
  | "tg_atlanta_rent_work"
  | "tg_denver_rusrek"
  | "tg_philadelphia_rusrek"
  | "tg_phoenix_rusrek"
  | "tg_boston_rusrek";

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
  tg_sacramento_rent_rusrek: {
    id: "tg_sacramento_rent_rusrek",
    slug: "sacramento-rent-rusrek",
    title: "Аренда Sacramento (RusRek)",
    shortTitle: "Sacramento · аренда",
    description: "Telegram RusRek: аренда и недвижимость Sacramento",
    username: "rent_sacramento_rusrek",
    homepage: "https://t.me/rent_sacramento_rusrek",
    regionHint: "Sacramento",
    prefix: "sacramento_rent_rusrek",
    chatId: -1001822893749,
    groupLabel: "Sacramento_Rent_RusRek",
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
  tg_la_rent_rusrek: {
    id: "tg_la_rent_rusrek",
    slug: "la-rent-rusrek",
    title: "Аренда Los Angeles (RusRek)",
    shortTitle: "LA · аренда",
    description: "Telegram RusRek: работа, аренда и недвижимость Los Angeles",
    username: "rent_los_angeles_rusrek",
    homepage: "https://t.me/rent_los_angeles_rusrek",
    regionHint: "Los Angeles",
    prefix: "la_rent_rusrek",
    chatId: -1001731302416,
    groupLabel: "LA_Rent_RusRek",
  },
  tg_russians_in_la: {
    id: "tg_russians_in_la",
    slug: "russians-in-la",
    title: "Russians in LA",
    shortTitle: "LA · Russians in LA",
    description: "Русскоязычный чат Los Angeles",
    username: "russiansinla",
    homepage: "https://t.me/russiansinla",
    regionHint: "Los Angeles",
    prefix: "russians_in_la",
    chatId: -1001432677353,
    groupLabel: "Russians_in_LA",
  },
  tg_ny_rusrek_chat: {
    id: "tg_ny_rusrek_chat",
    slug: "ny-rusrek-chat",
    title: "Работа / аренда New York (RusRek)",
    shortTitle: "NY · RusRek работа",
    description: "Telegram RusRek: работа, аренда и объявления New York",
    username: "rusrek_chat",
    homepage: "https://t.me/rusrek_chat",
    regionHint: "New York",
    prefix: "ny_rusrek_chat",
    chatId: -1001464240281,
    groupLabel: "NY_RusRek_Chat",
  },
  tg_ny_chat: {
    id: "tg_ny_chat",
    slug: "ny-chat",
    title: "Наши в Нью-Йорке",
    shortTitle: "NY · чат",
    description: "Русскоязычный чат New York: вакансии, аренда, услуги",
    username: "Chat_NewYork",
    homepage: "https://t.me/Chat_NewYork",
    regionHint: "New York",
    prefix: "ny_chat",
    chatId: -1002850187194,
    groupLabel: "NY_Chat",
  },
  tg_ny_rusrek_general: {
    id: "tg_ny_rusrek_general",
    slug: "ny-rusrek-general",
    title: "Общая группа Нью-Йорка (RusRek)",
    shortTitle: "NY · RusRek общая",
    description: "Общий русскоязычный чат New York (RusRek)",
    username: "NewYork_rusrek",
    homepage: "https://t.me/NewYork_rusrek",
    regionHint: "New York",
    prefix: "ny_rusrek_general",
    chatId: -1003825095230,
    groupLabel: "NY_RusRek_General",
  },
  tg_ny_group: {
    id: "tg_ny_group",
    slug: "ny-group",
    title: "Нью Йорк · NY Chat",
    shortTitle: "NY · group",
    description: "Русскоязычный чат New York",
    username: "group_newyork",
    homepage: "https://t.me/group_newyork",
    regionHint: "New York",
    prefix: "ny_group",
    chatId: -1002064800703,
    groupLabel: "NY_Group",
  },
  tg_ny_for_everyone: {
    id: "tg_ny_for_everyone",
    slug: "ny-for-everyone",
    title: "New York для всех",
    shortTitle: "NY · для всех",
    description: "Русскоязычный чат New York",
    username: "newyorkforeveryone",
    homepage: "https://t.me/newyorkforeveryone",
    regionHint: "New York",
    prefix: "ny_for_everyone",
    chatId: -1001430570565,
    groupLabel: "NY_For_Everyone",
  },
  tg_ny_svoi: {
    id: "tg_ny_svoi",
    slug: "ny-svoi",
    title: "Нью-Йорк СВОИ",
    shortTitle: "NY · Свои",
    description: "Русскоязычный чат New York Свои",
    username: "svoiny",
    homepage: "https://t.me/svoiny",
    regionHint: "New York",
    prefix: "ny_svoi",
    chatId: -1001898722612,
    groupLabel: "NY_Svoi",
  },
  tg_seattle_rusrek: {
    id: "tg_seattle_rusrek",
    slug: "seattle-rusrek",
    title: "Работа Seattle (RusRek)",
    shortTitle: "Seattle · RusRek",
    description: "Telegram RusRek: работа и объявления Seattle",
    username: "Chat_Seattle_RusRek",
    homepage: "https://t.me/Chat_Seattle_RusRek",
    regionHint: "Seattle",
    prefix: "seattle_rusrek",
    chatId: -1001868225046,
    groupLabel: "Seattle_RusRek",
  },
  tg_miami_rusrek: {
    id: "tg_miami_rusrek",
    slug: "miami-rusrek",
    title: "Чат Miami (RusRek)",
    shortTitle: "Miami · RusRek",
    description: "Telegram RusRek: Miami",
    username: "Chat_Miami_RusRek",
    homepage: "https://t.me/Chat_Miami_RusRek",
    regionHint: "Miami",
    prefix: "miami_rusrek",
    chatId: -1001611457559,
    groupLabel: "Miami_RusRek",
  },
  tg_miami_ru: {
    id: "tg_miami_ru",
    slug: "miami-ru",
    title: "Russians in Miami",
    shortTitle: "Miami · Russians",
    description: "Русскоязычный чат Miami",
    username: "ru_inmiami",
    homepage: "https://t.me/ru_inmiami",
    regionHint: "Miami",
    prefix: "miami_ru",
    chatId: -1001555481989,
    groupLabel: "Miami_Ru",
  },
  tg_houston_rusrek: {
    id: "tg_houston_rusrek",
    slug: "houston-rusrek",
    title: "Работа Houston (RusRek)",
    shortTitle: "Houston · RusRek",
    description: "Telegram RusRek: работа Houston",
    username: "Chat_Houston_RusRek",
    homepage: "https://t.me/Chat_Houston_RusRek",
    regionHint: "Houston",
    prefix: "houston_rusrek",
    chatId: -1001785045165,
    groupLabel: "Houston_RusRek",
  },
  tg_chicago_rusrek: {
    id: "tg_chicago_rusrek",
    slug: "chicago-rusrek",
    title: "Чат Chicago (RusRek)",
    shortTitle: "Chicago · RusRek",
    description: "Telegram RusRek: Chicago",
    username: "Chat_Chicago_RusRek",
    homepage: "https://t.me/Chat_Chicago_RusRek",
    regionHint: "Chicago",
    prefix: "chicago_rusrek",
    chatId: -1001175902107,
    groupLabel: "Chicago_RusRek",
  },
  tg_atlanta_chat: {
    id: "tg_atlanta_chat",
    slug: "atlanta-chat",
    title: "Атланта · свой чат",
    shortTitle: "Atlanta · чат",
    description: "Русскоязычный чат Atlanta",
    username: "AtlantaChat",
    homepage: "https://t.me/AtlantaChat",
    regionHint: "Atlanta",
    prefix: "atlanta_chat",
    chatId: -1001889280623,
    groupLabel: "Atlanta_Chat",
  },
  tg_atlanta_rent_work: {
    id: "tg_atlanta_rent_work",
    slug: "atlanta-rent-work",
    title: "Аренда / работа Atlanta",
    shortTitle: "Atlanta · аренда",
    description: "Telegram: работа, аренда и недвижимость Atlanta",
    username: "Atlanta_rent_work",
    homepage: "https://t.me/Atlanta_rent_work",
    regionHint: "Atlanta",
    prefix: "atlanta_rent_work",
    chatId: -1001876028760,
    groupLabel: "Atlanta_Rent_Work",
  },
  tg_denver_rusrek: {
    id: "tg_denver_rusrek",
    slug: "denver-rusrek",
    title: "Чат Denver (RusRek)",
    shortTitle: "Denver · RusRek",
    description: "Telegram RusRek: Denver",
    username: "Chat_Denver_RusRek",
    homepage: "https://t.me/Chat_Denver_RusRek",
    regionHint: "Denver",
    prefix: "denver_rusrek",
    chatId: -1001725647772,
    groupLabel: "Denver_RusRek",
  },
  tg_philadelphia_rusrek: {
    id: "tg_philadelphia_rusrek",
    slug: "philadelphia-rusrek",
    title: "Чат Philadelphia (RusRek)",
    shortTitle: "Philadelphia · RusRek",
    description: "Telegram RusRek: Philadelphia",
    username: "Chat_Philadelphia_RusRek",
    homepage: "https://t.me/Chat_Philadelphia_RusRek",
    regionHint: "Philadelphia",
    prefix: "philadelphia_rusrek",
    chatId: -1001600919901,
    groupLabel: "Philadelphia_RusRek",
  },
  tg_phoenix_rusrek: {
    id: "tg_phoenix_rusrek",
    slug: "phoenix-rusrek",
    title: "Работа Phoenix (RusRek)",
    shortTitle: "Phoenix · RusRek",
    description: "Telegram RusRek: работа Phoenix",
    username: "Chat_Phoenix_RusRek",
    homepage: "https://t.me/Chat_Phoenix_RusRek",
    regionHint: "Phoenix",
    prefix: "phoenix_rusrek",
    chatId: -1001832048676,
    groupLabel: "Phoenix_RusRek",
  },
  tg_boston_rusrek: {
    id: "tg_boston_rusrek",
    slug: "boston-rusrek",
    title: "Чат Boston (RusRek)",
    shortTitle: "Boston · RusRek",
    description: "Telegram RusRek: Boston",
    username: "Boston_chat_rusrek",
    homepage: "https://t.me/Boston_chat_rusrek",
    regionHint: "Boston",
    prefix: "boston_rusrek",
    chatId: -1001615012228,
    groupLabel: "Boston_RusRek",
  },
};

/** California groups shown in the primary Telegram admin section. */
export const TELEGRAM_CA_CITY_SOURCE_IDS: TelegramSourceId[] = [
  "tg_sacramento_adaptation",
  "tg_sacramento_rusrek",
  "tg_sacramento_rent_rusrek",
  "tg_sf_rusrek",
  "tg_sf_general",
  "tg_sd_rusrek",
  "tg_sd_general",
  "tg_fun_for_mom",
  "tg_la_orange_county",
  "tg_irvine_friends",
  "tg_la_rent_rusrek",
  "tg_russians_in_la",
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
