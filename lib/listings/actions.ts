"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import {
  normalizeListingInput,
  normalizeServiceInput,
  normalizeTransferInput,
  normalizeLechuInput,
  validateListingDraft,
  validateListingPublish,
  validateMarketplaceNotService,
  validateReportReason,
  validateServiceDraft,
  validateServicePublish,
  validateTransferDraft,
  validateTransferPublish,
  validateLechuDraft,
  validateLechuPublish,
  type ListingFormInput,
  type ServiceFormInput,
  type TransferFormInput,
  type LechuFormInput,
} from "@/lib/listings/validation";
import { canChangeStatus, canEditListing } from "@/lib/listings/permissions";
import { listingStoragePrefix, MAX_LISTING_MEDIA } from "@/lib/listings/constants";
import type {
  ListingReportReason,
  ListingReportStatus,
  ListingStatus,
  PublisherType,
  TransferMethod,
  LechuRewardType,
} from "@/types/listing";

export type ListingActionResult =
  | { ok: true; message?: string; listingId?: string }
  | { ok: false; message: string };

function fail(message: string): ListingActionResult {
  return { ok: false, message };
}

function ok(
  message?: string,
  extra?: { listingId?: string },
): ListingActionResult {
  return { ok: true, message, ...extra };
}

function mapDbError(error: { message?: string; code?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("rate limit") || message.includes("listing create rate limit")) {
    return "Слишком много запросов. Подождите и попробуйте снова.";
  }
  if (message.includes("cannot report own")) {
    return "Нельзя пожаловаться на своё объявление.";
  }
  if (message.includes("not favoritable")) {
    return "Это объявление нельзя добавить в избранное.";
  }
  if (message.includes("not reportable")) {
    return "На это объявление нельзя пожаловаться.";
  }
  if (message.includes("status transition conflict")) {
    return "Статус уже изменился. Обновите страницу.";
  }
  if (message.includes("maximum 10 images")) {
    return "Максимум 10 фотографий на объявление.";
  }
  if (message.includes("maximum 10 active service")) {
    return "Максимум 10 активных услуг на профиль.";
  }
  if (message.includes("maximum 25 active service")) {
    return "Максимум 25 активных услуг на бизнес.";
  }
  if (message.includes("duplicate active service")) {
    return "Уже есть активная услуга с таким названием и категорией.";
  }
  if (message.includes("looks like a service") || message.includes("please post it in the services")) {
    return "Похоже на услугу. Разместите объявление в разделе Услуги.";
  }
  if (message.includes("reserved is not allowed")) {
    return "Резерв недоступен для услуг.";
  }
  if (message.includes("paused is only allowed")) {
    return "Пауза доступна только для услуг.";
  }
  if (message.includes("not business owner")) {
    return "Вы не владелец этого бизнеса.";
  }
  if (message.includes("business must be approved")) {
    return "Бизнес должен быть одобрен для публикации от его имени.";
  }
  if (message.includes("invalid status transition") || message.includes("status transition")) {
    return "Такой переход статуса недоступен.";
  }
  if (message.includes("cannot modify moderated")) {
    return "Объявление заблокировано модерацией.";
  }
  if (message.includes("city and state required")) {
    return "Для публикации укажите город и штат.";
  }
  if (
    message.includes("category required") ||
    message.includes("inactive or invalid") ||
    message.includes("service category required")
  ) {
    return "Для публикации выберите активную категорию.";
  }
  if (message.includes("price required") || message.includes("price_from required")) {
    return "Укажите цену.";
  }
  if (message.includes("marketplace details required")) {
    return "Заполните данные Marketplace.";
  }
  if (message.includes("service details required")) {
    return "Заполните данные услуги.";
  }
  if (message.includes("duplicate") || error?.code === "23505") {
    return "Такая запись уже существует.";
  }
  if (message.includes("invalid storage path")) {
    return "Некорректный путь к файлу.";
  }
  if (message.includes("reserved username")) {
    return "Этот username зарезервирован.";
  }
  return "Не удалось выполнить действие.";
}

async function requireUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null as null, error: fail("Нужно войти в аккаунт.") };
  }
  return { supabase, user, error: null };
}

async function assertOwnsBusinessIfNeeded(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  publisherType: PublisherType,
  publisherBusinessId: string | null,
): Promise<string | null> {
  if (publisherType !== "business") return null;
  if (!publisherBusinessId) return "Выберите бизнес для публикации.";
  const { data, error } = await supabase.rpc("owns_business", {
    p_business_id: publisherBusinessId,
  });
  if (error) return mapDbError(error);
  if (!data) return "Вы не владелец этого бизнеса.";
  return null;
}

function parseFormInput(raw: Partial<ListingFormInput>): ListingFormInput {
  return normalizeListingInput({
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    priceAmount:
      raw.priceAmount === null || raw.priceAmount === undefined
        ? null
        : Number(raw.priceAmount),
    isNegotiable: Boolean(raw.isNegotiable),
    city: raw.city ?? null,
    state: raw.state ?? null,
    stateCode: raw.stateCode ?? null,
    cityGeoid: raw.cityGeoid ?? null,
    visibility: raw.visibility ?? "public",
    authorVisibility: raw.authorVisibility ?? "public",
    categoryId: raw.categoryId ?? null,
    condition: raw.condition ?? null,
    transactionType: raw.transactionType ?? "sell",
    deliveryAvailable: Boolean(raw.deliveryAvailable),
    pickupAvailable: raw.pickupAvailable !== false,
    quantity: raw.quantity ?? null,
    publisherType: raw.publisherType ?? "profile",
    publisherBusinessId: raw.publisherBusinessId ?? null,
  });
}

