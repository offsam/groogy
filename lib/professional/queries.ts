import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import {
  mapProfessionalOwner,
  mapProfessionalPublic,
  mapProfessionalService,
  deriveProfessionalSourceKind,
} from "@/lib/professional/mappers";
import {
  ENTITY_DETAIL_TTL,
  professionalDetailTag,
} from "@/lib/platform/catalog-cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  getRegionHubsByIds,
  isUsaOverviewHub,
  locationFieldsMatchHub,
  parseHubIds,
} from "@/lib/regions/hubs";
import {
  countyGeoidMatchesPlaces,
  parsePlaceTokens,
} from "@/lib/geo/place-tokens";
import { normalizeRouteSlug } from "@/lib/routing/normalize-route-slug";
import type { Database } from "@/types/database";
import type {
  Professional,
  ProfessionalPublicRow,
  ProfessionalRow,
  ProfessionalService,
} from "@/types/professional";

type Client = SupabaseClient<Database>;

/** Untyped access until generated Database types include professionals. */
function db(client: Client) {
  return client as unknown as SupabaseClient;
}

export async function listApprovedProfessionals(
  client: Client,
  options?: {
    limit?: number;
    withServicesPreview?: boolean;
    categorySlug?: string | null;
    /** Hub id(s) — filter by city/region text (no map pin required). */
    hubId?: string | null;
  },
): Promise<Professional[]> {
  const limit = options?.limit ?? 48;
  const overFetch = options?.hubId
    ? Math.min(Math.max(limit * 2, limit), 5000)
    : limit;
  let query = db(client)
    .from("professionals_public")
    .select("*")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(overFetch);

  const categorySlug = options?.categorySlug?.trim();
  if (categorySlug) {
    query = query.eq("category_slug", categorySlug);
  }

  const { data, error } = await query;

  if (error) throw error;
  let professionals = ((data ?? []) as ProfessionalPublicRow[]).map(
    mapProfessionalPublic,
  );

  if (options?.hubId?.trim()) {
    const hubId = options.hubId;
    const hubs = getRegionHubsByIds(parseHubIds(hubId));
    professionals = professionals.filter((p) => {
      const county =
        (p as { countyGeoid?: string | null }).countyGeoid ??
        (p as { county_geoid?: string | null }).county_geoid ??
        null;
      if (county) {
        if (hubs.length === 1 && isUsaOverviewHub(hubs[0])) return true;
        if (hubId.includes("county:") || hubId.includes("city:")) {
          const match = countyGeoidMatchesPlaces(
            county,
            parsePlaceTokens(hubId),
          );
          if (match !== null) return match;
        }
        const allowed = hubs.flatMap((h) => [...h.countyGeoids]);
        if (allowed.length > 0) return allowed.includes(county);
      }
      return hubs.some((hub) =>
        locationFieldsMatchHub(
          {
            city: p.city,
            region: p.region,
            text: p.serviceAreaText,
            countyGeoid: county,
          },
          hub,
        ),
      );
    });
  }

  professionals = professionals.slice(0, limit);

  if (!options?.withServicesPreview || professionals.length === 0) {
    return professionals;
  }

  const ids = professionals.map((p) => p.id);
  const { data: serviceRows, error: serviceError } = await db(client)
    .from("professional_services")
    .select("professional_id, title, sort_order")
    .in("professional_id", ids)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(ids.length * 8);

  if (serviceError || !serviceRows) return professionals;

  const titlesByPro = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const row of serviceRows as Array<{
    professional_id: string;
    title: string;
  }>) {
    counts.set(row.professional_id, (counts.get(row.professional_id) ?? 0) + 1);
    const titles = titlesByPro.get(row.professional_id) ?? [];
    if (titles.length < 2) {
      titles.push(row.title);
      titlesByPro.set(row.professional_id, titles);
    }
  }

  return professionals.map((p) => ({
    ...p,
    serviceCount: counts.get(p.id) ?? 0,
    servicePreviewTitles: titlesByPro.get(p.id) ?? [],
  }));
}

