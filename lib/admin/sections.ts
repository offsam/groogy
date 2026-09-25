export type AdminSectionLink = {
  href: string;
  label: string;
  description: string;
};

export type AdminSectionId =
  | "cards"
  | "catalog"
  | "people"
  | "activity"
  | "system";

export type AdminSection = {
  id: AdminSectionId;
  href: string;
  label: string;
  description: string;
  searchPlaceholder: string;
  links: AdminSectionLink[];
};

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "cards",
    href: "/admin/cards",
    label: "Карточки",
    description: "Очередь, источники, верификация и обогащение.",
    searchPlaceholder: "Название бизнеса, город или slug",
    links: [
      {
        href: "/admin/review/inbox",
        label: "Вся лента",
        description: "Все карточки на разборе",
      },
      {
        href: "/admin/review/inbox?view=lane_ready",
        label: "Готово",
        description: "Можно публиковать",
      },
      {
        href: "/admin/review/inbox?view=lane_attach",
        label: "Прикрепить",
        description: "К уже живым карточкам",
      },
      {
        href: "/admin/review/inbox?view=lane_quarantine",
        label: "Помойка",
        description: "Карантин",
      },
      {
        href: "/admin/review/inbox?view=telegram&source=telegram",
        label: "Telegram",
        description: "Очередь из Telegram",
      },
      {
        href: "/admin/review/inbox?view=facebook&source=facebook",
        label: "Facebook",
        description: "Очередь из Facebook",
      },
      {
        href: "/admin/review/inbox?view=directories&source=directories",
        label: "Справочники",
        description: "Yellow Pages и другие",
      },
      {
        href: "/admin/review/inbox?view=loveoverse&source=loveoverse",
        label: "Loveoverse",
        description: "Афиша событий",
      },
      {
        href: "/admin/review/wrong-section",
        label: "Не тот раздел",
        description: "Опубликовано не туда",
      },
      {
        href: "/admin/review/business-to-professional",
        label: "Бизнесы → специалисты",
        description: "Карточки на перенос",
      },
      {
        href: "/admin/claims",
        label: "Верификация",
        description: "Кто просит владение карточкой",
      },
      {
        href: "/admin/to4ka-enrich",
        label: "Обогащение to4ka",
        description: "Массовый прогон",
      },
    ],
  },
  {
    id: "catalog",
    href: "/admin/catalog",
    label: "Каталог",
    description: "Уже опубликованные карточки.",
    searchPlaceholder: "Бизнес, специалист, событие, вакансия, церковь",
    links: [
      {
        href: "/admin/catalog/businesses",
        label: "Бизнесы",
        description: "Штат, округ, категория",
      },
      {
        href: "/admin/catalog/professionals",
        label: "Специалисты",
        description: "Опубликованные профили",
      },
      {
        href: "/admin/catalog/marketplace",
        label: "Объявления",
        description: "Marketplace",
      },
      {
        href: "/admin/catalog/jobs",
        label: "Вакансии",
        description: "Работа",
      },
      {
        href: "/admin/catalog/events",
        label: "События",
        description: "Афиша",
      },
      {
        href: "/admin/catalog/churches",
        label: "Церкви",
        description: "Приходы",
      },
    ],
  },
  {
    id: "people",
    href: "/admin/people",
    label: "Люди",
    description: "Пользователи, админы, отзывы.",
    searchPlaceholder: "Имя, @ник или почта",
    links: [
      {
        href: "/admin/users",
        label: "Все пользователи",
        description: "Роли и кураторы купонов",
      },
      {
        href: "/admin/blogger-directory",
        label: "Блогеры",
        description: "Картотека",
      },
      {
        href: "/admin/community/reviews",
        label: "Отзывы",
        description: "Модерация",
      },
      {
        href: "/admin/community/reviews?filter=reported",
        label: "Жалобы",
        description: "Отзывы с жалобами",
      },
    ],
  },
  {
    id: "activity",
    href: "/admin/activity",
    label: "Активность",
    description: "Кто куда зашёл и что нажал.",
    searchPlaceholder: "Имя, страница или текст кнопки",
    links: [
      {
        href: "/admin/analytics",
        label: "Журнал",
        description: "Заходы, поиск, нажатия, контакты",
      },
      {
        href: "/admin/contact-reveals",
        label: "Открытия контактов",
        description: "По карточкам",
      },
    ],
  },
  {
    id: "system",
    href: "/admin/system",
    label: "Служебное",
    description: "Источники, категории, ошибки и проверка.",
    searchPlaceholder: "Категория, текст ошибки или источник",
    links: [
      {
        href: "/admin/sources",
        label: "Источники",
        description: "Telegram, Facebook, сайты",
      },
      {
        href: "/admin/system/taxonomy",
        label: "Категории",
        description: "Таксономия",
      },
      {
        href: "/admin/system/error-reports",
        label: "Ошибки",
        description: "Сообщения с сайта",
      },
      {
        href: "/admin/system/health",
        label: "Проверка системы",
        description: "Каталог и кэш",
      },
    ],
  },
];

export function getAdminSection(id: AdminSectionId): AdminSection {
  const section = ADMIN_SECTIONS.find((item) => item.id === id);
  if (!section) throw new Error(`Unknown admin section ${id}`);
  return section;
}
