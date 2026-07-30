"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, Loader2, X } from "lucide-react";
import { submitErrorReportAction } from "@/lib/error-reports/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "krugi-error-report-tucked";
const FRAME_PARAM = "mobileFrame";
const DRAG_TUCK_PX = 48;

function isFrameEmbed(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(FRAME_PARAM) === "1";
}

/**
 * Small red floating «Ошибка» FAB — always on public pages.
 * Can be slid off the right edge; a faint arrow peeks to restore it.
 */
export function ErrorReportButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const titleId = useId();
  const dragRef = useRef<{
    startX: number;
    dragging: boolean;
    moved: boolean;
  } | null>(null);

  const [ready, setReady] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [tucked, setTucked] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (isFrameEmbed()) {
      setEmbedded(true);
      setReady(true);
      return;
    }
    setTucked(window.localStorage.getItem(STORAGE_KEY) === "1");
    setReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function persistTucked(next: boolean) {
    setTucked(next);
    setDragOffset(0);
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (tucked) return;
    dragRef.current = {
      startX: e.clientX,
      dragging: true,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    if (!state?.dragging) return;
    const dx = Math.max(0, e.clientX - state.startX);
    if (dx > 6) state.moved = true;
    setDragOffset(dx);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragRef.current;
    dragRef.current = null;
    if (!state?.dragging) return;

    const dx = Math.max(0, e.clientX - state.startX);
    if (dx >= DRAG_TUCK_PX) {
      persistTucked(true);
      return;
    }

    setDragOffset(0);
    if (!state.moved) {
      setError(null);
      setSuccess(null);
      setOpen(true);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const qs = searchParams?.toString();
    const pagePath = qs ? `${pathname}?${qs}` : pathname || "/";
    const pageUrl =
      typeof window !== "undefined" ? window.location.href : null;

    startTransition(async () => {
      const result = await submitErrorReportAction({
        message,
        pagePath,
        pageUrl,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message ?? "Спасибо! Сообщение отправлено.");
      setMessage("");
      window.setTimeout(() => setOpen(false), 900);
    });
  }

  if (!ready || embedded) return null;
  if (pathname?.startsWith("/admin")) return null;

  return (
    <>
      {tucked ? (
        <button
          aria-label="Показать кнопку ошибки"
          className="fixed top-1/2 right-0 z-[1900] flex h-14 w-5 -translate-y-1/2 items-center justify-center rounded-l-md bg-slate-900/10 text-slate-500/70 backdrop-blur-[1px] transition hover:bg-brand-red/15 hover:text-brand-red"
          type="button"
          onClick={() => persistTucked(false)}
        >
          <ChevronLeft aria-hidden="true" className="size-3.5" />
        </button>
      ) : (
        <button
          aria-label="Сообщить об ошибке"
          className={cn(
            "fixed right-3 bottom-24 z-[1900] flex size-11 touch-none items-center justify-center rounded-full bg-brand-red text-[10px] font-semibold leading-tight text-white shadow-md shadow-brand-red/25 transition-opacity select-none",
            "opacity-70 hover:opacity-100 active:scale-95",
            "sm:bottom-28",
          )}
          style={{
            transform: dragOffset
              ? `translateX(${dragOffset}px)`
              : undefined,
            opacity: dragOffset
              ? Math.max(0.25, 0.7 - dragOffset / 180)
              : undefined,
          }}
          type="button"
          onPointerCancel={() => {
            dragRef.current = null;
            setDragOffset(0);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          Ошибка
        </button>
      )}

      {open ? (
        <div className="fixed inset-0 z-[1950] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
          <button
            aria-label="Закрыть"
            className="absolute inset-0 cursor-default"
            type="button"
            onClick={() => setOpen(false)}
          />
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h2
                  className="text-base font-semibold text-slate-900"
                  id={titleId}
                >
                  Сообщить об ошибке
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Опишите, что пошло не так. Мы увидим страницу, на которой вы
                  сейчас находитесь.
                </p>
              </div>
              <button
                aria-label="Закрыть"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                type="button"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <form className="space-y-3 overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
              {error ? <AuthAlert>{error}</AuthAlert> : null}
              {success ? <AuthAlert tone="success">{success}</AuthAlert> : null}

              <label className="block space-y-1.5 text-sm" htmlFor="error-report-message">
                <span className="font-medium text-slate-700">Что случилось?</span>
                <textarea
                  autoFocus
                  className="min-h-28 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
                  id="error-report-message"
                  maxLength={4000}
                  name="message"
                  placeholder="Например: не открываются контакты / карта пустая / опечатка…"
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>

              <p className="truncate text-xs text-slate-400">
                Страница: {pathname || "/"}
                {searchParams?.toString() ? `?${searchParams.toString()}` : ""}
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  className="gap-2 disabled:opacity-60"
                  disabled={pending || message.trim().length < 3}
                  type="submit"
                >
                  {pending ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : null}
                  Отправить
                </Button>
                <Button
                  disabled={pending}
                  type="button"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                >
                  Отмена
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
