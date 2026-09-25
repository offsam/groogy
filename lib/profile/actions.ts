"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { normalizeUsZip } from "@/lib/brand";
import { resolveUsZipLocation } from "@/lib/brand/location";
import {
  normalizeProfileInput,
  validateProfileInput,
  type ProfileFormInput,
} from "@/lib/listings/validation";

export type ProfileActionResult =
  | { ok: true; message?: string; username?: string }
  | { ok: false; message: string };

function fail(message: string): ProfileActionResult {
  return { ok: false, message };
}

function ok(message?: string, username?: string): ProfileActionResult {
  return username ? { ok: true, message, username } : { ok: true, message };
}

export async function updateProfileSettingsAction(
  _prev: ProfileActionResult | null,
  formData: FormData,
): Promise<ProfileActionResult> {
  const raw: ProfileFormInput = {
    displayName: String(formData.get("display_name") ?? ""),
    username: String(formData.get("username") ?? ""),
    avatarUrl: String(formData.get("avatar_url") ?? ""),
    bio: String(formData.get("bio") ?? ""),
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    profileVisibility:
      String(formData.get("profile_visibility") ?? "public") === "private"
        ? "private"
        : "public",
    defaultAuthorVisibility: (["public", "initials", "anonymous"].includes(
      String(formData.get("default_author_visibility") ?? ""),
    )
      ? String(formData.get("default_author_visibility"))
      : "public") as ProfileFormInput["defaultAuthorVisibility"],
    publicActivityEnabled: formData.get("public_activity_enabled") === "on",
    showReviewsInProfile: formData.get("show_reviews_in_profile") === "on",
    showListingsInProfile: formData.get("show_listings_in_profile") === "on",
  };

  const postalRaw = String(formData.get("postal_code") ?? "").trim();
  const postalCode = normalizeUsZip(postalRaw);
  if (postalRaw && !postalCode) {
    return fail("Укажите корректный ZIP (5 цифр).");
  }

  const input = normalizeProfileInput(raw);
  const validation = validateProfileInput(input);
  if (validation) return fail(validation);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Нужно войти в аккаунт.");

  let countyGeoid: string | null = null;
  let cityGeoid: string | null = null;
  let stateCode: string | null = null;
  let city = input.city;
  let state = input.state;

  if (postalCode) {
    const resolved = await resolveUsZipLocation(supabase, postalCode);
    if (resolved) {
      countyGeoid = resolved.countyGeoid;
      cityGeoid = resolved.cityGeoid;
      stateCode = resolved.stateCode;
      if (!city && resolved.city) city = resolved.city;
      if (!state && resolved.stateAbbr) state = resolved.stateAbbr;
    }
  }

  const basePatch = {
    display_name: input.displayName,
    username: input.username,
    avatar_url: input.avatarUrl,
    bio: input.bio,
    city,
    state,
    state_code: stateCode,
    city_geoid: cityGeoid,
    profile_visibility: input.profileVisibility,
    default_author_visibility: input.defaultAuthorVisibility,
    public_activity_enabled: input.publicActivityEnabled,
    show_reviews_in_profile: input.showReviewsInProfile,
    show_listings_in_profile: input.showListingsInProfile,
  };

  // postal_code / county_geoid need column UPDATE grants (see migration
  // 20260925120000). Retry without them if the remote DB is behind, then
  // write ZIP via service role so is_profile_completed (name+ZIP) can succeed.
  // Geo FKs (county_geoid / city_geoid) must not block saving the ZIP itself.
  let { error } = await supabase
    .from("profiles")
    .update({
      ...basePatch,
      postal_code: postalCode,
      county_geoid: countyGeoid,
    })
    .eq("id", user.id);

  let zipSaved = !error;

  if (
    error &&
    (error.code === "42501" ||
      error.message.toLowerCase().includes("permission denied") ||
      error.code === "23503" ||
      error.message.toLowerCase().includes("foreign key"))
  ) {
    ({ error } = await supabase.from("profiles").update(basePatch).eq("id", user.id));
    if (
      error &&
      (error.code === "23503" ||
        error.message.toLowerCase().includes("foreign key"))
    ) {
      // city_geoid / state_code FK — save identity fields without geo.
      ({ error } = await supabase
        .from("profiles")
        .update({
          display_name: basePatch.display_name,
          username: basePatch.username,
          avatar_url: basePatch.avatar_url,
          bio: basePatch.bio,
          city: basePatch.city,
          state: basePatch.state,
          profile_visibility: basePatch.profile_visibility,
          default_author_visibility: basePatch.default_author_visibility,
          public_activity_enabled: basePatch.public_activity_enabled,
          show_reviews_in_profile: basePatch.show_reviews_in_profile,
          show_listings_in_profile: basePatch.show_listings_in_profile,
        })
        .eq("id", user.id));
    }
    zipSaved = false;
  }

  if (error) {
    if (error.code === "23505") {
      return fail("Этот username уже занят.");
    }
    if (error.message.toLowerCase().includes("profiles_username_format")) {
      return fail("Username: 3–30 символов, латиница, цифры и _.");
    }
    return fail(error.message || "Не удалось сохранить профиль.");
  }

  if (postalCode && !zipSaved) {
    // Prefer security-definer RPC (after migration); fall back to service role.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcError } = await (supabase as any).rpc(
      "set_own_profile_postal",
      {
        p_postal: postalCode,
        p_county_geoid: countyGeoid,
      },
    );
    if (!rpcError) {
      zipSaved = true;
    } else {
      try {
        const admin = createServiceRoleClient();
        const { error: zipOnlyError } = await admin
          .from("profiles")
          .update({ postal_code: postalCode })
          .eq("id", user.id);
        if (zipOnlyError) {
          countyGeoid = null;
          console.error(
            "[profile] ZIP write failed:",
            rpcError.message,
            zipOnlyError.message,
          );
        } else {
          zipSaved = true;
          if (countyGeoid) {
            const { error: countyError } = await admin
              .from("profiles")
              .update({ county_geoid: countyGeoid })
              .eq("id", user.id);
            if (countyError) countyGeoid = null;
          }
          if (cityGeoid || stateCode) {
            await admin
              .from("profiles")
              .update({
                ...(cityGeoid ? { city_geoid: cityGeoid } : {}),
                ...(stateCode ? { state_code: stateCode } : {}),
              })
              .eq("id", user.id);
          }
        }
      } catch (err) {
        countyGeoid = null;
        console.error("[profile] ZIP service-role fallback failed:", err);
      }
    }
  }

  if (!zipSaved) {
    countyGeoid = null;
  }

  revalidatePath("/profile");
  revalidatePath("/me/settings");
  revalidatePath("/professional/new");
  revalidatePath("/", "layout");
  revalidatePath("/");
  if (input.username) {
    revalidatePath(`/u/${input.username}`);
  }
  return ok(
    zipSaved && countyGeoid
      ? "Профиль сохранён. Регион КРУГИ обновлён по ZIP."
      : zipSaved
        ? "Профиль сохранён."
        : postalCode
          ? "Профиль сохранён, но ZIP не записался. Выполните SQL из supabase/migrations/20260925120000_listings_profile_column_grants.sql в Supabase SQL Editor."
          : "Профиль сохранён.",
    input.username ?? undefined,
  );
}