function parseServiceFormInput(raw: Partial<ServiceFormInput>): ServiceFormInput {
  return normalizeServiceInput({
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    city: raw.city ?? null,
    state: raw.state ?? null,
    stateCode: raw.stateCode ?? null,
    cityGeoid: raw.cityGeoid ?? null,
    visibility: raw.visibility ?? "public",
    authorVisibility: raw.authorVisibility ?? "public",
    serviceCategoryId: raw.serviceCategoryId ?? null,
    pricingType: raw.pricingType ?? "contact_for_price",
    priceFrom:
      raw.priceFrom === null || raw.priceFrom === undefined
        ? null
        : Number(raw.priceFrom),
    priceTo:
      raw.priceTo === null || raw.priceTo === undefined
        ? null
        : Number(raw.priceTo),
    priceUnit: raw.priceUnit ?? null,
    serviceModes: raw.serviceModes?.length ? raw.serviceModes : ["in_person"],
    serviceArea: raw.serviceArea ?? null,
    experienceYears:
      raw.experienceYears === null || raw.experienceYears === undefined
        ? null
        : Number(raw.experienceYears),
    languages: raw.languages?.length ? raw.languages : ["ru"],
    licenseInfo: raw.licenseInfo ?? null,
    insuranceStatus: raw.insuranceStatus ?? null,
    availabilityText: raw.availabilityText ?? null,
    offersFreeEstimate: Boolean(raw.offersFreeEstimate),
    offersEmergencyService: Boolean(raw.offersEmergencyService),
    isNegotiable: Boolean(raw.isNegotiable),
    publisherType: raw.publisherType ?? "profile",
    publisherBusinessId: raw.publisherBusinessId ?? null,
  });
}

async function upsertMarketplaceDetails(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  listingId: string,
  input: ListingFormInput,
) {
  const payload = {
    listing_id: listingId,
    category_id: input.categoryId,
    condition: input.condition,
    transaction_type: input.transactionType,
    delivery_available: input.deliveryAvailable,
    pickup_available: input.pickupAvailable,
    quantity: input.quantity,
  };

  const { error } = await supabase
    .from("marketplace_listing_details")
    .upsert(payload, { onConflict: "listing_id" });

  return error;
}

async function upsertServiceDetails(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  listingId: string,
  input: ServiceFormInput,
) {
  const payload = {
    listing_id: listingId,
    service_category_id: input.serviceCategoryId,
    pricing_type: input.pricingType,
    price_from: input.priceFrom,
    price_to: input.priceTo,
    price_unit: input.priceUnit,
    service_modes: input.serviceModes,
    service_area: input.serviceArea,
    experience_years: input.experienceYears,
    languages: input.languages,
    license_info: input.licenseInfo,
    insurance_status: input.insuranceStatus,
    availability_text: input.availabilityText,
    offers_free_estimate: input.offersFreeEstimate,
    offers_emergency_service: input.offersEmergencyService,
  };

  const { error } = await supabase
    .from("service_listing_details")
    .upsert(payload, { onConflict: "listing_id" });

  return error;
}

function revalidateListingPaths(
  listingId?: string,
  kind: "marketplace" | "services" | "transfers" | "lechu" = "marketplace",
) {
  revalidatePath("/marketplace");
  revalidatePath("/services");
  revalidatePath("/transfers");
  revalidatePath("/lechu");
  revalidatePath("/profile");
  if (listingId) {
    if (kind === "services") {
      revalidatePath(`/services/${listingId}`);
      revalidatePath(`/services/${listingId}/edit`);
    } else if (kind === "transfers") {
      revalidatePath(`/transfers/${listingId}`);
      revalidatePath(`/transfers/${listingId}/edit`);
    } else if (kind === "lechu") {
      revalidatePath(`/lechu/${listingId}`);
      revalidatePath(`/lechu/${listingId}/edit`);
    } else {
      revalidatePath(`/marketplace/${listingId}`);
      revalidatePath(`/marketplace/${listingId}/edit`);
    }
  }
  revalidatePath("/admin/listings");
}

function listingPriceAmount(input: ServiceFormInput): number | null {
  if (["fixed", "from", "hourly", "daily"].includes(input.pricingType)) {
    return input.priceFrom;
  }
  return null;
}

export async function createListingDraftAction(
  raw: Partial<ListingFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseFormInput(raw);
  const validation = validateListingDraft(input);
  if (validation) return fail(validation);

  const ownershipError = await assertOwnsBusinessIfNeeded(
    supabase,
    input.publisherType,
    input.publisherBusinessId,
  );
  if (ownershipError) return fail(ownershipError);

  const { data, error: insertError } = await supabase
    .from("listings")
    .insert({
      listing_type: "marketplace_item",
      status: "draft",
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description: input.description,
      price_amount: input.priceAmount,
      price_currency: "USD",
      is_negotiable: input.isNegotiable,
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: input.publisherType,
      publisher_business_id: input.publisherBusinessId,
      source_kind: "platform",
      source_url: null,
    })
    .select("id")
    .single();

  if (insertError || !data) return fail(mapDbError(insertError));

  const detailError = await upsertMarketplaceDetails(supabase, data.id, input);
  if (detailError) {
    await supabase.from("listings").delete().eq("id", data.id).eq("owner_id", user.id);
    return fail(mapDbError(detailError));
  }

  revalidateListingPaths(data.id, "marketplace");
  return ok("Черновик сохранён.", { listingId: data.id });
}

