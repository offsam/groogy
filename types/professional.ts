export type ProfessionalStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "archived"
  | "deferred";

export type ProfessionalPresenceFlags = {
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  hasInstagram: boolean;
  hasTelegram: boolean;
  hasSource: boolean;
};

export type ProfessionalSourceKind = "telegram" | "facebook" | "platform" | null;

/** Public / list payload — contacts null until contacts API. */
export type Professional = {
  id: string;
  slug: string;
  displayName: string;
  headline: string | null;
  shortDescription: string | null;
  description: string | null;
  /** Listing-card pitch (synthesized / LLM) — prefer over raw post. */
  cardSummary?: string | null;
  imageUrl: string | null;
  status: ProfessionalStatus;
  experienceYears: number | null;
  languages: string[];
  availabilityText: string | null;
  ratingAvg: number;
  reviewsCount: number;
  likesCount: number;
  dislikesCount: number;
  followersCount: number;
  city: string | null;
  region: string | null;
  stateCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  serviceAreaText: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  presenceFlags: ProfessionalPresenceFlags;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagramUrl: string | null;
  telegramUrl: string | null;
  sourceUrl: string | null;
  sourceKind: ProfessionalSourceKind;
  /** List-card preview — filled when batch-loaded with services. */
  serviceCount?: number;
  servicePreviewTitles?: string[];
  /** Community origin — null when not audited / unknown. */
  thirdPartyMentionCount?: number | null;
  selfAdMentionCount?: number | null;
};

export type ProfessionalService = {
  id: string;
  title: string;
  description: string | null;
  priceMode: "fixed" | "from" | "range" | "free" | "contact";
  priceAmount: number | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  priceUnit: string | null;
  sortOrder: number;
};

export type ProfessionalPublicRow = {
  id: string;
  slug: string;
  display_name: string;
  headline: string | null;
  short_description: string | null;
  description: string | null;
  card_summary?: string | null;
  image_url: string | null;
  status: ProfessionalStatus;
  experience_years: number | null;
  languages: string[] | null;
  availability_text: string | null;
  rating_avg: number | string;
  reviews_count: number;
  likes_count?: number;
  dislikes_count?: number;
  followers_count?: number;
  city: string | null;
  region: string | null;
  state_code: string | null;
  postal_code?: string | null;
  latitude: number | null;
  longitude: number | null;
  service_area_text: string | null;
  published_at: string | null;
  created_at: string | null;
  category_id?: string | null;
  category_slug?: string | null;
  category_name?: string | null;
  has_phone: boolean;
  has_email: boolean;
  has_website: boolean;
  has_instagram: boolean;
  has_telegram?: boolean;
  has_source?: boolean;
  source_kind?: ProfessionalSourceKind;
  third_party_mention_count?: number | null;
  self_ad_mention_count?: number | null;
};

export type ProfessionalRow = ProfessionalPublicRow & {
  owner_profile_id: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram_url: string | null;
  telegram_url?: string | null;
  visibility: string;
  source_type?: string | null;
  source_url?: string | null;
};
