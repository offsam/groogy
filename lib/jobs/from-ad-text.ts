/**
 * Vacancy / hiring ad copy → jobs rows (fill-empty).
 * Used by published enrich finalize.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  firstAdTitleLine,
  isVacancyAdText,
} from "@/lib/admin/ad-block-classifier";
import { ensureTitleBodyRu } from "@/lib/content/translate-copy-to-ru";
import { cleanAdminStreetAddress } from "@/lib/geo/geocode-street";
import { slugifyJobTitle } from "@/lib/jobs/mappers";

export type AdVacancyDraft = {
  title: string;
  description: string;
  addressLine?: string | null;
  city?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationPrecision?: string | null;
};

function titleKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

/** One vacancy draft when the ad is a hiring post; otherwise empty. */
export function vacancyFromAdText(
  text: string | null | undefined,
): AdVacancyDraft[] {
  const raw = String(text || "").trim();
  if (!raw || !isVacancyAdText(raw)) return [];
  const title = firstAdTitleLine(raw, "Вакансия");
  return [
    {
      title: title.slice(0, 200),
      description: raw.slice(0, 4000),
    },
  ];
}

export type JobWorksiteInput = {
  addressLine?: string | null;
  city?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
};

/**
 * Peel + geocode a worksite for a vacancy (not the agency HQ).
 */
export async function resolveJobWorksite(
  input: JobWorksiteInput | null | undefined,
): Promise<{
  addressLine: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: string | null;
}> {
  const street = input?.addressLine?.trim() || null;
  if (!street) {
    return {
      addressLine: null,
      city: input?.city?.trim() || null,
      stateCode: input?.stateCode?.trim() || null,
      postalCode: input?.postalCode?.trim() || null,
      latitude: null,
      longitude: null,
      locationPrecision: null,
    };
  }
  const cleaned = await cleanAdminStreetAddress(
    {
      addressLine: street,
      city: input?.city,
      stateCode: input?.stateCode,
      postalCode: input?.postalCode,
    },
    { withGeo: true },
  );
  return {
    addressLine: cleaned.addressLine?.trim() || street,
    city: cleaned.city?.trim() || input?.city?.trim() || null,
    stateCode: cleaned.stateCode?.trim() || input?.stateCode?.trim() || null,
    postalCode: cleaned.postalCode?.trim() || input?.postalCode?.trim() || null,
    latitude: cleaned.latitude ?? null,
    longitude: cleaned.longitude ?? null,
    locationPrecision: cleaned.locationPrecision ?? null,
  };
}

/**
 * Insert unowned published jobs when this title is not already on file
 * for the same source_url (or same title if no source).
 */
export async function addMissingJobsFromAd(
  client: SupabaseClient,
  drafts: AdVacancyDraft[],
  opts?: {
    sourceUrl?: string | null;
    businessId?: string | null;
    city?: string | null;
    stateCode?: string | null;
    postalCode?: string | null;
    addressLine?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    locationPrecision?: string | null;
    /** When true, geocode drafts that only have street/city/ZIP. */
    geocodeWorksite?: boolean;
  },
): Promise<number> {
  if (!drafts.length) return 0;
  const db = untyped(client);
  const sourceUrl = opts?.sourceUrl?.trim() || null;

  let existingQuery = db.from("jobs").select("id, title, source_url").limit(80);
  if (sourceUrl) {
    existingQuery = existingQuery.eq("source_url", sourceUrl);
  } else if (opts?.businessId) {
    existingQuery = existingQuery.eq("business_id", opts.businessId);
  } else {
    existingQuery = existingQuery.in(
      "title",
      drafts.map((d) => d.title.slice(0, 200)),
    );
  }

  const { data: existing } = await existingQuery;
  const existingKeys = new Set(
    ((existing ?? []) as Array<{ title: string | null }>)
      .map((row) => titleKey(row.title || ""))
      .filter(Boolean),
  );

  let added = 0;
  const now = new Date().toISOString();
  for (const draft of drafts) {
    const localized = await ensureTitleBodyRu({
      title: draft.title,
      body: draft.description,
    });
    const key = titleKey(localized.title);
    if (!key || existingKeys.has(key)) continue;

    let worksite = {
      addressLine: draft.addressLine ?? opts?.addressLine ?? null,
      city: draft.city ?? opts?.city ?? null,
      stateCode: draft.stateCode ?? opts?.stateCode ?? null,
      postalCode: draft.postalCode ?? opts?.postalCode ?? null,
      latitude: draft.latitude ?? opts?.latitude ?? null,
      longitude: draft.longitude ?? opts?.longitude ?? null,
      locationPrecision:
        draft.locationPrecision ?? opts?.locationPrecision ?? null,
    };
    if (
      opts?.geocodeWorksite !== false &&
      worksite.addressLine &&
      (worksite.latitude == null || worksite.longitude == null)
    ) {
      worksite = {
        ...(await resolveJobWorksite(worksite)),
      };
    }

    const { error } = await db.from("jobs").insert({
      owner_profile_id: null,
      created_by_profile_id: null,
      business_id: opts?.businessId ?? null,
      title: localized.title.slice(0, 200),
      slug: slugifyJobTitle(localized.title),
      description: localized.body,
      city: worksite.city,
      state_code: worksite.stateCode,
      postal_code: worksite.postalCode,
      address_line: worksite.addressLine,
      latitude: worksite.latitude,
      longitude: worksite.longitude,
      location_precision: worksite.locationPrecision,
      status: "published",
      visibility: "public",
      source_type: "IMPORT",
      source_url: sourceUrl,
      imported_at: now,
      published_at: now,
    });
    if (error) continue;
    existingKeys.add(key);
    added += 1;
  }
  return added;
}
