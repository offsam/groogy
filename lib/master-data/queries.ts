import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import type {
  CitySearchResult,
  GeographyCounts,
  LanguageOption,
  MasterCategory,
  MasterDataDomain,
  PlatformCountry,
  PlatformCurrency,
  PlatformFeature,
  PlatformLanguage,
  PlatformUnit,
  UsStateOption,
} from "@/types/master-data";

const MASTER_DATA_TAG = "master-data";
const REVALIDATE_SECONDS = 3600;

function createAnonClient(): SupabaseClient<Database> {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapCountry(
  row: Database["public"]["Tables"]["platform_countries"]["Row"],
): PlatformCountry {
  return {
    iso2: row.iso2,
    iso3: row.iso3,
    nameEn: row.name_en,
    nameRu: row.name_ru,
    phoneCode: row.phone_code,
    defaultCurrencyCode: row.default_currency_code,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function mapUsState(
  row: Pick<
    Database["public"]["Tables"]["platform_subdivisions"]["Row"],
    "code" | "abbreviation" | "name_en" | "name_ru" | "slug" | "sort_order"
  >,
): UsStateOption {
  return {
    code: row.code,
    abbreviation: row.abbreviation,
    nameEn: row.name_en,
    nameRu: row.name_ru,
    slug: row.slug,
    sortOrder: row.sort_order,
  };
}

function mapLanguage(
  row: Database["public"]["Tables"]["platform_languages"]["Row"],
): PlatformLanguage {
  return {
    code: row.code,
    nameEn: row.name_en,
    nameNative: row.name_native,
    nameRu: row.name_ru,
    isRtl: row.is_rtl,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    searchAliases: row.search_aliases ?? [],
  };
}

function languageOption(lang: PlatformLanguage): LanguageOption {
  return {
    code: lang.code,
    label: lang.nameRu || lang.nameNative || lang.nameEn,
    nameEn: lang.nameEn,
    nameRu: lang.nameRu,
    nameNative: lang.nameNative,
  };
}

function mapCurrency(
  row: Database["public"]["Tables"]["platform_currencies"]["Row"],
): PlatformCurrency {
  return {
    code: row.code,
    nameEn: row.name_en,
    symbol: row.symbol,
    minorUnits: row.minor_units,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function mapUnit(
  row: Database["public"]["Tables"]["platform_units"]["Row"],
): PlatformUnit {
  return {
    code: row.code,
    category: row.category,
    labelEnSingular: row.label_en_singular,
    labelEnPlural: row.label_en_plural,
    labelRuSingular: row.label_ru_singular,
    labelRuPlural: row.label_ru_plural,
    shortLabel: row.short_label,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function mapFeature(
  row: Database["public"]["Tables"]["platform_features"]["Row"],
): PlatformFeature {
  return {
    id: row.id,
    code: row.code,
    domains: row.domains as MasterDataDomain[],
    nameEn: row.name_en,
    nameRu: row.name_ru,
    description: row.description,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    verificationStatusSupported: row.verification_status_supported,
  };
}

const fetchActiveCountries = unstable_cache(
  async (): Promise<PlatformCountry[]> => {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from("platform_countries")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("name_en");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapCountry);
  },
  ["master-data-countries"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);

const fetchUsStates = unstable_cache(
  async (): Promise<UsStateOption[]> => {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from("platform_us_states_public")
      .select("code, abbreviation, name_en, name_ru, slug, sort_order");
    if (error) {
      const fallback = await supabase
        .from("platform_subdivisions")
        .select(
          "code, abbreviation, name_en, name_ru, slug, sort_order, is_active, is_selectable, country_iso2",
        )
        .eq("country_iso2", "US")
        .eq("is_active", true)
        .eq("is_selectable", true)
        .order("sort_order")
        .order("name_en");
      if (fallback.error) throw new Error(fallback.error.message);
      return (fallback.data ?? []).map(mapUsState);
    }
    return (data ?? []).map(mapUsState);
  },
  ["master-data-us-states"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);

const fetchLanguages = unstable_cache(
  async (): Promise<PlatformLanguage[]> => {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from("platform_languages")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("name_en");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapLanguage);
  },
  ["master-data-languages"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);

const fetchCurrencies = unstable_cache(
  async (): Promise<PlatformCurrency[]> => {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from("platform_currencies")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("code");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapCurrency);
  },
  ["master-data-currencies"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);

const fetchUnits = unstable_cache(
  async (): Promise<PlatformUnit[]> => {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from("platform_units")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("code");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapUnit);
  },
  ["master-data-units"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);

export async function getActiveCountries(): Promise<PlatformCountry[]> {
  try {
    return await fetchActiveCountries();
  } catch {
    return [];
  }
}

export async function getUsStates(): Promise<UsStateOption[]> {
  try {
    return await fetchUsStates();
  } catch {
    return [];
  }
}

export async function getLanguages(): Promise<LanguageOption[]> {
  try {
    const rows = await fetchLanguages();
    return rows.map(languageOption);
  } catch {
    return [];
  }
}

export async function getCurrencies(): Promise<PlatformCurrency[]> {
  try {
    return await fetchCurrencies();
  } catch {
    return [];
  }
}

export async function getUnits(): Promise<PlatformUnit[]> {
  try {
    return await fetchUnits();
  } catch {
    return [];
  }
}

export async function getFeaturesByDomain(
  domain: MasterDataDomain,
): Promise<PlatformFeature[]> {
  const cached = unstable_cache(
    async (): Promise<PlatformFeature[]> => {
      const supabase = createAnonClient();
      const { data, error } = await supabase
        .from("platform_features")
        .select("*")
        .eq("is_active", true)
        .contains("domains", [domain])
        .order("sort_order")
        .order("code");
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapFeature);
    },
    ["master-data-features", domain],
    { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
  );
  try {
    return await cached();
  } catch {
    return [];
  }
}

export async function getCategoriesByDomain(
  domain: MasterDataDomain,
): Promise<MasterCategory[]> {
  const cached = unstable_cache(
    async (): Promise<MasterCategory[]> => {
      const supabase = createAnonClient();

      if (domain === "business") {
        const { data, error } = await supabase
          .from("categories")
          .select("*")
          .eq("is_active", true)
          .order("sort_order")
          .order("name");
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          id: row.id,
          slug: row.slug,
          nameRu: row.name,
          nameEn: row.name_en ?? null,
          parentId: null,
          domain: (row.domain ?? "business") as MasterDataDomain,
          sortOrder: row.sort_order,
          isActive: row.is_active,
          iconKey: row.icon,
          description: row.description ?? null,
          isSelectable: true,
          disclaimerText: row.disclaimer_text ?? null,
          source: "categories" as const,
        }));
      }

      const { data, error } = await supabase
        .from("listing_categories")
        .select("*")
        .eq("domain", domain)
        .eq("is_active", true)
        .order("sort_order")
        .order("name_ru");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id,
        slug: row.slug,
        nameRu: row.name_ru,
        nameEn: row.name_en,
        parentId: row.parent_id,
        domain: row.domain,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        iconKey: row.icon_key,
        description: row.description,
        isSelectable: row.is_selectable,
        disclaimerText: row.disclaimer_text,
        source: "listing_categories" as const,
      }));
    },
    ["master-data-categories", domain],
    { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
  );
  try {
    return await cached();
  } catch {
    return [];
  }
}

export async function searchCities(
  query: string,
  stateCode?: string | null,
): Promise<CitySearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("search_platform_cities", {
    p_query: q,
    p_state_code: stateCode?.trim() || null,
    p_limit: 20,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    geoid: row.geoid,
    stateCode: row.state_code,
    name: row.name,
    nameNormalized: row.name_normalized,
    slug: row.slug,
    latitude: row.latitude,
    longitude: row.longitude,
    population: row.population,
  }));
}

/** Admin / uncached reads (includes inactive rows when RLS allows). */
export async function getAllLanguagesAdmin(
  client: SupabaseClient<Database>,
): Promise<PlatformLanguage[]> {
  const { data, error } = await client
    .from("platform_languages")
    .select("*")
    .order("sort_order")
    .order("name_en");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapLanguage);
}