export async function updateListingAction(
  listingId: string,
  raw: Partial<ListingFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseFormInput(raw);
  const validation = validateListingDraft(input);
  if (validation) return fail(validation);

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select("id, owner_id, status, published_at, publisher_type, publisher_business_id")
    .eq("id", listingId)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (
    !canEditListing(
      { ownerId: existing.owner_id ?? "", status: existing.status },
      user.id,
    )
  ) {
    return fail("Нельзя редактировать это объявление.");
  }

  const publisherLocked =
    existing.published_at != null || existing.status !== "draft";
  const publisherType = publisherLocked
    ? existing.publisher_type
    : input.publisherType;
  const publisherBusinessId = publisherLocked
    ? existing.publisher_business_id
    : input.publisherBusinessId;

  if (!publisherLocked) {
    const ownershipError = await assertOwnsBusinessIfNeeded(
      supabase,
      publisherType,
      publisherBusinessId,
    );
    if (ownershipError) return fail(ownershipError);
  }

  const { error: updateError } = await supabase
    .from("listings")
    .update({
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description: input.description,
      price_amount: input.priceAmount,
      is_negotiable: input.isNegotiable,
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: publisherType,
      publisher_business_id: publisherBusinessId,
    })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (updateError) return fail(mapDbError(updateError));

  const detailError = await upsertMarketplaceDetails(supabase, listingId, input);
  if (detailError) return fail(mapDbError(detailError));

  revalidateListingPaths(listingId, "marketplace");
  return ok("Объявление обновлено.", { listingId });
}

