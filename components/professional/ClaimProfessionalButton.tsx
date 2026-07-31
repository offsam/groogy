"use client";

import { useEffect, useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import {
  claimProfessionalAction,
  getProfessionalClaimStateAction,
} from "@/lib/claims/professional-actions";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type ClaimProfessionalButtonProps = {
  professionalId: string;
  professionalSlug: string;
  className?: string;
  autoSubmit?: boolean;
  checkStatus?: boolean;
};

type UiState = "idle" | "owned" | "pending" | "created";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-blue";

export function ClaimProfessionalButton({
  professionalId,
  professionalSlug,
  className,
  autoSubmit = false,
  checkStatus = false,
}: ClaimProfessionalButtonProps) {
  const router = useRouter();
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [uiState, setUiState] = useState<UiState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [managePath, setManagePath] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [yelp, setYelp] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const autoStarted = useRefOnce();

  useEffect(() => {
    if (!checkStatus) return;
    let cancelled = false;
    void getProfessionalClaimStateAction(professionalId, professionalSlug).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) return;
        if (result.state === "owned") {
          setUiState("owned");
          setManagePath(
            result.managePath ?? `/professional/${professionalSlug}/edit`,
          );
          return;
        }
        if (result.state === "pending") {
          setUiState("pending");
          setMessage(
            result.message ?? "Заявка уже отправлена и ждёт проверки.",
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [professionalId, professionalSlug, checkStatus]);

  function openForm() {
    setFormError(null);
    setFormOpen(true);
  }

  function submitClaim() {
    setFormError(null);
    const phoneTrim = phone.trim();
    if (!phoneTrim) {
      setFormError("Укажите телефон для связи.");
      return;
    }
    const proofLinks = [website, instagram, facebook, yelp]
      .map((v) => v.trim())
      .filter(Boolean);
    if (proofLinks.length === 0) {
      setFormError(
        "Добавьте хотя бы одну ссылку (сайт, Instagram, Facebook или Yelp).",
      );
      return;
    }

    startTransition(async () => {
      const result = await claimProfessionalAction(
        professionalId,
        professionalSlug,
        {
          phone: phoneTrim,
          website: website.trim() || null,
          instagramUrl: instagram.trim() || null,
          facebookUrl: facebook.trim() || null,
          yelpUrl: yelp.trim() || null,
          message: note.trim() || null,
        },
      );
      if (!result.ok) {
        if (result.state === "needs_auth" && result.loginPath) {
          router.push(result.loginPath);
          return;
        }
        setFormError(result.message);
        return;
      }

      if (result.state === "owned") {
        const path =
          result.managePath ?? `/professional/${professionalSlug}/edit`;
        setUiState("owned");
        setManagePath(path);
        setFormOpen(false);
        router.push(path);
        return;
      }

      setUiState(result.state === "created" ? "created" : "pending");
      setMessage(result.message);
      setFormOpen(false);
    });
  }

  useEffect(() => {
    if (!autoSubmit || autoStarted.current) return;
    autoStarted.current = true;
    openForm();
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
        Редактировать
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
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
          done
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
        )}
        disabled={pending || done}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!done) openForm();
        }}
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : null}
        {done ? "Заявка отправлена" : "Это мой профиль"}
      </button>
      {message && done ? (
        <p className="max-w-[16rem] text-xs text-slate-500">{message}</p>
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
          <button
            aria-label="Закрыть"
            className="absolute inset-0 cursor-default"
            type="button"
            onClick={() => setFormOpen(false)}
          />
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
            role="dialog"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900" id={titleId}>
                Подтвердите, что это вы
              </h2>
              <button
                aria-label="Закрыть"
                className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                type="button"
                onClick={() => setFormOpen(false)}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto px-4 py-4">
              <p className="text-sm text-slate-600">
                Укажите телефон и ссылки на ваши страницы — так мы быстрее
                проверим заявку.
              </p>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Телефон *</span>
                <input
                  className={inputClass}
                  placeholder="+1 …"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Сайт</span>
                <input
                  className={inputClass}
                  placeholder="https://…"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Instagram</span>
                <input
                  className={inputClass}
                  placeholder="https://instagram.com/…"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Facebook</span>
                <input
                  className={inputClass}
                  placeholder="https://facebook.com/…"
                  value={facebook}
                  onChange={(e) => setFacebook(e.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Yelp</span>
                <input
                  className={inputClass}
                  placeholder="https://yelp.com/…"
                  value={yelp}
                  onChange={(e) => setYelp(e.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Сообщение</span>
                <textarea
                  className={`${inputClass} min-h-[5rem]`}
                  placeholder="Кратко, почему это ваш профиль"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {formError ? (
                <p className="text-sm text-red-600">{formError}</p>
              ) : null}
            </div>
            <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
              <Button
                className="flex-1"
                disabled={pending}
                type="button"
                variant="secondary"
                onClick={() => setFormOpen(false)}
              >
                Отмена
              </Button>
              <Button
                className="flex-1"
                disabled={pending}
                type="button"
                onClick={submitClaim}
              >
                {pending ? "Отправка…" : "Отправить заявку"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useRefOnce() {
  const [ref] = useState(() => ({ current: false }));
  return ref;
}
