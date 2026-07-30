import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTITY_DESCRIPTION_ORIGINAL_READY } from "@/lib/content/description-original";
import type { Database } from "@/types/database";
import type {
  Listing,
  ListingCategory,
  ListingDomain,
  ListingSearchParams,
  ListingStatus,
  ListingType,
  OwnedBusinessOption,
  PublicProfileCard,
  ServicesSearchParams,
  TransfersSearchParams,
  LechuSearchParams,
} from "@/types/listing";
import {
  mapCategory,
  mapListing,
  mapListingPublisher,
  mapMedia,
  mapPublicProfile,
  stripListingSource,
} from "@/lib/listings/mappers";
import { LISTING_PAGE_SIZE } from "@/lib/listings/constants";
import { redactOwnerId, signListingMediaUrls } from "@/lib/listings/media";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  getRegionHubsByIds,
  isLatLngInHubBounds,
  isUsaOverviewHub,
  locationTextMatchesHub,
  parseHubIds,
} from "@/lib/regions/hubs";
import {
  countyGeoidMatchesPlaces,
  parsePlaceTokens,
} from "@/lib/geo/place-tokens";

type Client = SupabaseClient<Database>;

function untyped(client: Client) {
  return client as unknown as import("@supabase/supabase-js").SupabaseClient<any>;
}

type ListingRowInput = Parameters<typeof mapListing>[0];

async function getCityGeoidsForHubIds(
  client: Client,
  hubIdParam: string,
): Promise<string[]> {
  // Place tokens (county:/city:) — resolve county geoids directly.
  if (hubIdParam.includes("county:") || hubIdParam.includes("city:")) {
    const {
      countyGeoidsForPlaceTokens,
      parsePlaceTokens,
    } = await import("@/lib/geo/place-tokens");
    const tokens = parsePlaceTokens(hubIdParam);
    let countyGeoids = countyGeoidsForPlaceTokens(tokens);
    // city tokens without countyGeoid on token — look up
    for (const t of tokens) {
      if (t.kind === "city" && !t.countyGeoid) {
        const { data } = await client
          .from("platform_cities")
          .select("primary_county_geoid")
          .eq("geoid", t.geoid)
          .maybeSingle();
        if (data?.primary_county_geoid) {
          countyGeoids = [...countyGeoids, data.primary_county_geoid];
        }
      }
    }
    countyGeoids = [...new Set(countyGeoids)];
    if (countyGeoids.length === 0) return [];
    const { data, error } = await client
      .from("platform_cities")
      .select("geoid")
      .in("primary_county_geoid", countyGeoids)
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map((row) => row.geoid);
  }

  const hubs = getRegionHubsByIds(parseHubIds(hubIdParam));
  const countyGeoids = hubs.flatMap((h) => [...h.countyGeoids]);
  if (countyGeoids.length === 0) return [];
  const { data, error } = await client
    .from("platform_cities")
    .select("geoid")
    .in("primary_county_geoid", countyGeoids)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((row) => row.geoid);
}

function listingInHubs(
  row: {
    city?: string | null;
    city_geoid?: string | null;
    county_geoid?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  },
  hubIdParam: string,
  cityGeoids: Set<string>,
): boolean {
  const hubs = getRegionHubsByIds(parseHubIds(hubIdParam));
  if (row.county_geoid) {
    if (hubs.length === 1 && isUsaOverviewHub(hubs[0])) return true;
    if (hubIdParam.includes("county:") || hubIdParam.includes("city:")) {
      const match = countyGeoidMatchesPlaces(
        row.county_geoid,
        parsePlaceTokens(hubIdParam),
      );
      if (match !== null) return match;
    }
    const allowed = hubs.flatMap((h) => [...h.countyGeoids]);
    if (allowed.length > 0) return allowed.includes(row.county_geoid);
  }
  if (row.city_geoid && cityGeoids.has(row.city_geoid)) return true;
  if (
    typeof row.latitude === "number" &&
    typeof row.longitude === "number" &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude)
  ) {
    return hubs.some((hub) =>
      isLatLngInHubBounds(row.latitude!, row.longitude!, hub),
    );
  }
  const city = (row.city ?? "").trim();
  // No location at all = nationwide offer (same rule as jobs / professionals).
  if (!city) return true;
  return hubs.some((hub) => locationTextMatchesHub(city, hub));
}