export async function publishListingAction(
  listingId: string,
  raw?: Partial<ListingFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  if (raw) {
    const updateResult = await updateListingAction(listingId, raw);
    if (!updateResult.ok) return updateResult;
  }

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select(
      `
      id, owner_id, status, visibility, author_visibility,
      title, description, price_amount, is_negotiable, city, state,
      state_code, city_geoid,
      publisher_type, publisher_business_id, listing_type,
      marketplace_listing_details (
        category_id, condition, transaction_type,
        delivery_available, pickup_available, quantity
      )
    `,
    )
    .eq("id", listingId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");

  const detailsRaw = existing.marketplace_listing_details;
  const details = Array.isArray(detailsRaw) ? detailsRaw[0] : detailsRaw;
  if (!details) return fail("Заполните данные Marketplace.");

  const input = parseFormInput({
    title: existing.title,
    description: existing.description,
    priceAmount: existing.price_amount != null ? Number(existing.price_amount) : null,
    isNegotiable: existing.is_negotiable,
    city: existing.city,
    state: existing.state,
    stateCode: existing.state_code,
    cityGeoid: existing.city_geoid,
    visibility: existing.visibility,
    authorVisibility: existing.author_visibility,
    categoryId: details.category_id,
    condition: details.condition,
    transactionType: details.transaction_type,
    deliveryAvailable: details.delivery_available,
    pickupAvailable: details.pickup_available,
    quantity: details.quantity,
    publisherType: existing.publisher_type,
    publisherBusinessId: existing.publisher_business_id,
  });

  const validation = validateListingPublish(input);
  if (validation) return fail(validation);

  const { data: looksLikeService } = await supabase.rpc(
    "marketplace_looks_like_service",
    { p_title: input.title, p_description: input.description },
  );
  if (looksLikeService) {
    return fail("Похоже на услугу. Разместите объявление в разделе Услуги.");
  }
  const localHint = validateMarketplaceNotService(input.title, input.description);
  if (localHint) return fail(localHint);

  if (
    !canChangeStatus(
      {
        ownerId: existing.owner_id ?? "",
        status: existing.status,
        listingType: existing.listing_type,
      },
      user.id,
      "active",
    ) &&
    existing.status !== "active"
  ) {
    if (existing.status !== "draft") {
      return fail("Опубликовать можно только черновик.");
    }
  }

  if (existing.status === "active") {
    return ok("Объявление уже опубликовано.", { listingId });
  }

  const { error: publishError } = await supabase
    .from("listings")
    .update({ status: "active" })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (publishError) return fail(mapDbError(publishError));

  revalidateListingPaths(listingId, "marketplace");
  return ok("Объявление опубликовано.", { listingId });
}

export async function createServiceDraftAction(
  raw: Partial<ServiceFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseServiceFormInput(raw);
  const validation = validateServiceDraft(input);
  if (validation) return fail(validation);

  const ownershipError = await assertOwnsBusinessIfNeeded(
    supabase,
    input.publisherType,
    input.publisherBusinessId,
  );
  if (ownershipError) return fail(ownershipError);

  const { data, error: insertError } = await supabase
    .from("listings")
    .insert({
      listing_type: "service",
      status: "draft",
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description: input.description,
      price_amount: listingPriceAmount(input),
      price_currency: "USD",
      is_negotiable: input.isNegotiable || input.pricingType === "negotiable",
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: input.publisherType,
      publisher_business_id: input.publisherBusinessId,
      source_kind: "platform",
      source_url: null,
    })
    .select("id")
    .single();

  if (insertError || !data) return fail(mapDbError(insertError));

  const detailError = await upsertServiceDetails(supabase, data.id, input);
  if (detailError) {
    await supabase.from("listings").delete().eq("id", data.id).eq("owner_id", user.id);
    return fail(mapDbError(detailError));
  }

  revalidateListingPaths(data.id, "services");
  return ok("Черновик сохранён.", { listingId: data.id });
}

export async function updateServiceAction(
  listingId: string,
  raw: Partial<ServiceFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseServiceFormInput(raw);
  const validation = validateServiceDraft(input);
  if (validation) return fail(validation);

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select(
      "id, owner_id, status, published_at, publisher_type, publisher_business_id, listing_type",
    )
    .eq("id", listingId)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (existing.listing_type !== "service") {
    return fail("Это не объявление об услуге.");
  }
  if (
    !canEditListing(
      { ownerId: existing.owner_id ?? "", status: existing.status },
      user.id,
    )
  ) {
    return fail("Нельзя редактировать это объявление.");
  }

  const publisherLocked =
    existing.published_at != null || existing.status !== "draft";
  const publisherType = publisherLocked
    ? existing.publisher_type
    : input.publisherType;
  const publisherBusinessId = publisherLocked
    ? existing.publisher_business_id
    : input.publisherBusinessId;

  if (!publisherLocked) {
    const ownershipError = await assertOwnsBusinessIfNeeded(
      supabase,
      publisherType,
      publisherBusinessId,
    );
    if (ownershipError) return fail(ownershipError);
  }

  const { error: updateError } = await supabase
    .from("listings")
    .update({
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description: input.description,
      price_amount: listingPriceAmount(input),
      is_negotiable: input.isNegotiable || input.pricingType === "negotiable",
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: publisherType,
      publisher_business_id: publisherBusinessId,
    })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (updateError) return fail(mapDbError(updateError));

  const detailError = await upsertServiceDetails(supabase, listingId, input);
  if (detailError) return fail(mapDbError(detailError));

  revalidateListingPaths(listingId, "services");
  return ok("Услуга обновлена.", { listingId });
}

export async function publishServiceAction(
  listingId: string,
  raw?: Partial<ServiceFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  if (raw) {
    const updateResult = await updateServiceAction(listingId, raw);
    if (!updateResult.ok) return updateResult;
  }

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select(
      `
      id, owner_id, status, visibility, author_visibility,
      title, description, city, state, state_code, city_geoid, is_negotiable,
      publisher_type, publisher_business_id, listing_type,
      service_listing_details (
        service_category_id, pricing_type, price_from, price_to,
        price_unit, service_modes, service_area, experience_years,
        languages, license_info, insurance_status, availability_text,
        offers_free_estimate, offers_emergency_service
      )
    `,
    )
    .eq("id", listingId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (existing.listing_type !== "service") {
    return fail("Это не объявление об услуге.");
  }

  const detailsRaw = existing.service_listing_details;
  const details = Array.isArray(detailsRaw) ? detailsRaw[0] : detailsRaw;
  if (!details) return fail("Заполните данные услуги.");

  const input = parseServiceFormInput({
    title: existing.title,
    description: existing.description,
    city: existing.city,
    state: existing.state,
    stateCode: existing.state_code,
    cityGeoid: existing.city_geoid,
    visibility: existing.visibility,
    authorVisibility: existing.author_visibility,
    serviceCategoryId: details.service_category_id,
    pricingType: details.pricing_type,
    priceFrom: details.price_from != null ? Number(details.price_from) : null,
    priceTo: details.price_to != null ? Number(details.price_to) : null,
    priceUnit: details.price_unit,
    serviceModes: (details.service_modes ?? []) as ServiceFormInput["serviceModes"],
    serviceArea: details.service_area,
    experienceYears: details.experience_years,
    languages: details.languages ?? ["ru"],
    licenseInfo: details.license_info,
    insuranceStatus: details.insurance_status,
    availabilityText: details.availability_text,
    offersFreeEstimate: details.offers_free_estimate,
    offersEmergencyService: details.offers_emergency_service,
    isNegotiable: existing.is_negotiable,
    publisherType: existing.publisher_type,
    publisherBusinessId: existing.publisher_business_id,
  });

  const validation = validateServicePublish(input);
  if (validation) return fail(validation);

  if (
    !canChangeStatus(
      {
        ownerId: existing.owner_id ?? "",
        status: existing.status,
        listingType: "service",
      },
      user.id,
      "active",
    ) &&
    existing.status !== "active"
  ) {
    if (existing.status !== "draft") {
      return fail("Опубликовать можно только черновик.");
    }
  }

  if (existing.status === "active") {
    return ok("Услуга уже опубликована.", { listingId });
  }

  const { error: publishError } = await supabase
    .from("listings")
    .update({ status: "active" })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (publishError) return fail(mapDbError(publishError));

  revalidateListingPaths(listingId, "services");
  return ok("Услуга опубликована.", { listingId });
}

function parseTransferFormInput(raw: Partial<TransferFormInput>): TransferFormInput {
  return normalizeTransferInput({
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    city: raw.city ?? null,
    state: raw.state ?? null,
    stateCode: raw.stateCode ?? null,
    cityGeoid: raw.cityGeoid ?? null,
    visibility: (raw.visibility as TransferFormInput["visibility"]) ?? "public",
    authorVisibility:
      (raw.authorVisibility as TransferFormInput["authorVisibility"]) ?? "public",
    categoryId: raw.categoryId ?? null,
    fromCountry: String(raw.fromCountry ?? ""),
    toCountry: String(raw.toCountry ?? ""),
    transferMethod: (raw.transferMethod as TransferMethod) ?? "bank",
    feePercent: raw.feePercent ?? null,
    feeFixedUsd: raw.feeFixedUsd ?? null,
    minAmountUsd: raw.minAmountUsd ?? null,
    maxAmountUsd: raw.maxAmountUsd ?? null,
    processingDays: raw.processingDays ?? null,
    contactNote: raw.contactNote ?? null,
    publisherType: (raw.publisherType as PublisherType) ?? "profile",
    publisherBusinessId: raw.publisherBusinessId ?? null,
  });
}

function parseLechuFormInput(raw: Partial<LechuFormInput>): LechuFormInput {
  return normalizeLechuInput({
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    city: raw.city ?? null,
    state: raw.state ?? null,
    stateCode: raw.stateCode ?? null,
    cityGeoid: raw.cityGeoid ?? null,
    visibility: (raw.visibility as LechuFormInput["visibility"]) ?? "public",
    authorVisibility:
      (raw.authorVisibility as LechuFormInput["authorVisibility"]) ?? "public",
    categoryId: raw.categoryId ?? null,
    departureCountry: String(raw.departureCountry ?? ""),
    destinationCountry: String(raw.destinationCountry ?? ""),
    departureDate: raw.departureDate ?? null,
    carryTypes: Array.isArray(raw.carryTypes) ? raw.carryTypes : ["documents"],
    maxWeightKg: raw.maxWeightKg ?? null,
    sizeLimit: raw.sizeLimit ?? null,
    rewardType: (raw.rewardType as LechuRewardType) ?? "negotiable",
    contactNote: raw.contactNote ?? null,
    publisherType: (raw.publisherType as PublisherType) ?? "profile",
    publisherBusinessId: raw.publisherBusinessId ?? null,
  });
}

async function upsertTransferDetails(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  listingId: string,
  input: TransferFormInput,
) {
  const { error } = await supabase.from("transfer_listing_details").upsert(
    {
      listing_id: listingId,
      category_id: input.categoryId,
      from_country: input.fromCountry,
      to_country: input.toCountry,
      transfer_method: input.transferMethod,
      fee_percent: input.feePercent,
      fee_fixed_usd: input.feeFixedUsd,
      min_amount_usd: input.minAmountUsd,
      max_amount_usd: input.maxAmountUsd,
      processing_days: input.processingDays,
    },
    { onConflict: "listing_id" },
  );
  return error;
}

async function upsertLechuDetails(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  listingId: string,
  input: LechuFormInput,
) {
  const { error } = await supabase.from("lechu_listing_details").upsert(
    {
      listing_id: listingId,
      category_id: input.categoryId,
      departure_country: input.departureCountry,
      destination_country: input.destinationCountry,
      departure_date: input.departureDate,
      carry_types: input.carryTypes,
      max_weight_kg: input.maxWeightKg,
      size_limit: input.sizeLimit,
      reward_type: input.rewardType,
    },
    { onConflict: "listing_id" },
  );
  return error;
}

export async function createTransferDraftAction(
  raw: Partial<TransferFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseTransferFormInput(raw);
  const validation = validateTransferDraft(input);
  if (validation) return fail(validation);

  const ownershipError = await assertOwnsBusinessIfNeeded(
    supabase,
    input.publisherType,
    input.publisherBusinessId,
  );
  if (ownershipError) return fail(ownershipError);

  const description =
    input.contactNote?.trim()
      ? `${input.description}\n\nКонтакт: ${input.contactNote.trim()}`
      : input.description;

  const { data, error: insertError } = await supabase
    .from("listings")
    .insert({
      listing_type: "transfer",
      status: "draft",
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description,
      price_amount: input.feeFixedUsd,
      price_currency: "USD",
      is_negotiable: true,
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: input.publisherType,
      publisher_business_id: input.publisherBusinessId,
      source_kind: "platform",
      source_url: null,
    })
    .select("id")
    .single();

  if (insertError || !data) return fail(mapDbError(insertError));

  const detailError = await upsertTransferDetails(supabase, data.id, input);
  if (detailError) {
    await supabase.from("listings").delete().eq("id", data.id).eq("owner_id", user.id);
    return fail(mapDbError(detailError));
  }

  revalidateListingPaths(data.id, "transfers");
  return ok("Черновик сохранён.", { listingId: data.id });
}

export async function updateTransferAction(
  listingId: string,
  raw: Partial<TransferFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseTransferFormInput(raw);
  const validation = validateTransferDraft(input);
  if (validation) return fail(validation);

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select(
      "id, owner_id, status, published_at, publisher_type, publisher_business_id, listing_type",
    )
    .eq("id", listingId)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (existing.listing_type !== "transfer") {
    return fail("Это не объявление о переводе.");
  }
  if (
    !canEditListing(
      { ownerId: existing.owner_id ?? "", status: existing.status },
      user.id,
    )
  ) {
    return fail("Нельзя редактировать это объявление.");
  }

  const publisherLocked =
    existing.published_at != null || existing.status !== "draft";
  const publisherType = publisherLocked
    ? existing.publisher_type
    : input.publisherType;
  const publisherBusinessId = publisherLocked
    ? existing.publisher_business_id
    : input.publisherBusinessId;

  if (!publisherLocked) {
    const ownershipError = await assertOwnsBusinessIfNeeded(
      supabase,
      publisherType,
      publisherBusinessId,
    );
    if (ownershipError) return fail(ownershipError);
  }

  const description =
    input.contactNote?.trim()
      ? `${input.description}\n\nКонтакт: ${input.contactNote.trim()}`
      : input.description;

  const { error: updateError } = await supabase
    .from("listings")
    .update({
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description,
      price_amount: input.feeFixedUsd,
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: publisherType,
      publisher_business_id: publisherBusinessId,
    })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (updateError) return fail(mapDbError(updateError));

  const detailError = await upsertTransferDetails(supabase, listingId, {
    ...input,
    publisherType,
    publisherBusinessId,
  });
  if (detailError) return fail(mapDbError(detailError));

  revalidateListingPaths(listingId, "transfers");
  return ok("Объявление обновлено.", { listingId });
}

export async function publishTransferAction(
  listingId: string,
  raw?: Partial<TransferFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  if (raw) {
    const updateResult = await updateTransferAction(listingId, raw);
    if (!updateResult.ok) return updateResult;
  }

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select(
      `
      id, owner_id, status, visibility, author_visibility,
      title, description, city, state, state_code, city_geoid,
      publisher_type, publisher_business_id, listing_type,
      transfer_listing_details (
        category_id, from_country, to_country, transfer_method,
        fee_percent, fee_fixed_usd, min_amount_usd, max_amount_usd, processing_days
      )
    `,
    )
    .eq("id", listingId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (existing.listing_type !== "transfer") {
    return fail("Это не объявление о переводе.");
  }

  const detailsRaw = existing.transfer_listing_details;
  const details = Array.isArray(detailsRaw) ? detailsRaw[0] : detailsRaw;
  if (!details) return fail("Заполните данные перевода.");

  const input = parseTransferFormInput({
    title: existing.title,
    description: existing.description,
    city: existing.city,
    state: existing.state,
    stateCode: existing.state_code,
    cityGeoid: existing.city_geoid,
    visibility: existing.visibility,
    authorVisibility: existing.author_visibility,
    categoryId: details.category_id,
    fromCountry: details.from_country,
    toCountry: details.to_country,
    transferMethod: details.transfer_method as TransferMethod,
    feePercent: details.fee_percent != null ? Number(details.fee_percent) : null,
    feeFixedUsd:
      details.fee_fixed_usd != null ? Number(details.fee_fixed_usd) : null,
    minAmountUsd:
      details.min_amount_usd != null ? Number(details.min_amount_usd) : null,
    maxAmountUsd:
      details.max_amount_usd != null ? Number(details.max_amount_usd) : null,
    processingDays: details.processing_days,
    contactNote: null,
    publisherType: existing.publisher_type,
    publisherBusinessId: existing.publisher_business_id,
  });

  const validation = validateTransferPublish(input);
  if (validation) return fail(validation);

  if (existing.status === "active") {
    return ok("Объявление уже опубликовано.", { listingId });
  }

  const { error: publishError } = await supabase
    .from("listings")
    .update({ status: "active" })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (publishError) return fail(mapDbError(publishError));

  revalidateListingPaths(listingId, "transfers");
  return ok("Объявление опубликовано.", { listingId });
}

export async function createLechuDraftAction(
  raw: Partial<LechuFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseLechuFormInput(raw);
  const validation = validateLechuDraft(input);
  if (validation) return fail(validation);

  const ownershipError = await assertOwnsBusinessIfNeeded(
    supabase,
    input.publisherType,
    input.publisherBusinessId,
  );
  if (ownershipError) return fail(ownershipError);

  const description =
    input.contactNote?.trim()
      ? `${input.description}\n\nКонтакт: ${input.contactNote.trim()}`
      : input.description;

  const { data, error: insertError } = await supabase
    .from("listings")
    .insert({
      listing_type: "transport_carry",
      status: "draft",
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description,
      price_amount: null,
      price_currency: "USD",
      is_negotiable: input.rewardType === "negotiable",
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: input.publisherType,
      publisher_business_id: input.publisherBusinessId,
      source_kind: "platform",
      source_url: null,
    })
    .select("id")
    .single();

  if (insertError || !data) return fail(mapDbError(insertError));

  const detailError = await upsertLechuDetails(supabase, data.id, input);
  if (detailError) {
    await supabase.from("listings").delete().eq("id", data.id).eq("owner_id", user.id);
    return fail(mapDbError(detailError));
  }

  revalidateListingPaths(data.id, "lechu");
  return ok("Черновик сохранён.", { listingId: data.id });
}

export async function updateLechuAction(
  listingId: string,
  raw: Partial<LechuFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const input = parseLechuFormInput(raw);
  const validation = validateLechuDraft(input);
  if (validation) return fail(validation);

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select(
      "id, owner_id, status, published_at, publisher_type, publisher_business_id, listing_type",
    )
    .eq("id", listingId)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (existing.listing_type !== "transport_carry") {
    return fail("Это не объявление раздела «Лечу».");
  }
  if (
    !canEditListing(
      { ownerId: existing.owner_id ?? "", status: existing.status },
      user.id,
    )
  ) {
    return fail("Нельзя редактировать это объявление.");
  }

  const publisherLocked =
    existing.published_at != null || existing.status !== "draft";
  const publisherType = publisherLocked
    ? existing.publisher_type
    : input.publisherType;
  const publisherBusinessId = publisherLocked
    ? existing.publisher_business_id
    : input.publisherBusinessId;

  if (!publisherLocked) {
    const ownershipError = await assertOwnsBusinessIfNeeded(
      supabase,
      publisherType,
      publisherBusinessId,
    );
    if (ownershipError) return fail(ownershipError);
  }

  const description =
    input.contactNote?.trim()
      ? `${input.description}\n\nКонтакт: ${input.contactNote.trim()}`
      : input.description;

  const { error: updateError } = await supabase
    .from("listings")
    .update({
      visibility: input.visibility,
      author_visibility: input.authorVisibility,
      title: input.title,
      description,
      is_negotiable: input.rewardType === "negotiable",
      city: input.city,
      state: input.state,
      state_code: input.stateCode ?? null,
      city_geoid: input.cityGeoid ?? null,
      publisher_type: publisherType,
      publisher_business_id: publisherBusinessId,
    })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (updateError) return fail(mapDbError(updateError));

  const detailError = await upsertLechuDetails(supabase, listingId, {
    ...input,
    publisherType,
    publisherBusinessId,
  });
  if (detailError) return fail(mapDbError(detailError));

  revalidateListingPaths(listingId, "lechu");
  return ok("Объявление обновлено.", { listingId });
}

export async function publishLechuAction(
  listingId: string,
  raw?: Partial<LechuFormInput>,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  if (raw) {
    const updateResult = await updateLechuAction(listingId, raw);
    if (!updateResult.ok) return updateResult;
  }

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select(
      `
      id, owner_id, status, visibility, author_visibility,
      title, description, city, state, state_code, city_geoid,
      publisher_type, publisher_business_id, listing_type,
      lechu_listing_details (
        category_id, departure_country, destination_country, departure_date,
        carry_types, max_weight_kg, size_limit, reward_type
      )
    `,
    )
    .eq("id", listingId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (existing.listing_type !== "transport_carry") {
    return fail("Это не объявление раздела «Лечу».");
  }

  const detailsRaw = existing.lechu_listing_details;
  const details = Array.isArray(detailsRaw) ? detailsRaw[0] : detailsRaw;
  if (!details) return fail("Заполните данные поездки.");

  const input = parseLechuFormInput({
    title: existing.title,
    description: existing.description,
    city: existing.city,
    state: existing.state,
    stateCode: existing.state_code,
    cityGeoid: existing.city_geoid,
    visibility: existing.visibility,
    authorVisibility: existing.author_visibility,
    categoryId: details.category_id,
    departureCountry: details.departure_country,
    destinationCountry: details.destination_country,
    departureDate: details.departure_date,
    carryTypes: details.carry_types ?? ["documents"],
    maxWeightKg:
      details.max_weight_kg != null ? Number(details.max_weight_kg) : null,
    sizeLimit: details.size_limit,
    rewardType: details.reward_type as LechuRewardType,
    contactNote: null,
    publisherType: existing.publisher_type,
    publisherBusinessId: existing.publisher_business_id,
  });

  const validation = validateLechuPublish(input);
  if (validation) return fail(validation);

  if (existing.status === "active") {
    return ok("Объявление уже опубликовано.", { listingId });
  }

  const { error: publishError } = await supabase
    .from("listings")
    .update({ status: "active" })
    .eq("id", listingId)
    .eq("owner_id", user.id);

  if (publishError) return fail(mapDbError(publishError));

  revalidateListingPaths(listingId, "lechu");
  return ok("Объявление опубликовано.", { listingId });
}

export async function setListingStatusAction(
  listingId: string,
  status: ListingStatus,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  if (["removed", "rejected", "expired"].includes(status)) {
    return fail("Этот статус может выставить только администратор.");
  }

  const { data: existing, error: fetchError } = await supabase
    .from("listings")
    .select("id, owner_id, status, listing_type")
    .eq("id", listingId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (fetchError) return fail(mapDbError(fetchError));
  if (!existing) return fail("Объявление не найдено.");
  if (
    !canChangeStatus(
      {
        ownerId: existing.owner_id ?? "",
        status: existing.status,
        listingType: existing.listing_type,
      },
      user.id,
      status,
    )
  ) {
    return fail("Недопустимый переход статуса.");
  }

  if (existing.status === status) {
    return ok("Статус уже установлен.", { listingId });
  }

  const { error: rpcError } = await supabase.rpc("transition_listing_status", {
    p_listing_id: listingId,
    p_from: existing.status,
    p_to: status,
  });

  if (rpcError) return fail(mapDbError(rpcError));

  const kind =
    existing.listing_type === "service"
      ? "services"
      : existing.listing_type === "transfer"
        ? "transfers"
        : existing.listing_type === "transport_carry"
          ? "lechu"
          : "marketplace";
  revalidateListingPaths(listingId, kind);
  return ok("Статус обновлён.", { listingId });
}

export async function reserveListingAction(listingId: string) {
  return setListingStatusAction(listingId, "reserved");
}

export async function pauseListingAction(listingId: string) {
  return setListingStatusAction(listingId, "paused");
}

export async function reactivateListingAction(listingId: string) {
  return setListingStatusAction(listingId, "active");
}

export async function completeListingAction(listingId: string) {
  return setListingStatusAction(listingId, "completed");
}

export async function archiveListingAction(listingId: string) {
  return setListingStatusAction(listingId, "archived");
}

export async function deleteOrWithdrawListingAction(listingId: string) {
  return setListingStatusAction(listingId, "archived");
}

export async function addListingFavoriteAction(
  listingId: string,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: insertError } = await supabase
    .from("listing_favorites")
    .insert({ listing_id: listingId });

  if (insertError) {
    if (insertError.code === "23505") {
      return ok("Уже в избранном.", { listingId });
    }
    return fail(mapDbError(insertError));
  }

  revalidateListingPaths(listingId);
  return ok("Добавлено в избранное.", { listingId });
}

export async function removeListingFavoriteAction(
  listingId: string,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await supabase
    .from("listing_favorites")
    .delete()
    .eq("listing_id", listingId)
    .eq("user_id", user.id);

  if (deleteError) return fail(mapDbError(deleteError));

  revalidateListingPaths(listingId);
  return ok("Удалено из избранного.", { listingId });
}

export async function reportListingAction(input: {
  listingId: string;
  reason: string;
  details?: string | null;
}): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  if (!validateReportReason(input.reason)) {
    return fail("Выберите причину жалобы.");
  }

  const details = input.details?.trim() || null;
  if (details && details.length > 1000) {
    return fail("Комментарий слишком длинный.");
  }

  const { error: insertError } = await supabase.from("listing_reports").insert({
    listing_id: input.listingId,
    reason: input.reason as ListingReportReason,
    details,
  });

  if (insertError) return fail(mapDbError(insertError));

  revalidatePath("/admin/listings");
  return ok("Жалоба отправлена.");
}

export async function addListingMediaAction(input: {
  listingId: string;
  storagePath: string;
  sortOrder: number;
  width?: number | null;
  height?: number | null;
}): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const expectedPrefix = listingStoragePrefix(user.id, input.listingId);
  if (!input.storagePath.startsWith(`${expectedPrefix}/`)) {
    return fail("Некорректный путь к файлу.");
  }

  const { count } = await supabase
    .from("listing_media")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", input.listingId);

  if ((count ?? 0) >= MAX_LISTING_MEDIA) {
    return fail("Максимум 10 фотографий на объявление.");
  }

  const { error: insertError } = await supabase.from("listing_media").insert({
    listing_id: input.listingId,
    storage_path: input.storagePath,
    media_type: "image",
    sort_order: input.sortOrder,
    width: input.width ?? null,
    height: input.height ?? null,
  });

  if (insertError) return fail(mapDbError(insertError));

  revalidateListingPaths(input.listingId);
  return ok("Фото добавлено.", { listingId: input.listingId });
}

export async function removeListingMediaAction(
  mediaId: string,
  listingId: string,
): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { data: media } = await supabase
    .from("listing_media")
    .select("id, storage_path, listing_id")
    .eq("id", mediaId)
    .eq("listing_id", listingId)
    .maybeSingle();

  if (!media) return fail("Файл не найден.");

  const { error: deleteError } = await supabase
    .from("listing_media")
    .delete()
    .eq("id", mediaId);

  if (deleteError) return fail(mapDbError(deleteError));

  await supabase.storage.from("listing-images").remove([media.storage_path]);

  revalidateListingPaths(listingId);
  return ok("Фото удалено.", { listingId });
}

export async function adminSetListingStatusAction(input: {
  listingId: string;
  status: "active" | "removed" | "rejected" | "archived" | "paused";
  reason?: string | null;
}): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) return fail(mapDbError(adminError));
  if (!isAdmin) return fail("Доступ только для администратора.");

  const { error: rpcError } = await supabase.rpc("admin_set_listing_status", {
    p_listing_id: input.listingId,
    p_status: input.status,
    p_reason: input.reason ?? null,
  });

  if (rpcError) return fail(mapDbError(rpcError));

  revalidateListingPaths(input.listingId);
  return ok("Статус объявления обновлён администратором.", {
    listingId: input.listingId,
  });
}

export async function adminSetListingReportStatusAction(input: {
  reportId: string;
  status: ListingReportStatus;
}): Promise<ListingActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) return fail(mapDbError(adminError));
  if (!isAdmin) return fail("Доступ только для администратора.");

  const { error: rpcError } = await supabase.rpc(
    "admin_set_listing_report_status",
    {
      p_report_id: input.reportId,
      p_status: input.status,
    },
  );

  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath("/admin/listings");
  return ok("Статус жалобы обновлён.");
}