export async function getAllFeaturesAdmin(
  client: SupabaseClient<Database>,
): Promise<PlatformFeature[]> {
  const { data, error } = await client
    .from("platform_features")
    .select("*")
    .order("sort_order")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapFeature);
}

export async function getListingCategoriesAdmin(
  client: SupabaseClient<Database>,
  domain?: MasterDataDomain,
): Promise<MasterCategory[]> {
  let query = client
    .from("listing_categories")
    .select("*")
    .order("sort_order")
    .order("name_ru");
  if (domain && domain !== "business") {
    query = query.eq("domain", domain);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    nameRu: row.name_ru,
    nameEn: row.name_en,
    parentId: row.parent_id,
    domain: row.domain,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    iconKey: row.icon_key,
    description: row.description,
    isSelectable: row.is_selectable,
    disclaimerText: row.disclaimer_text,
    source: "listing_categories" as const,
  }));
}

export async function getBusinessCategoriesAdmin(
  client: SupabaseClient<Database>,
): Promise<MasterCategory[]> {
  const { data, error } = await client
    .from("categories")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    nameRu: row.name,
    nameEn: row.name_en ?? null,
    parentId: null,
    domain: (row.domain ?? "business") as MasterDataDomain,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    iconKey: row.icon,
    description: row.description ?? null,
    isSelectable: true,
    disclaimerText: row.disclaimer_text ?? null,
    source: "categories" as const,
  }));
}

export async function getGeographyCounts(
  client: SupabaseClient<Database>,
): Promise<GeographyCounts> {
  const [countries, subdivisions, counties, cities] = await Promise.all([
    client.from("platform_countries").select("*", { count: "exact", head: true }),
    client
      .from("platform_subdivisions")
      .select("*", { count: "exact", head: true }),
    client.from("platform_counties").select("*", { count: "exact", head: true }),
    client.from("platform_cities").select("*", { count: "exact", head: true }),
  ]);

  return {
    countries: countries.count ?? 0,
    subdivisions: subdivisions.count ?? 0,
    counties: counties.count ?? 0,
    cities: cities.count ?? 0,
  };
}

export { MASTER_DATA_TAG };
