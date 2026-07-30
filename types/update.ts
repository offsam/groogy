/** Shared profile update (новость) owned by business or professional. */

export type UpdateOwnerType = "business" | "professional";

export type UpdateStatus = "active" | "archived";

export type UpdateSource = "import" | "enrich" | "owner" | "admin";

export type EntityUpdate = {
  id: string;
  ownerType: UpdateOwnerType;
  ownerId: string;
  title: string;
  body: string | null;
  status: UpdateStatus;
  source: UpdateSource;
  sourceUrl: string | null;
  publishedAt: string;
  ownerName: string | null;
  ownerSlug: string | null;
  ownerHref: string | null;
  ownerImageUrl: string | null;
};

/** Shape stored on `import_review_items.updates` jsonb before publish. */
export type QueueUpdate = {
  title: string;
  body?: string | null;
  source_url?: string | null;
};
