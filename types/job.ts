export type JobStatus =
  | "draft"
  | "pending"
  | "published"
  | "archived"
  | "rejected"
  | "expired";

export type Job = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** Source-language text; shown behind «Показать оригинал». */
  descriptionOriginal?: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  status: JobStatus;
  paymentMethods?: string[];
  businessId: string | null;
  businessSlug: string | null;
  businessName: string | null;
  businessImageUrl: string | null;
  businessCity: string | null;
  businessRegion: string | null;
  businessAddressLine: string | null;
  businessLocationPrecision: "street" | "county" | null;
  publishedAt: string | null;
  createdAt: string | null;
};

export type JobRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  description_original?: string | null;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  status: JobStatus;
  payment_methods?: string[] | null;
  business_id: string | null;
  published_at: string | null;
  created_at: string | null;
  businesses?: {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
    city: string | null;
    region: string | null;
    address_line: string | null;
    location_precision: "street" | "county" | null;
  } | null;
};
