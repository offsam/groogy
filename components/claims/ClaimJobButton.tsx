"use client";

import { useCallback } from "react";
import { ClaimEntityButton } from "@/components/claims/ClaimEntityButton";
import {
  claimJobAction,
  getJobClaimStateAction,
} from "@/lib/claims/job-actions";

type Props = {
  jobId: string;
  jobSlug: string;
  autoSubmit?: boolean;
  checkStatus?: boolean;
  className?: string;
};

export function ClaimJobButton({
  jobId,
  jobSlug,
  autoSubmit = false,
  checkStatus = false,
  className,
}: Props) {
  const getState = useCallback(
    () => getJobClaimStateAction(jobId, jobSlug),
    [jobId, jobSlug],
  );
  const submitClaim = useCallback(
    (proof: Parameters<typeof claimJobAction>[2]) =>
      claimJobAction(jobId, jobSlug, proof),
    [jobId, jobSlug],
  );

  return (
    <ClaimEntityButton
      autoSubmit={autoSubmit}
      checkStatus={checkStatus}
      className={className}
      formHint="Укажите телефон и ссылки — так мы быстрее проверим, что вакансия ваша."
      formTitle="Подтвердите вакансию"
      getState={getState}
      idleLabel="Это моя вакансия"
      messagePlaceholder="Кратко, почему это ваша вакансия"
      ownedLabel="Моя вакансия"
      submitClaim={submitClaim}
    />
  );
}