export async function countApprovedProfessionalsByCategory(
  client: Client,
): Promise<Record<string, number>> {
  const { data, error } = await db(client)
    .from("professionals_public")
    .select("category_slug")
    .limit(5000);
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data as Array<{ category_slug: string | null }>) {
    const slug = row.category_slug?.trim();
    if (!slug) {
      counts._uncategorized = (counts._uncategorized ?? 0) + 1;
      continue;
    }
    counts[slug] = (counts[slug] ?? 0) + 1;
  }
  return counts;
}

export async function countApprovedProfessionals(client: Client): Promise<number> {
  const { count, error } = await db(client)
    .from("professionals_public")
    .select("id", { count: "exact", head: true });
  if (!error) return count ?? 0;

  // Fallback if view grants/types lag behind the base table.
  const { count: fallback, error: fallbackError } = await db(client)
    .from("professionals")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved")
    .eq("visibility", "public");
  if (fallbackError) throw error;
  return fallback ?? 0;
}

export async function getProfessionalBySlug(
  client: Client,
  slug: string,
): Promise<Professional | null> {
  const normalized = normalizeRouteSlug(slug);
  const { data, error } = await db(client)
    .from("professionals_public")
    .select("*")
    .eq("slug", normalized)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const publicRow = data as ProfessionalPublicRow;
  let professional = mapProfessionalPublic(publicRow);

  // Always refresh employer company card fields from businesses when linked
  // (city / Google rating) — works even before view migration.
  if (publicRow.employer_business_id) {
    professional = await enrichEmployerFromBusinessId(
      client,
      professional,
      publicRow.employer_business_id,
    );
  }

  // Enrich provenance / telegram presence when the public view is behind
  // (pre-migration) — never leak contact URLs to guests here.
  const needsEnrich =
    publicRow.has_telegram === undefined ||
    publicRow.has_source === undefined ||
    publicRow.source_kind === undefined ||
    (!professional.sourceKind && !professional.presenceFlags.hasSource);

  if (needsEnrich) {
    const { data: src } = await db(client)
      .from("professionals")
      .select("source_type, source_url, telegram_url, instagram_url, website")
      .eq("slug", normalized)
      .maybeSingle();
    if (src) {
      const row = src as {
        source_type?: string | null;
        source_url?: string | null;
        telegram_url?: string | null;
        instagram_url?: string | null;
        website?: string | null;
      };
      const sourceKind =
        professional.sourceKind ??
        deriveProfessionalSourceKind(row.source_type, row.source_url);
      const hasSource =
        professional.presenceFlags.hasSource ||
        sourceKind === "platform" ||
        Boolean(row.source_url?.trim());
      const hasTelegram =
        professional.presenceFlags.hasTelegram ||
        Boolean(row.telegram_url?.trim());
      const hasInstagram =
        professional.presenceFlags.hasInstagram ||
        Boolean(row.instagram_url?.trim()) ||
        Boolean(row.website?.trim() && /instagram\.com/i.test(row.website));
      return {
        ...professional,
        sourceKind,
        presenceFlags: {
          ...professional.presenceFlags,
          hasSource,
          hasTelegram,
          hasInstagram,
        },
      };
    }
  }

  return professional;
}

/**
 * Cached read for the public `/professional/[slug]` route. Own service-role
 * client + slug-only key so generateMetadata and the page body share one
 * Data Cache entry. Owner/admin mutations must call
 * revalidateTag(professionalDetailTag(slug)) for immediate reflection —
 * the 45s TTL is only the fallback.
 */
export function getCachedProfessionalBySlug(
  slug: string,
): Promise<Professional | null> {
  const normalized = normalizeRouteSlug(slug);
  return unstable_cache(
    async () => {
      const catalog = createServiceRoleClient();
      return getProfessionalBySlug(catalog, normalized);
    },
    ["professional-detail-v1", normalized],
    {
      revalidate: ENTITY_DETAIL_TTL,
      tags: [professionalDetailTag(normalized)],
    },
  )();
}

