import { DIRECTORY_SOURCE_LIST } from "@/lib/import-review/directory-sources";
import { TELEGRAM_SOURCE_LIST } from "@/lib/import-review/telegram-sources";

export type ParseResourceCategoryId = "telegram" | "facebook" | "websites";

/** pipeline = already wired in collect/import. listed = known source, not in allowlist yet. */
export type ParseResourceStatus = "pipeline" | "listed";

export type ParseResource = {
  id: string;
  title: string;
  region: string;
  href: string | null;
  note?: string;
  status: ParseResourceStatus;
};

export type ParseResourceCategory = {
  id: ParseResourceCategoryId;
  title: string;
  description: string;
  items: ParseResource[];
};

const EXTRA_TELEGRAM: ParseResource[] = [
  {
    id: "tg_la_rusrek_chat",
    title: "Чат Los Angeles (RusRek)",
    region: "Los Angeles",
    href: "https://t.me/Chat_Los_Angeles_RusRek",
    status: "listed",
  },
  {
    id: "tg_washington_rusrek",
    title: "Чат Washington (RusRek)",
    region: "Washington DC",
    href: "https://t.me/Chat_Washington_RusRek",
    status: "listed",
  },
  {
    id: "tg_nj_work_rusrek",
    title: "Работа New Jersey (RusRek)",
    region: "New Jersey",
    href: "https://t.me/Work_New_Jersey_RusRek",
    status: "listed",
  },
  {
    id: "tg_cleveland_rusrek",
    title: "Кливленд работа / недвижимость",
    region: "Cleveland",
    href: "https://t.me/cleveland_rusrek",
    status: "listed",
  },
  {
    id: "tg_orlando_rusrek",
    title: "Чат Orlando (RusRek)",
    region: "Orlando",
    href: "https://t.me/Chat_Orlando_RusRek",
    status: "listed",
  },
  {
    id: "tg_tampa_chat",
    title: "Тампа чат (RusRek)",
    region: "Tampa",
    href: "https://t.me/chat_Tampa",
    status: "listed",
  },
  {
    id: "tg_detroit_rent_rusrek",
    title: "Детройт аренда / работа (RusRek)",
    region: "Detroit",
    href: "https://t.me/Rent_Detroit_RusRek",
    status: "listed",
  },
  {
    id: "tg_usachatru",
    title: "Наши в США",
    region: "USA",
    href: "https://t.me/USACHATRU",
    note: "Общенациональный чат",
    status: "listed",
  },
  {
    id: "tg_russian_usa1",
    title: "США чат объявлений",
    region: "USA",
    href: "https://t.me/russian_usa1",
    status: "listed",
  },
  {
    id: "tg_newyorkchatru",
    title: "Наши в Нью-Йорке",
    region: "New York",
    href: "https://t.me/newyorkchatru",
    status: "listed",
  },
  {
    id: "tg_new_york_nyc",
    title: "Нью Йорк чат",
    region: "New York",
    href: "https://t.me/New_YorkNYC",
    status: "listed",
  },
  {
    id: "tg_los_angeles_la",
    title: "Лос Анджелес чат",
    region: "Los Angeles",
    href: "https://t.me/Los_AngelesLa",
    status: "listed",
  },
  {
    id: "tg_chicago_chat_il",
    title: "Чикаго чат",
    region: "Chicago",
    href: "https://t.me/Chicago_ChatIL",
    status: "listed",
  },
  {
    id: "tg_miami_chat_fl",
    title: "Майами чат",
    region: "Miami",
    href: "https://t.me/Miami_ChatFlorida",
    status: "listed",
  },
  {
    id: "tg_nj_in_chat",
    title: "New Jersey Chat",
    region: "New Jersey",
    href: "https://t.me/NewJerseyinChat",
    status: "listed",
  },
  {
    id: "tg_las_vegas_chatik",
    title: "Лас-Вегас чатик",
    region: "Las Vegas",
    href: "https://t.me/LasVegasChatik",
    status: "listed",
  },
  {
    id: "tg_vegas_for_all",
    title: "Vegas for all",
    region: "Las Vegas",
    href: "https://t.me/vegas_for_all_chat",
    status: "listed",
  },
  {
    id: "tg_rusrek_bot",
    title: "RusRek · меню всех городов",
    region: "USA",
    href: "https://t.me/Rusrekbot_bot",
    note: "Каталог чатов RusRek, не лента объявлений",
    status: "listed",
  },
];

function fb(
  slug: string,
  title: string,
  region: string,
  note?: string,
): ParseResource {
  return {
    id: `fb_${slug.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    title,
    region,
    href: `https://www.facebook.com/groups/${slug}`,
    note,
    status: "listed",
  };
}

