/** Shared promotion (акция) card owned by any public entity. */

export type PromotionOwnerType =
  | "business"
  | "professional"
  | "listing"
  | "event"
  | "job"
  | "service"
  | "transfer";

export type PromotionStatus = "draft" | "active" | "archived" | "expired";

export type EntityPromotion = {
  id: string;
  ownerType: PromotionOwnerType;
  ownerId: string;
  title: string;
  body: string | null;
  discountLabel: string | null;
  discountPercent: number | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  status: PromotionStatus;
  validFrom: string | null;
  validUntil: string | null;
  sortOrder: number;
  ownerName: string | null;
  ownerSlug: string | null;
  ownerHref: string | null;
  ownerImageUrl: string | null;
};

/** Shape stored on `import_review_items.promotions` jsonb before publish. */
export type QueuePromotion = {
  title: string;
  body?: string | null;
  discount_label?: string | null;
  discount_percent?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
};
