export const ADMIN_CAPABILITIES = [
  {
    id: "cards",
    label: "Карточки",
    hint: "Очередь, верификация, обогащение",
  },
  {
    id: "catalog",
    label: "Каталог",
    hint: "Правка опубликованных карточек",
  },
  {
    id: "people",
    label: "Люди",
    hint: "Пользователи, роли, отзывы",
  },
  {
    id: "activity",
    label: "Активность",
    hint: "Журнал и контакты",
  },
  {
    id: "system",
    label: "Служебное",
    hint: "Источники, категории, ошибки",
  },
] as const;

export type AdminCapabilityId = (typeof ADMIN_CAPABILITIES)[number]["id"];

export const ALL_ADMIN_CAPABILITIES: AdminCapabilityId[] = ADMIN_CAPABILITIES.map(
  (item) => item.id,
);

export function isAdminCapabilityId(value: string): value is AdminCapabilityId {
  return ALL_ADMIN_CAPABILITIES.includes(value as AdminCapabilityId);
}
