"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  claimBusinessAction,
  getBusinessClaimStateAction,
} from "@/lib/claims/actions";
import { cn } from "@/lib/utils";

type ClaimBusinessButtonProps = {
  businessId: string;
  businessSlug: string;
  /** business = «Это мой бизнес», offer = «Это моя услуга» */
  kind?: "business" | "offer";
  className?: string;
  /** After login redirect with ?claim=1 */
  autoSubmit?: boolean;
  /** Probe ownership/claim on mount (detail pages only — avoid N calls on lists) */
  checkStatus?: boolean;
};

type UiState = "idle" | "owned" | "pending" | "created";

function idleLabel(kind: "business" | "offer") {
  return kind === "offer" ? "Это моя услуга" : "Это мой бизнес";
}

export function ClaimBusinessButton({
  businessId,
  businessSlug,
  kind = "business",
  className,
  autoSubmit = false,
  checkStatus = false,
}: ClaimBusinessButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uiState, setUiState] = useState<UiState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [managePath, setManagePath] = useState<string | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!checkStatus) return;
    let cancelled = false;
    void getBusinessClaimStateAction(businessId, businessSlug).then((result) => {
      if (cancelled) return;
      if (!result.ok) return;
      if (result.state === "owned") {
        setUiState("owned");
        setManagePath(result.managePath ?? `/business/${businessSlug}/manage`);
        return;
      }
      if (result.state === "pending") {
        setUiState("pending");
        setMessage(result.message ?? "Заявка уже отправлена и ждёт проверки.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, businessSlug, checkStatus]);

  function submit() {
    startTransition(async () => {
      const result = await claimBusinessAction(businessId, businessSlug);
      if (!result.ok) {
        if (result.state === "needs_auth" && result.loginPath) {
          router.push(result.loginPath);
          return;
        }
        setMessage(result.message);
        return;
      }

      if (result.state === "owned") {
        const path = result.managePath ?? `/business/${businessSlug}/manage`;
        setUiState("owned");
        setManagePath(path);
        router.push(path);
        return;
      }

      setUiState(result.state === "created" ? "created" : "pending");
      setMessage(result.message);
    });
  }

  useEffect(() => {
    if (!autoSubmit || autoStarted.current) return;
    autoStarted.current = true;
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after login redirect
  }, [autoSubmit]);

  if (uiState === "owned" && managePath) {
    return (
      <Link
        className={cn(
          "inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50",
          className,
        )}
        href={managePath}
        onClick={(e) => e.stopPropagation()}
      >
        Управление
      </Link>
    );
  }

  const done = uiState === "pending" || uiState === "created";

  return (
    <div
      className={cn("inline-flex flex-col gap-1", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
          done
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
        )}
        disabled={pending || done}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }}
        type="button"
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : null}
        {done ? "Заявка отправлена" : idleLabel(kind)}
      </button>
      {message && done ? (
        <p className="max-w-[16rem] text-xs text-slate-500">{message}</p>
      ) : null}
      {message && !done ? (
        <p className="max-w-[16rem] text-xs text-red-600">{message}</p>
      ) : null}
    </div>
  );
}