const FACEBOOK_GROUPS: ParseResource[] = [
  fb("RussianinLosAngeles", "Russians in Los Angeles", "Los Angeles"),
  fb("Russian.Sacramento", "Russian Sacramento", "Sacramento", "~12k"),
  fb("russiansf", "Russians SF", "San Francisco"),
  fb("Dallas.Russian", "Dallas Russian", "Dallas", "~27k, крупнейшая в DFW"),
  fb("RussianDallas", "Russian Dallas", "Dallas"),
  fb("Russians.in.Dallas.TX", "Russians in Dallas TX", "Dallas"),
  fb("RussianHouston", "Russian Houston", "Houston", "~25k"),
  fb("Russians.in.Houston", "Russians in Houston", "Houston"),
  fb("Austin.Russian", "Austin Russian", "Austin", "~11k"),
  fb("Russians.In.Austin", "Russians in Austin", "Austin"),
  fb("Russian.San.Antonio.TX", "Russian San Antonio", "San Antonio", "~6k"),
  fb("Russian.Texas", "Russian Texas", "Texas"),
  fb("Russians.in.Texas", "Russians in Texas", "Texas"),
  fb("Russian.Phoenix.AZ", "Russian Phoenix", "Phoenix"),
  fb("Russian.Arizona.USA", "Russian Arizona", "Arizona"),
  fb("Russian.Denver.CO", "Russian Denver", "Denver"),
  fb("Russians.in.Colorado", "Russians in Colorado", "Colorado"),
  fb("Russian.Miami.FL", "Russian Miami", "Miami"),
  fb("Russian.Tampa.FL", "Russian Tampa", "Tampa"),
  fb("Russian.Chicago.IL.USA", "Russian Chicago", "Chicago"),
  fb("Russian.New.York.NY", "Russian New York", "New York", "~8k"),
  fb("Russians.in.Brooklyn", "Russians in Brooklyn", "New York", "~22k"),
  fb("Russian.Philadelphia.PA", "Russian Philadelphia", "Philadelphia"),
  fb("Russians.in.Pittsburgh", "Russians in Pittsburgh", "Pittsburgh"),
  fb("Russians.in.Detroit", "Russians in Detroit", "Detroit"),
  fb("We.Are.Russian.Atlanta", "We Are Russian Atlanta", "Atlanta"),
  fb("Russian.Dallas.Real.Estate", "Russian Dallas Real Estate", "Dallas"),
  {
    id: "fb_pomogaem",
    title: "Pomogaem.ORG · сеть городских групп",
    region: "USA",
    href: "https://pomogaem.org/facebook/",
    note: "Много городов; отдельные slug на странице не сведены",
    status: "listed",
  },
];

const EVENT_SOURCES: ParseResource[] = [
  {
    id: "ev_loveoverse",
    title: "Loveoverse",
    region: "Los Angeles",
    href: "https://loveoverse.com",
    note: "Афиша LA",
    status: "pipeline",
  },
  {
    id: "ev_eventbrite_sac",
    title: "Eventbrite · Sacramento",
    region: "Sacramento",
    href: "https://www.eventbrite.com/d/ca--sacramento/events/",
    status: "pipeline",
  },
  {
    id: "ev_eventbrite_sf",
    title: "Eventbrite · San Francisco",
    region: "San Francisco",
    href: "https://www.eventbrite.com/d/ca--san-francisco/events/",
    status: "pipeline",
  },
  {
    id: "ev_eventbrite_la",
    title: "Eventbrite · Los Angeles",
    region: "Los Angeles",
    href: "https://www.eventbrite.com/d/ca--los-angeles/events/",
    status: "pipeline",
  },
  {
    id: "ev_eventbrite_sd",
    title: "Eventbrite · San Diego",
    region: "San Diego",
    href: "https://www.eventbrite.com/d/ca--san-diego/events/",
    status: "pipeline",
  },
  {
    id: "ev_eventbrite_oc",
    title: "Eventbrite · Orange County",
    region: "Orange County",
    href: "https://www.eventbrite.com/d/ca--anaheim/events/",
    status: "pipeline",
  },
];

export const PARSE_RESOURCE_STATUS_LABEL: Record<ParseResourceStatus, string> =
  {
    pipeline: "в пайплайне",
    listed: "в списке",
  };

export function getParseResourceCategories(): ParseResourceCategory[] {
  const telegramWired: ParseResource[] = TELEGRAM_SOURCE_LIST.map((s) => ({
    id: s.id,
    title: s.title,
    region: s.regionHint,
    href: s.username ? s.homepage : null,
    note: s.username ? `@${s.username}` : undefined,
    status: "pipeline",
  }));

  const websites: ParseResource[] = [
    ...DIRECTORY_SOURCE_LIST.map((s) => ({
      id: s.id,
      title: s.title,
      region: s.regionHint,
      href: s.homepage,
      status: "pipeline" as const,
    })),
    ...EVENT_SOURCES,
  ];

  return [
    {
      id: "telegram",
      title: "Telegram",
      description: "Группы и чаты",
      items: [...telegramWired, ...EXTRA_TELEGRAM],
    },
    {
      id: "facebook",
      title: "Facebook",
      description: "Группы",
      items: FACEBOOK_GROUPS,
    },
    {
      id: "websites",
      title: "Сайты",
      description: "Каталоги и афиша",
      items: websites,
    },
  ];
}

export function getParseResourceCategory(
  id: string,
): ParseResourceCategory | null {
  return (
    getParseResourceCategories().find((cat) => cat.id === id) ?? null
  );
}
