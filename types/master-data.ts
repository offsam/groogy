export type MasterDataDomain =
  | "business"
  | "marketplace"
  | "services"
  | "transfers"
  | "lechu";

export type PlatformCountry = {
  iso2: string;
  iso3: string;
  nameEn: string;
  nameRu: string | null;
  phoneCode: string | null;
  defaultCurrencyCode: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type PlatformSubdivision = {
  code: string;
  countryIso2: string;
  fipsCode: string | null;
  abbreviation: string;
  nameEn: string;
  nameRu: string | null;
  slug: string;
  isActive: boolean;
  isSelectable: boolean;
  sortOrder: number;
};

/** Selectable US state/territory for form selects. */
export type UsStateOption = {
  code: string;
  abbreviation: string;
  nameEn: string;
  nameRu: string | null;
  slug: string;
  sortOrder: number;
};

export type CitySearchResult = {
  geoid: string;
  stateCode: string;
  name: string;
  nameNormalized: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
};

export type PlatformLanguage = {
  code: string;
  nameEn: string;
  nameNative: string | null;
  nameRu: string | null;
  isRtl: boolean;
  isActive: boolean;
  sortOrder: number;
  searchAliases: string[];
};

export type LanguageOption = {
  code: string;
  label: string;
  nameEn: string;
  nameRu: string | null;
  nameNative: string | null;
};

export type PlatformCurrency = {
  code: string;
  nameEn: string;
  symbol: string;
  minorUnits: number;
  isActive: boolean;
  sortOrder: number;
};

export type PlatformUnit = {
  code: string;
  category: "count" | "time" | "distance" | "area" | "mass";
  labelEnSingular: string;
  labelEnPlural: string;
  labelRuSingular: string | null;
  labelRuPlural: string | null;
  shortLabel: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type PlatformFeature = {
  id: string;
  code: string;
  domains: MasterDataDomain[];
  nameEn: string;
  nameRu: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  verificationStatusSupported: boolean;
};

export type MasterCategory = {
  id: string;
  slug: string;
  nameRu: string;
  nameEn: string | null;
  parentId: string | null;
  domain: MasterDataDomain;
  sortOrder: number;
  isActive: boolean;
  iconKey: string | null;
  description: string | null;
  isSelectable: boolean;
  disclaimerText: string | null;
  /** `listing_categories` vs legacy `categories` table */
  source: "listing_categories" | "categories";
};

export type GeographyCounts = {
  countries: number;
  subdivisions: number;
  counties: number;
  cities: number;
};
