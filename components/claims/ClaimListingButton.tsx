"use client";

import { useCallback } from "react";
import { ClaimEntityButton } from "@/components/claims/ClaimEntityButton";
import {
  claimListingAction,
  getListingClaimStateAction,
} from "@/lib/claims/listing-actions";
import {
  listingClaimIdleLabel,
  type ListingClaimKind,
} from "@/lib/claims/shared";

type Props = {
  listingId: string;
  kind: ListingClaimKind;
  autoSubmit?: boolean;
  checkStatus?: boolean;
  className?: string;
};

export function ClaimListingButton({
  listingId,
  kind,
  autoSubmit = false,
  checkStatus = false,
  className,
}: Props) {
  const getState = useCallback(
    () => getListingClaimStateAction(listingId, kind),
    [listingId, kind],
  );
  const submitClaim = useCallback(
    (proof: Parameters<typeof claimListingAction>[2]) =>
      claimListingAction(listingId, kind, proof),
    [listingId, kind],
  );

  return (
    <ClaimEntityButton
      autoSubmit={autoSubmit}
      checkStatus={checkStatus}
      className={className}
      formHint="Укажите телефон и ссылки — так мы быстрее проверим, что объявление ваше."
      formTitle="Подтвердите объявление"
      getState={getState}
      idleLabel={listingClaimIdleLabel(kind)}
      messagePlaceholder="Кратко, почему это ваше объявление"
      ownedLabel="Редактировать"
      submitClaim={submitClaim}
    />
  );
}
