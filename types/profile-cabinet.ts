export type ProfileSkillFrame = {
  id: string;
  userId: string;
  title: string;
  skills: string;
  workplace: string | null;
  specialty: string | null;
  showPublic: boolean;
  isActive: boolean;
  listingId: string | null;
  listingStatus: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type UserSearchHistoryFrame = {
  id: string;
  query: string;
  queryNormalized: string;
  hitCount: number;
  lastSearchedAt: string;
};

export const CABINET_NAV_ITEMS = [
  { key: "profile", label: "Мой Профиль", href: null as string | null },
  { key: "circles", label: "Мои круги", href: "/me/circles" },
  { key: "surroundings", label: "Окружение", href: "/me/surroundings" },
  { key: "searches", label: "Поиски", href: "/me/searches" },
  { key: "requests", label: "Заявки", href: "/me/requests" },
  { key: "messenger", label: "Мессенджер", href: "/me/messenger" },
  { key: "events", label: "События", href: "/me/events" },
  { key: "dating", label: "Знакомства", href: "/me/dating" },
  { key: "games", label: "Игры", href: "/me/games" },
  { key: "settings", label: "Настройки", href: "/me/settings" },
] as const;

export type CabinetNavKey = (typeof CABINET_NAV_ITEMS)[number]["key"];
