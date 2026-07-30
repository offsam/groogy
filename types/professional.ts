export type ProfessionalStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "archived"
  | "deferred";

import type { ContactChannelId, ContactLink } from "@/lib/contacts/channels";

export type ProfessionalPresenceFlags = {
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  hasInstagram: boolean;
  hasTelegram: boolean;
  hasSource: boolean;
  hasBooking?: boolean;
  /** Channels stored in `contact_links`. */
  extraChannels?: ContactChannelId[];
};

export type ProfessionalSourceKind =
  | "telegram"
  | "facebook"
  | "platform"
  | "directory"
  | null;

/** Public / list payload — contacts null until contacts API. */
export type Professional = {
  id: string;
  slug: string;
  displayName: string;
  headline: string | null;
  shortDescription: string | null;
  description: string | null;
  /** Source-language about text; shown behind «Показать оригинал». */
  descriptionOriginal?: string | null;
  /** Listing-card pitch (synthesized / LLM) — prefer over raw post. */
  cardSummary?: string | null;
  imageUrl: string | null;
  status: ProfessionalStatus;
  experienceYears: number | null;
  languages: string[];
  availabilityText: string | null;
  ratingAvg: number;
  reviewsCount: number;
  city: string | null;
  region: string | null;
  stateCode: string | null;
  postalCode: string | null;
  /** Workplace / clinic street — shown publicly when set (directory imports). */
  addressLine?: string | null;
  latitude: number | null;
  longitude: number | null;
  /** street → exact pin; city / county / approx → area map only. */
  locationPrecision?: "street" | "city" | "county" | "approx" | null;
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
  /** Public Book / Записаться CTA (GlossGenius, Calendly, …). */
  bookingUrl?: string | null;
  /** Accepted payment methods discovered from public copy/resources. */
  paymentMethods?: string[];
  instagramUrl: string | null;
  telegramUrl: string | null;
  /** Channels without a dedicated column — gated like other contacts. */
  contactLinks: ContactLink[];
  sourceUrl: string | null;
  sourceKind: ProfessionalSourceKind;
  /** Company they work at (not necessarily own). */
  employerName?: string | null;
  employerRole?: string | null;
  employerBusinessId?: string | null;
  employerBusinessSlug?: string | null;
  employerBusinessName?: string | null;
  employerBusinessImageUrl?: string | null;
  employerBusinessCity?: string | null;
  employerBusinessPostalCode?: string | null;
  employerBusinessStateCode?: string | null;
  employerBusinessAddressLine?: string | null;
  employerBusinessGoogleRating?: number | null;
  employerBusinessGoogleReviewsCount?: number | null;
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
  /** Typical appointment length in minutes, when known from booking site. */
  durationMinutes: number | null;
  sortOrder: number;
};

export type ProfessionalPublicRow = {
  id: string;
  slug: string;
  display_name: string;
  headline: string | null;
  short_description: string | null;
  description: string | null;
  description_original?: string | null;
  card_summary?: string | null;
  image_url: string | null;
  status: ProfessionalStatus;
  experience_years: number | null;
  languages: string[] | null;
  availability_text: string | null;
  rating_avg: number | string;
  reviews_count: number;
  city: string | null;
  region: string | null;
  state_code: string | null;
  postal_code?: string | null;
  /** Public workplace street when exposed via professionals_public.address_line. */
  address_line?: string | null;
  latitude: number | null;
  longitude: number | null;
  location_precision?: "street" | "city" | "county" | "approx" | null;
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
  has_booking?: boolean;
  booking_url?: string | null;
  contact_links?: unknown;
  payment_methods?: string[] | null;
  source_kind?: ProfessionalSourceKind;
  employer_name?: string | null;
  employer_role?: string | null;
  employer_business_id?: string | null;
  employer_business_slug?: string | null;
  employer_business_name?: string | null;
  employer_business_image_url?: string | null;
  employer_business_city?: string | null;
  employer_business_postal_code?: string | null;
  employer_business_state_code?: string | null;
  employer_business_address_line?: string | null;
  employer_business_google_rating?: number | null;
  employer_business_google_reviews_count?: number | null;
  third_party_mention_count?: number | null;
  self_ad_mention_count?: number | null;
};

export type ProfessionalRow = ProfessionalPublicRow & {
  owner_profile_id: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  booking_url?: string | null;
  instagram_url: string | null;
  telegram_url?: string | null;
  visibility: string;
  source_type?: string | null;
  source_url?: string | null;
  private_address_line?: string | null;
};
