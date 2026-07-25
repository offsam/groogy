"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeUsZip } from "@/lib/brand";
import { resolveUsZipLocation } from "@/lib/brand/location";
import {
  normalizeProfileInput,
  validateProfileInput,
  type ProfileFormInput,
} from "@/lib/listings/validation";

export type ProfileActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

function fail(message: string): ProfileActionResult {
  return { ok: false, message };
}

function ok(message?: string): ProfileActionResult {
  return { ok: true, message };
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

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName,
      username: input.username,
      avatar_url: input.avatarUrl,
      bio: input.bio,
      city,
      state,
      state_code: stateCode,
      city_geoid: cityGeoid,
      postal_code: postalCode,
      county_geoid: countyGeoid,
      profile_visibility: input.profileVisibility,
      default_author_visibility: input.defaultAuthorVisibility,
      public_activity_enabled: input.publicActivityEnabled,
      show_reviews_in_profile: input.showReviewsInProfile,
      show_listings_in_profile: input.showListingsInProfile,
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return fail("Этот username уже занят.");
    }
    if (error.message.toLowerCase().includes("profiles_username_format")) {
      return fail("Username: 3–30 символов, латиница, цифры и _.");
    }
    return fail(error.message || "Не удалось сохранить профиль.");
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  revalidatePath("/");
  if (input.username) {
    revalidatePath(`/u/${input.username}`);
  }
  return ok(
    countyGeoid
      ? "Профиль сохранён. Регион КРУГИ обновлён по ZIP."
      : "Профиль сохранён.",
  );
}
