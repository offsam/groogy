"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { businessDetailTag } from "@/lib/platform/catalog-cache";
import type { OpeningHours } from "@/lib/business/opening-hours";
import {
  normalizeStructuredAddress,
  validateStructuredAddress,
} from "@/lib/address/normalize";
import {
  CONTACT_LINKS_COLUMN_READY,
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";
import { normalizeTelegramInput, isYelpUrl, normalizeYelpBizUrl } from "@/lib/business/presence";
import { resolveStreetGeoFields } from "@/lib/geo/geocode-street";
import { userIsAdmin, userOwnsBusiness } from "@/lib/reviews/queries";

export type OwnerActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

function fail(message: string): OwnerActionResult {
  return { ok: false, message };
}

function ok(message?: string): OwnerActionResult {
  return { ok: true, message };
}

async function requireBusinessEditor(businessId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  const [owns, isAdmin] = await Promise.all([
    userOwnsBusiness(supabase, businessId),
    userIsAdmin(supabase).catch(() => false),
  ]);
  if (!owns && !isAdmin) {
    return { supabase, user, error: fail("Нет прав на редактирование.") };
  }
  return { supabase, user, error: null as null };
}

function emptyToNull(value: string | null | undefined): string | null {
  const t = value?.trim() ?? "";
  return t ? t : null;
}

export async function patchBusinessProfileAction(input: {
  businessId: string;
  businessSlug: string;
  patch: {
    name?: string;
    shortDescription?: string | null;
    description?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    instagramUrl?: string | null;
    telegramUrl?: string | null;
    yelpUrl?: string | null;
    googleMapsUrl?: string | null;
    contactLinks?: ContactLink[];
    imageUrl?: string | null;
    addressLine?: string | null;
    city?: string | null;
    region?: string | null;
    stateCode?: string | null;
    postalCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    openingHours?: OpeningHours | null;
  };
}): Promise<OwnerActionResult> {
  const { supabase, error } = await requireBusinessEditor(input.businessId);
  if (error) return error;

  const p = input.patch;
  const row: {
    name?: string;
    short_description?: string | null;
    description?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    instagram_url?: string | null;
    telegram_url?: string | null;
    yelp_url?: string | null;
    google_maps_url?: string | null;
    contact_links?: ContactLink[];
    image_url?: string | null;
    address_line?: string | null;
    city?: string | null;
    region?: string | null;
    state_code?: string | null;
    postal_code?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_precision?: "street" | "county" | null;
    opening_hours?: OpeningHours | null;
  } = {};
  if (p.name !== undefined) {
    const name = p.name.trim();
    if (!name) return fail("Укажите название.");
    row.name = name;
  }
  if (p.shortDescription !== undefined) {
    row.short_description = emptyToNull(p.shortDescription);
  }
  if (p.description !== undefined) {
    row.description = emptyToNull(p.description);
  }
  if (p.phone !== undefined) row.phone = emptyToNull(p.phone);
  if (p.email !== undefined) row.email = emptyToNull(p.email);
  if (p.website !== undefined) {
    const w = emptyToNull(p.website);
    if (w && isYelpUrl(w)) {
      row.website = null;
      if (p.yelpUrl === undefined) {
        row.yelp_url = normalizeYelpBizUrl(w);
      }
    } else {
      row.website = w;
    }
  }
  if (p.instagramUrl !== undefined) {
    row.instagram_url = emptyToNull(p.instagramUrl);
  }
  if (p.telegramUrl !== undefined) {
    row.telegram_url = normalizeTelegramInput(p.telegramUrl);
  }
  if (p.yelpUrl !== undefined) {
    row.yelp_url = normalizeYelpBizUrl(p.yelpUrl) ?? emptyToNull(p.yelpUrl);
  }
  if (p.googleMapsUrl !== undefined) {
    row.google_maps_url = emptyToNull(p.googleMapsUrl);
  }
  if (CONTACT_LINKS_COLUMN_READY && p.contactLinks !== undefined) {
    row.contact_links = serializeContactLinks(p.contactLinks);
  }
  if (p.imageUrl !== undefined) row.image_url = emptyToNull(p.imageUrl);

  const addressTouched =
    p.addressLine !== undefined ||
    p.city !== undefined ||
    p.region !== undefined ||
    p.stateCode !== undefined ||
    p.postalCode !== undefined;

  if (addressTouched) {
    const { data: nameRow } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", input.businessId)
      .maybeSingle();
    const businessName = nameRow?.name ?? null;

    const normalized = normalizeStructuredAddress({
      addressLine: p.addressLine,
      city: p.city,
      region: p.region,
      stateCode: p.stateCode,
      postalCode: p.postalCode,
      businessName,
    });
    const issues = validateStructuredAddress(normalized, { businessName });
    if (issues.length > 0) {
      return fail(issues[0]!.message);
    }
    row.address_line = normalized.addressLine;
    row.city = normalized.city;
    row.region = normalized.region;
    row.state_code = normalized.stateCode;
    row.postal_code = normalized.postalCode;

    const geo = await resolveStreetGeoFields({
      addressLine: normalized.addressLine,
      city: normalized.city,
      stateCode: normalized.stateCode,
      postalCode: normalized.postalCode,
      region: normalized.region,
    });
    row.address_line = geo.addressLine || normalized.addressLine;
    row.latitude = geo.latitude;
    row.longitude = geo.longitude;
    row.location_precision = geo.location_precision;
    if (geo.google_maps_url) row.google_maps_url = geo.google_maps_url;
    if (!normalized.postalCode && geo.postalCode) {
      row.postal_code = geo.postalCode;
    }
  }

  if (p.latitude !== undefined) row.latitude = p.latitude;
  if (p.longitude !== undefined) row.longitude = p.longitude;
  if (p.openingHours !== undefined) row.opening_hours = p.openingHours;

  if (Object.keys(row).length === 0) return fail("Нечего сохранять.");

  const { error: updateError } = await supabase
    .from("businesses")
    .update(row)
    .eq("id", input.businessId);

  if (updateError) {
    return fail(updateError.message || "Не удалось сохранить.");
  }

  revalidatePath(`/business/${input.businessSlug}`);
  revalidatePath(`/business/${input.businessSlug}/manage`);
  revalidatePath("/");
  revalidateTag(businessDetailTag(input.businessSlug));
  return ok("Сохранено.");
}
