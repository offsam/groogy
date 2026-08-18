import type { OpeningHours } from "@/lib/business/opening-hours";
import type { ContactChannelId, ContactLink } from "@/lib/contacts/channels";

export type ChurchStatus = "draft" | "approved" | "archived";

export type ChurchSourceKind =
  | "telegram"
  | "facebook"
  | "directory"
  | "platform"
  | null;

export type ChurchMinistry = {
  title: string;
  detail?: string | null;
  url?: string | null;
};

export type ChurchPresenceFlags = {
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  hasInstagram: boolean;
  hasTelegram: boolean;
  hasSource: boolean;
  extraChannels?: ContactChannelId[];
};

/** Public / list payload — contacts null until contacts API. */
export type Church = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  descriptionOriginal?: string | null;
  imageUrl: string | null;
  /** Extra public photos besides imageUrl. */
  galleryUrls?: string[];
  status: ChurchStatus;
  addressLine: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  region: string | null;
  countyGeoid?: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision?: "street" | "city" | "county" | "approx" | null;
  googleMapsUrl?: string | null;
  openingHours?: OpeningHours | null;
  scheduleText?: string | null;
  ministries?: ChurchMinistry[];
  publishedAt: string | null;
  createdAt: string | null;
  presenceFlags: ChurchPresenceFlags;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagramUrl: string | null;
  telegramUrl: string | null;
  contactLinks: ContactLink[];
  sourceUrl: string | null;
  sourceKind: ChurchSourceKind;
};

export type ChurchPublicRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  description_original?: string | null;
  image_url: string | null;
  gallery_urls?: string[] | null;
  status: ChurchStatus;
  address_line: string | null;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  region: string | null;
  county_geoid?: string | null;
  latitude: number | null;
  longitude: number | null;
  location_precision?: "street" | "city" | "county" | "approx" | null;
  google_maps_url?: string | null;
  opening_hours?: OpeningHours | null;
  schedule_text?: string | null;
  ministries?: unknown;
  source_kind?: ChurchSourceKind;
  published_at: string | null;
  created_at: string | null;
  has_phone?: boolean;
  has_email?: boolean;
  has_website?: boolean;
  has_instagram?: boolean;
  has_telegram?: boolean;
  has_source?: boolean;
};

/** Admin / owner row — includes gated columns. */
export type ChurchRow = ChurchPublicRow & {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  instagram_url?: string | null;
  telegram_url?: string | null;
  contact_links?: unknown;
  source_url?: string | null;
  archived_at?: string | null;
  updated_at?: string | null;
};