/** When hub is set, filter catalog ids by listing location, then paginate. */
async function paginateIdsForHub(
  client: Client,
  orderedIds: string[],
  hubId: string | null | undefined,
  page: number,
  pageSize: number,
  unfilteredCount: number | null,
): Promise<{ pageIds: string[]; total: number }> {
  const from = (page - 1) * pageSize;

  if (!hubId) {
    return {
      pageIds: orderedIds.slice(from, from + pageSize),
      total: unfilteredCount ?? orderedIds.length,
    };
  }

  if (orderedIds.length === 0) {
    return { pageIds: [], total: 0 };
  }

  const cityGeoids = new Set(await getCityGeoidsForHubIds(client, hubId));
  const untyped = client as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        in: (
          col: string,
          vals: string[],
        ) => Promise<{
          data: Array<{
            id: string;
            city?: string | null;
            city_geoid?: string | null;
            county_geoid?: string | null;
            latitude?: number | null;
            longitude?: number | null;
          }> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const { data, error } = await untyped
    .from("listings")
    .select("id, city, city_geoid, county_geoid, latitude, longitude")
    .in("id", orderedIds);
  if (error) throw error;

  const allowed = new Set(
    (data ?? [])
      .filter((row) => listingInHubs(row, hubId, cityGeoids))
      .map((row) => row.id),
  );
  const filtered = orderedIds.filter((id) => allowed.has(id));
  return {
    pageIds: filtered.slice(from, from + pageSize),
    total: filtered.length,
  };
}

async function hydrateCatalogResult(
  client: Client,
  opts: {
    orderedIds: string[];
    count: number | null;
    hubId?: string | null;
    page: number;
    pageSize: number;
    userId: string | null;
  },
): Promise<{ listings: Listing[]; total: number; page: number; pageSize: number }> {
  const hubScoped = Boolean(opts.hubId);
  const { pageIds, total } = await paginateIdsForHub(
    client,
    opts.orderedIds,
    opts.hubId,
    opts.page,
    opts.pageSize,
    hubScoped ? null : opts.count,
  );
  const ids = hubScoped ? pageIds : opts.orderedIds;
  if (ids.length === 0) {
    return {
      listings: [],
      total: hubScoped ? total : (opts.count ?? 0),
      page: opts.page,
      pageSize: opts.pageSize,
    };
  }

  const { data, error } = await untyped(client)
    .from("listings")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nested select blows TS depth
    .select(listingSelectFor(opts.userId) as any)
    .in("id", ids);
  if (error) throw error;

  const byId = new Map(
    ((data ?? []) as unknown as Array<{ id: string }>).map((row) => [
      row.id,
      row as unknown as ListingRowInput,
    ]),
  );
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((row): row is ListingRowInput => Boolean(row));

  const listings = (await hydrateRows(client, ordered, opts.userId)).map(
    stripListingSource,
  );

  return {
    listings,
    total: hubScoped ? total : (opts.count ?? listings.length),
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

const CATEGORY_SELECT = `
  id,
  slug,
  name_ru,
  name_en,
  parent_id,
  listing_type,
  domain,
  sort_order,
  is_active,
  created_at,
  updated_at
` as const;

const LISTING_SELECT = `
  id,
  owner_id,
  listing_type,
  status,
  visibility,
  author_visibility,
  title,
  description,${ENTITY_DESCRIPTION_ORIGINAL_READY ? "\n  description_original," : ""}
  price_amount,
  price_currency,
  is_negotiable,
  city,
  state,
  state_code,
  city_geoid,
  latitude,
  longitude,
  contact_preference,
  publisher_type,
  publisher_business_id,
  payment_methods,
  source_url,
  source_kind,
  published_at,
  reserved_at,
  completed_at,
  paused_at,
  archived_at,
  expires_at,
  favorites_count,
  created_at,
  updated_at,
  marketplace_listing_details (
    listing_id,
    category_id,
    condition,
    transaction_type,
    delivery_available,
    pickup_available,
    quantity,
    listing_categories (
      ${CATEGORY_SELECT}
    )
  ),
  service_listing_details (
    listing_id,
    service_category_id,
    pricing_type,
    price_from,
    price_to,
    price_unit,
    service_modes,
    service_area,
    experience_years,
    languages,
    license_info,
    insurance_status,
    availability_text,
    offers_free_estimate,
    offers_emergency_service,
    created_at,
    updated_at,
    listing_categories (
      ${CATEGORY_SELECT}
    )
  ),
  transfer_listing_details (
    listing_id,
    category_id,
    from_country,
    to_country,
    transfer_method,
    fee_percent,
    fee_fixed_usd,
    min_amount_usd,
    max_amount_usd,
    processing_days,
    created_at,
    updated_at,
    listing_categories (
      ${CATEGORY_SELECT}
    )
  ),
  lechu_listing_details (
    listing_id,
    category_id,
    departure_country,
    destination_country,
    departure_date,
    carry_types,
    max_weight_kg,
    size_limit,
    reward_type,
    created_at,
    updated_at,
    listing_categories (
      ${CATEGORY_SELECT}
    )
  ),
  listing_media (
    id,
    listing_id,
    storage_path,
    media_type,
    sort_order,
    width,
    height,
    created_at
  )
` as const;

const LISTING_SELECT_ADMIN = LISTING_SELECT.replace(
  "expires_at,\n  favorites_count,",
  "expires_at,\n  moderation_reason,\n  favorites_count,",
);

/** Guests have no grant on listings.source_url — reveal goes through the API gate. */
const LISTING_SELECT_PUBLIC = LISTING_SELECT.replace(
  "  source_url,\n",
  "",
) as typeof LISTING_SELECT;

function listingSelectFor(userId: string | null): typeof LISTING_SELECT {
  return userId ? LISTING_SELECT : LISTING_SELECT_PUBLIC;
}

async function attachPublishers(
  client: Client,
  listings: Listing[],
  rows: ListingRowInput[],
): Promise<Listing[]> {
  const publishers = await Promise.all(
    rows.map(async (row) => {
      const { data } = await client.rpc("resolve_listing_publisher", {
        p_publisher_type: row.publisher_type ?? "profile",
        p_publisher_business_id: row.publisher_business_id ?? null,
        p_owner_id: row.owner_id ?? "",
        p_author_visibility: row.author_visibility ?? null,
      });
      return mapListingPublisher((data as Record<string, unknown> | null) ?? null);
    }),
  );

  return listings.map((listing, i) => {
    const publisher = publishers[i] ?? null;
    return {
      ...listing,
      publisher,
      author: publisher?.author ?? listing.author ?? null,
    };
  });
}

async function attachFavoriteFlags(
  client: Client,
  listings: Listing[],
  userId: string | null,
): Promise<Listing[]> {
  if (!userId || listings.length === 0) {
    return listings.map((l) => ({ ...l, favoritedByMe: false }));
  }

  const ids = listings.map((l) => l.id);
  const { data } = await client
    .from("listing_favorites")
    .select("listing_id")
    .eq("user_id", userId)
    .in("listing_id", ids);

  const set = new Set((data ?? []).map((r) => r.listing_id));
  return listings.map((l) => ({ ...l, favoritedByMe: set.has(l.id) }));
}

async function hydrateRows(
  client: Client,
  rows: ListingRowInput[],
  userId: string | null,
  opts: { keepOwner?: boolean; isAdmin?: boolean } = {},
): Promise<Listing[]> {
  const ownerIds = rows.map((r) => r.owner_id);
  const isAdmin = opts.isAdmin ?? false;

  const listings: Listing[] = [];
  for (const row of rows) {
    const mediaRows = (row.listing_media ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({
        id: m.id,
        listingId: m.listing_id,
        storagePath: m.storage_path,
        sortOrder: m.sort_order,
      }));
    const signed = await signListingMediaUrls(client, mediaRows);
    const keep =
      opts.keepOwner ||
      isAdmin ||
      (userId != null && userId === row.owner_id);
    listings.push(
      mapListing(
        row,
        signed.length
          ? signed
          : mediaRows.map((m) =>
              mapMedia(
                {
                  id: m.id,
                  listing_id: m.listingId,
                  storage_path: m.storagePath,
                  media_type: "image",
                  sort_order: m.sortOrder,
                  width: null,
                  height: null,
                  created_at: "",
                },
                null,
              ),
            ),
        null,
        false,
        keep ? (row.owner_id ?? "") : "",
      ),
    );
  }

  let result = await attachPublishers(client, listings, rows);
  result = await attachFavoriteFlags(client, result, userId);
  return result.map((listing, i) => ({
    ...listing,
    ownerId: redactOwnerId(
      { ownerId: ownerIds[i] ?? "" },
      userId,
      isAdmin || Boolean(opts.keepOwner),
    ),
  }));
}

export async function getListingCategories(
  client: Client,
  domain: ListingDomain = "marketplace",
): Promise<ListingCategory[]> {
  const DOMAIN_TO_TYPE: Record<ListingDomain, ListingType> = {
    marketplace: "marketplace_item",
    services: "service",
    transfers: "transfer",
    lechu: "transport_carry",
  };
  const listingType = DOMAIN_TO_TYPE[domain];
  const { data, error } = await client
    .from("listing_categories")
    .select("*")
    .eq("listing_type", listingType)
    .eq("domain", domain)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapCategory);
}

export async function getOwnedBusinessesForPublisher(
  client: Client,
  userId: string,
): Promise<OwnedBusinessOption[]> {
  const { data, error } = await client
    .from("business_owners")
    .select("business_id, businesses ( id, name, slug, status )")
    .eq("user_id", userId);

  if (error) throw error;

  const options: OwnedBusinessOption[] = [];
  for (const row of (data ?? []) as Array<{
    business_id: string;
    businesses:
      | { id: string; name: string; slug: string; status: string }
      | { id: string; name: string; slug: string; status: string }[]
      | null;
  }>) {
    const bizRaw = row.businesses;
    const biz = Array.isArray(bizRaw) ? bizRaw[0] : bizRaw;
    if (!biz || biz.status !== "approved") continue;
    options.push({
      id: biz.id,
      name: biz.name,
      slug: biz.slug,
      status: biz.status,
    });
  }
  return options;
}

export async function searchMarketplaceListings(
  client: Client,
  params: ListingSearchParams = {},
  userId: string | null = null,
): Promise<{ listings: Listing[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? LISTING_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const hubScoped = Boolean(params.hubId);

  let catalog = client
    .from("marketplace_catalog")
    .select("id", { count: "exact" });

  if (params.city?.trim()) {
    catalog = catalog.ilike("city", params.city.trim());
  }
  if (params.minPrice != null) {
    catalog = catalog.gte("price_amount", params.minPrice);
  }
  if (params.maxPrice != null) {
    catalog = catalog.lte("price_amount", params.maxPrice);
  }
  if (params.categorySlug) {
    catalog = catalog.eq("category_slug", params.categorySlug);
  }
  if (params.transactionType) {
    catalog = catalog.eq("transaction_type", params.transactionType);
  }
  if (params.condition) {
    catalog = catalog.eq("condition", params.condition);
  }

  if (params.sort === "price_asc") {
    catalog = catalog
      .order("price_amount", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
  } else if (params.sort === "price_desc") {
    catalog = catalog
      .order("price_amount", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });
  } else {
    catalog = catalog
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  }

  const { data: catalogRows, error: catalogError, count } = hubScoped
    ? await catalog.limit(1000)
    : await catalog.range(from, to);
  if (catalogError) throw catalogError;

  return hydrateCatalogResult(client, {
    orderedIds: (catalogRows ?? []).map((r) => r.id),
    count,
    hubId: params.hubId,
    page,
    pageSize,
    userId,
  });
}

export async function searchServiceListings(
  client: Client,
  params: ServicesSearchParams = {},
  userId: string | null = null,
): Promise<{ listings: Listing[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? LISTING_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const hubScoped = Boolean(params.hubId);

  let catalog = client.from("services_catalog").select("id", { count: "exact" });

  if (params.city?.trim()) {
    catalog = catalog.ilike("city", params.city.trim());
  }
  if (params.categorySlug) {
    catalog = catalog.eq("category_slug", params.categorySlug);
  }
  if (params.pricingType) {
    catalog = catalog.eq("pricing_type", params.pricingType);
  }
  if (params.serviceMode) {
    catalog = catalog.contains("service_modes", [params.serviceMode]);
  }
  if (params.publisherType) {
    catalog = catalog.eq("publisher_type", params.publisherType);
  }
  if (params.freeEstimate) {
    catalog = catalog.eq("offers_free_estimate", true);
  }
  if (params.emergency) {
    catalog = catalog.eq("offers_emergency_service", true);
  }

  if (params.sort === "price_asc") {
    catalog = catalog
      .order("price_from", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
  } else if (params.sort === "price_desc") {
    catalog = catalog
      .order("price_from", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });
  } else {
    catalog = catalog
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  }

  const { data: catalogRows, error: catalogError, count } = hubScoped
    ? await catalog.limit(1000)
    : await catalog.range(from, to);
  if (catalogError) throw catalogError;

  return hydrateCatalogResult(client, {
    orderedIds: (catalogRows ?? []).map((r) => r.id),
    count,
    hubId: params.hubId,
    page,
    pageSize,
    userId,
  });
}

export async function searchTransferListings(
  client: Client,
  params: TransfersSearchParams = {},
  userId: string | null = null,
): Promise<{ listings: Listing[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? LISTING_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const hubScoped = Boolean(params.hubId);

  let catalog = client.from("transfers_catalog").select("id", { count: "exact" });

  if (params.city?.trim()) {
    catalog = catalog.ilike("city", params.city.trim());
  }
  if (params.categorySlug) {
    catalog = catalog.eq("category_slug", params.categorySlug);
  }
  if (params.fromCountry?.trim()) {
    catalog = catalog.ilike("from_country", `%${params.fromCountry.trim()}%`);
  }
  if (params.toCountry?.trim()) {
    catalog = catalog.ilike("to_country", `%${params.toCountry.trim()}%`);
  }
  if (params.transferMethod) {
    catalog = catalog.eq("transfer_method", params.transferMethod);
  }

  if (params.sort === "fee_asc") {
    catalog = catalog
      .order("fee_percent", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
  } else if (params.sort === "fee_desc") {
    catalog = catalog
      .order("fee_percent", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  } else {
    catalog = catalog
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  }

  const { data: catalogRows, error: catalogError, count } = hubScoped
    ? await catalog.limit(1000)
    : await catalog.range(from, to);
  if (catalogError) throw catalogError;

  return hydrateCatalogResult(client, {
    orderedIds: (catalogRows ?? []).map((r) => r.id),
    count,
    hubId: params.hubId,
    page,
    pageSize,
    userId,
  });
}

export async function searchLechuListings(
  client: Client,
  params: LechuSearchParams = {},
  userId: string | null = null,
): Promise<{ listings: Listing[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? LISTING_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const hubScoped = Boolean(params.hubId);

  let catalog = client.from("lechu_catalog").select("id", { count: "exact" });

  if (params.city?.trim()) {
    catalog = catalog.ilike("city", params.city.trim());
  }
  if (params.categorySlug) {
    catalog = catalog.eq("category_slug", params.categorySlug);
  }
  if (params.departureCountry?.trim()) {
    catalog = catalog.ilike(
      "departure_country",
      `%${params.departureCountry.trim()}%`,
    );
  }
  if (params.destinationCountry?.trim()) {
    catalog = catalog.ilike(
      "destination_country",
      `%${params.destinationCountry.trim()}%`,
    );
  }
  if (params.rewardType) {
    catalog = catalog.eq("reward_type", params.rewardType);
  }

  if (params.sort === "date_asc") {
    catalog = catalog
      .order("departure_date", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
  } else if (params.sort === "date_desc") {
    catalog = catalog
      .order("departure_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  } else {
    catalog = catalog
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  }

  const { data: catalogRows, error: catalogError, count } = hubScoped
    ? await catalog.limit(1000)
    : await catalog.range(from, to);
  if (catalogError) throw catalogError;

  return hydrateCatalogResult(client, {
    orderedIds: (catalogRows ?? []).map((r) => r.id),
    count,
    hubId: params.hubId,
    page,
    pageSize,
    userId,
  });
}

export async function getListingById(
  client: Client,
  id: string,
  userId: string | null = null,
): Promise<Listing | null> {
  const { data, error } = await untyped(client)
    .from("listings")
    .select(listingSelectFor(userId) as any)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const isAdmin = userId ? await userIsAdmin(client) : false;
  const [listing] = await hydrateRows(
    client,
    [data as unknown as ListingRowInput],
    userId,
    { isAdmin },
  );
  return listing ?? null;
}

export async function getMyListings(
  client: Client,
  userId: string,
  status?: ListingStatus | null,
  listingType: "marketplace_item" | "service" = "marketplace_item",
): Promise<Listing[]> {
  let query = untyped(client)
    .from("listings")
    .select(LISTING_SELECT as any)
    .eq("owner_id", userId)
    .eq("listing_type", listingType)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return hydrateRows(
    client,
    (data ?? []) as unknown as ListingRowInput[],
    userId,
    { keepOwner: true },
  );
}

export async function getPublicProfileListings(
  client: Client,
  username: string,
): Promise<Listing[]> {
  const { data, error } = await client.rpc("get_public_profile_listings", {
    p_username: username,
  });
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  const { data: full, error: fullError } = await untyped(client)
    .from("listings")
    .select(LISTING_SELECT_PUBLIC as any)
    .in("id", ids);
  if (fullError) throw fullError;

  const byId = new Map(
    ((full ?? []) as unknown as Array<{ id: string }>).map((row) => [
      row.id,
      row as unknown as ListingRowInput,
    ]),
  );
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((row): row is ListingRowInput => Boolean(row));

  return hydrateRows(client, ordered, null);
}

export async function getPublicProfileServiceListings(
  client: Client,
  username: string,
): Promise<Listing[]> {
  const { data, error } = await client.rpc(
    "get_public_profile_service_listings",
    { p_username: username },
  );
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  const { data: full, error: fullError } = await untyped(client)
    .from("listings")
    .select(LISTING_SELECT_PUBLIC as any)
    .in("id", ids);
  if (fullError) throw fullError;

  const byId = new Map(
    ((full ?? []) as unknown as Array<{ id: string }>).map((row) => [
      row.id,
      row as unknown as ListingRowInput,
    ]),
  );
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((row): row is ListingRowInput => Boolean(row));

  return hydrateRows(client, ordered, null);
}

export async function getBusinessPublicServiceListings(
  client: Client,
  businessId: string,
): Promise<Listing[]> {
  const { data, error } = await untyped(client)
    .from("listings")
    .select(LISTING_SELECT_PUBLIC as any)
    .eq("listing_type", "service")
    .eq("publisher_type", "business")
    .eq("publisher_business_id", businessId)
    .eq("status", "active")
    .eq("visibility", "public")
    .order("published_at", { ascending: false })
    .limit(24);

  if (error) throw error;
  return hydrateRows(client, (data ?? []) as unknown as ListingRowInput[], null);
}

export async function getPublicProfileByUsername(
  client: Client,
  username: string,
): Promise<PublicProfileCard | null> {
  const { data, error } = await client.rpc("get_public_profile", {
    p_username: username,
  });
  if (error) throw error;
  if (!data) return null;
  return mapPublicProfile(data as Record<string, unknown>);
}

export type AdminListingRow = Listing & {
  pendingReportsCount: number;
};

export async function getAdminListings(
  client: Client,
  filter: string,
  q: string | null,
  domain: "all" | "marketplace" | "services" = "all",
): Promise<AdminListingRow[]> {
  let query = client
    .from("listings")
    .select(LISTING_SELECT_ADMIN)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (domain === "marketplace") {
    query = query.eq("listing_type", "marketplace_item");
  } else if (domain === "services") {
    query = query.eq("listing_type", "service");
  } else {
    query = query.in("listing_type", ["marketplace_item", "service"]);
  }

  if (filter === "active") query = query.eq("status", "active");
  else if (filter === "removed") query = query.eq("status", "removed");
  else if (filter === "rejected") query = query.eq("status", "rejected");
  else if (filter === "completed") query = query.eq("status", "completed");
  else if (filter === "paused") query = query.eq("status", "paused");
  else if (filter === "reported") {
    const { data: reports } = await client
      .from("listing_reports")
      .select("listing_id")
      .eq("status", "pending");
    const ids = [...new Set((reports ?? []).map((r) => r.listing_id))];
    if (ids.length === 0) return [];
    query = query.in("id", ids);
  }

  if (q?.trim()) {
    query = query.ilike("title", `%${q.trim().replace(/[%_]/g, "\\$&")}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const listings = await hydrateRows(
    client,
    (data ?? []) as unknown as ListingRowInput[],
    null,
    { isAdmin: true, keepOwner: true },
  );

  const listingIds = listings.map((l) => l.id);
  const { data: reports } = await client
    .from("listing_reports")
    .select("listing_id, status")
    .in("listing_id", listingIds)
    .eq("status", "pending");

  const counts = new Map<string, number>();
  for (const r of reports ?? []) {
    counts.set(r.listing_id, (counts.get(r.listing_id) ?? 0) + 1);
  }

  return listings.map((l) => ({
    ...l,
    pendingReportsCount: counts.get(l.id) ?? 0,
  }));
}

export async function getListingReports(client: Client, listingId: string) {
  const { data, error } = await client
    .from("listing_reports")
    .select("*")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** Active public listings for sitemap (capped) via hardened catalog view. */
export async function getSitemapMarketplaceIds(
  client: Client,
  limit = 500,
): Promise<{ id: string; updatedAt: string }[]> {
  const { data, error } = await client
    .from("marketplace_catalog")
    .select("id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, updatedAt: r.updated_at }));
}

export async function getSitemapServiceIds(
  client: Client,
  limit = 500,
): Promise<{ id: string; updatedAt: string }[]> {
  const { data, error } = await client
    .from("services_catalog")
    .select("id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, updatedAt: r.updated_at }));
}