async function enrichEmployerFromBusinessId(
  client: Client,
  professional: Professional,
  employerBusinessId: string | null | undefined,
): Promise<Professional> {
  if (!employerBusinessId) return professional;
  const { data } = await db(client)
    .from("businesses")
    .select(
      "id, slug, name, image_url, status, city, postal_code, state_code, address_line, google_rating, google_reviews_count",
    )
    .eq("id", employerBusinessId)
    .maybeSingle();
  if (!data || (data as { status?: string }).status !== "approved") {
    return professional;
  }
  const row = data as {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
    city: string | null;
    postal_code: string | null;
    state_code: string | null;
    address_line: string | null;
    google_rating: number | null;
    google_reviews_count: number | null;
  };
  return {
    ...professional,
    employerBusinessId: row.id,
    employerBusinessSlug: row.slug,
    employerBusinessName: row.name,
    employerBusinessImageUrl: row.image_url,
    employerBusinessCity: row.city?.trim() || null,
    employerBusinessPostalCode: row.postal_code?.trim() || null,
    employerBusinessStateCode: row.state_code?.trim() || null,
    employerBusinessAddressLine: row.address_line?.trim() || null,
    employerBusinessGoogleRating:
      row.google_rating == null ? null : Number(row.google_rating),
    employerBusinessGoogleReviewsCount:
      row.google_reviews_count == null
        ? null
        : Number(row.google_reviews_count),
  };
}

export async function getOwnedProfessionalBySlug(
  client: Client,
  slug: string,
): Promise<Professional | null> {
  const normalized = normalizeRouteSlug(slug);
  const { data, error } = await db(client)
    .from("professionals")
    .select("*")
    .eq("slug", normalized)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as ProfessionalRow & {
    employer_name?: string | null;
    employer_role?: string | null;
    employer_business_id?: string | null;
  };
  const mapped = mapProfessionalOwner({
    ...row,
    employer_name: row.employer_name,
    employer_role: row.employer_role,
    employer_business_id: row.employer_business_id,
  });
  return enrichEmployerFromBusinessId(
    client,
    mapped,
    row.employer_business_id,
  );
}

export async function getMyProfessional(
  client: Client,
  userId: string,
): Promise<Professional | null> {
  const { data, error } = await db(client)
    .from("professionals")
    .select("*")
    .eq("owner_profile_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as ProfessionalRow & {
    employer_name?: string | null;
    employer_role?: string | null;
    employer_business_id?: string | null;
  };
  const mapped = mapProfessionalOwner({
    ...row,
    employer_name: row.employer_name,
    employer_role: row.employer_role,
    employer_business_id: row.employer_business_id,
  });
  return enrichEmployerFromBusinessId(
    client,
    mapped,
    row.employer_business_id,
  );
}

export async function userOwnsProfessional(
  client: Client,
  professionalId: string,
): Promise<boolean> {
  const { data, error } = await db(client).rpc("owns_professional", {
    p_professional_id: professionalId,
  });
  if (error) return false;
  return Boolean(data);
}

export async function getProfessionalServices(
  client: Client,
  professionalId: string,
): Promise<ProfessionalService[]> {
  const { data, error } = await db(client)
    .from("professional_services")
    .select(
      "id, title, description, price_mode, price_amount, price_min, price_max, currency, price_unit, duration_minutes, sort_order",
    )
    .eq("professional_id", professionalId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) =>
    mapProfessionalService(
      row as Parameters<typeof mapProfessionalService>[0],
    ),
  );
}

export async function canCurrentUserPublish(client: Client): Promise<boolean> {
  const { data, error } = await db(client).rpc("can_publish");
  if (error) return false;
  return Boolean(data);
}
