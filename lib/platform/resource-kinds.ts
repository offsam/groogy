/** Entity kinds that can appear in the home «Популярное» mix. */

export const POPULAR_RESOURCE_KINDS = [
  "business",
  "marketplace",
  "service",
  "lechu",
  "transfer",
] as const;

export type PopularResourceKind = (typeof POPULAR_RESOURCE_KINDS)[number];

export function isPopularResourceKind(value: string): value is PopularResourceKind {
  return (POPULAR_RESOURCE_KINDS as readonly string[]).includes(value);
}

export const POPULAR_RESOURCE_KIND_LABEL: Record<PopularResourceKind, string> = {
  business: "Бизнес",
  marketplace: "Marketplace",
  service: "Услуга",
  lechu: "Лечу",
  transfer: "Перевод",
};

export function pathForPopularResource(
  kind: PopularResourceKind,
  idOrSlug: string,
): string {
  switch (kind) {
    case "business":
      return `/business/${idOrSlug}`;
    case "marketplace":
      return `/marketplace/${idOrSlug}`;
    case "service":
      return `/services/${idOrSlug}`;
    case "lechu":
      return `/lechu/${idOrSlug}`;
    case "transfer":
      return `/transfers/${idOrSlug}`;
  }
}
