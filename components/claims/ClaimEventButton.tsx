"use client";

import { useCallback } from "react";
import { ClaimEntityButton } from "@/components/claims/ClaimEntityButton";
import {
  claimEventAction,
  getEventClaimStateAction,
} from "@/lib/claims/event-actions";

type Props = {
  eventId: string;
  eventSlug: string;
  autoSubmit?: boolean;
  checkStatus?: boolean;
  className?: string;
};

export function ClaimEventButton({
  eventId,
  eventSlug,
  autoSubmit = false,
  checkStatus = false,
  className,
}: Props) {
  const getState = useCallback(
    () => getEventClaimStateAction(eventId, eventSlug),
    [eventId, eventSlug],
  );
  const submitClaim = useCallback(
    (proof: Parameters<typeof claimEventAction>[2]) =>
      claimEventAction(eventId, eventSlug, proof),
    [eventId, eventSlug],
  );

  return (
    <ClaimEntityButton
      autoSubmit={autoSubmit}
      checkStatus={checkStatus}
      className={className}
      formHint="Укажите телефон и ссылки — так мы быстрее проверим, что событие ваше."
      formTitle="Подтвердите событие"
      getState={getState}
      idleLabel="Это моё событие"
      messagePlaceholder="Кратко, почему это ваше событие"
      ownedLabel="Моё событие"
      submitClaim={submitClaim}
    />
  );
}
