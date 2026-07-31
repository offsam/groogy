"use server";

import { createServerClient } from "@/lib/supabase/server";
import { businessHasOwner, userOwnsBusiness } from "@/lib/reviews/queries";
import {
  listingEditPath,
  listingKindFromType,
  listingPublicPath,
  parseClaimProof,
  type ClaimProofInput,
  type ClaimStateResult,
  type ClaimSubmitResult,
  type ListingClaimKind,
} from "@/lib/claims/shared";
import type { ListingType } from "@/types/listing";

function loginPathFor(kind: ListingClaimKind, id: string) {
  return `/login?next=${encodeURIComponent(`${listingPublicPath(kind, id)}?claim=1`)}`;
}

async function resolveListingKind(
  listingId: string,
  kindHint?: ListingClaimKind,
): Promise<{
  kind: ListingClaimKind;
  ownerId: string | null;
  publisherBusinessId: string | null;
} | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("listings")
    .select("listing_type, owner_id, publisher_type, publisher_business_id")
    .eq("id", listingId)
    .maybeSingle();
  if (error || !data) return null;
  const kind =
    kindHint ?? listingKindFromType(data.listing_type as ListingType);
  return {
    kind,
    ownerId: (data.owner_id as string | null) ?? null,
    publisherBusinessId:
      data.publisher_type === "business"
        ? ((data.publisher_business_id as string | null) ?? null)
        : null,
  };
}

export async function getListingClaimStateAction(
  listingId: string,
  kindHint?: ListingClaimKind,
): Promise<ClaimStateResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const resolved = await resolveListingKind(listingId, kindHint);
  const kind = resolved?.kind ?? kindHint ?? "marketplace";

  if (resolved?.publisherBusinessId) {
    const parentClaimed = await businessHasOwner(
      supabase,
      resolved.publisherBusinessId,
    );
    if (parentClaimed) {
      // Owner of the parent business already controls this listing.
      if (user) {
        const ownsParent = await userOwnsBusiness(
          supabase,
          resolved.publisherBusinessId,
        ).catch(() => false);
        if (ownsParent) {
          return {
            ok: true,
            state: "owned",
            message: "Вы управляете этим объявлением через бизнес.",
            managePath: listingEditPath(kind, listingId),
          };
        }
      }
      return {
        ok: true,
        state: "locked",
        message:
          "Это объявление принадлежит бизнесу с подтверждённым владельцем — отдельная заявка не нужна.",
      };
    }
  }

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить объявление.",
      loginPath: loginPathFor(kind, listingId),
    };
  }

  if (resolved?.ownerId === user.id) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим объявлением.",
      managePath: listingEditPath(kind, listingId),
    };
  }

  const { data: pending, error } = await supabase
    .from("listing_claims")
    .select("id")
    .eq("listing_id", listingId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    return { ok: false, state: "error", message: "Не удалось проверить заявку." };
  }
  if (pending) {
    return {
      ok: true,
      state: "pending",
      message: "Заявка уже отправлена и ждёт проверки.",
    };
  }
  return { ok: true, state: "available" };
}

export async function claimListingAction(
  listingId: string,
  kindHint?: ListingClaimKind,
  proof?: ClaimProofInput | string,
): Promise<ClaimSubmitResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const resolved = await resolveListingKind(listingId, kindHint);
  const kind = resolved?.kind ?? kindHint ?? "marketplace";

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить объявление.",
      loginPath: loginPathFor(kind, listingId),
    };
  }

  if (resolved?.ownerId === user.id) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим объявлением.",
      managePath: listingEditPath(kind, listingId),
    };
  }

  if (resolved?.publisherBusinessId) {
    const parentClaimed = await businessHasOwner(
      supabase,
      resolved.publisherBusinessId,
    );
    if (parentClaimed) {
      return {
        ok: false,
        state: "error",
        message:
          "Это объявление принадлежит бизнесу с подтверждённым владельцем. Заявите права на сам бизнес, если это вы.",
      };
    }
  }

  const { data: existingPending } = await supabase
    .from("listing_claims")
    .select("id")
    .eq("listing_id", listingId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existingPending) {
    return {
      ok: true,
      state: "pending",
      message: "Заявка уже отправлена и ждёт проверки.",
    };
  }

  const parsed = parseClaimProof(proof);
  if (parsed.error) {
    return { ok: false, state: "error", message: parsed.error };
  }

  const { error } = await supabase.from("listing_claims").insert({
    listing_id: listingId,
    user_id: user.id,
    applicant_message: parsed.applicantMessage,
    verification_details: parsed.verificationDetails,
    verification_method: "owner_self_claim",
  });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: true,
        state: "pending",
        message: "Заявка уже отправлена и ждёт проверки.",
      };
    }
    return {
      ok: false,
      state: "error",
      message: "Не удалось отправить заявку. Попробуйте ещё раз.",
    };
  }

  return {
    ok: true,
    state: "created",
    message: "Заявка отправлена. Мы проверим и откроем доступ к редактированию.",
  };
}
