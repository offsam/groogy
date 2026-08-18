"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircleQuestion, TriangleAlert } from "lucide-react";
import { KrugiPinIcon } from "@/components/brand/KrugiPinIcon";
import { SupportRequestModal } from "@/components/support/SupportRequestModal";
import { cn } from "@/lib/utils";

type ModalKind = "error" | "question" | null;

/**
 * Header trigger replacing the old floating "Ошибка" button — same glass
 * pin style as the profile/logout icons next to it. Opens a small menu
 * with the two general (not entity-specific) request types; per-card
 * complaints live in ReportEntityButton instead.
 */
export function HeaderSupportButton() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (pathname?.startsWith("/admin")) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={menuOpen}
        aria-label="Поддержка"
        className="inline-flex shrink-0 transition hover:opacity-90"
        title="Поддержка"
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <KrugiPinIcon className="size-9 sm:size-10" name="help" />
      </button>

      {menuOpen ? (
        <div
          className="absolute right-0 top-full z-[1900] mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          role="menu"
        >
          <button
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50",
            )}
            role="menuitem"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModalKind("error");
            }}
          >
            <TriangleAlert aria-hidden="true" className="size-4 text-brand-red" />
            Сообщить об ошибке
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            role="menuitem"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModalKind("question");
            }}
          >
            <MessageCircleQuestion aria-hidden="true" className="size-4 text-brand-blue" />
            Задать вопрос
          </button>
        </div>
      ) : null}

      {modalKind === "error" ? (
        <SupportRequestModal
          description="Опишите, что пошло не так. Мы увидим страницу, на которой вы сейчас находитесь."
          open
          placeholder="Например: не открываются контакты / карта пустая / опечатка…"
          reportType="error"
          title="Сообщить об ошибке"
          onClose={() => setModalKind(null)}
        />
      ) : null}

      {modalKind === "question" ? (
        <SupportRequestModal
          description="Спросите что угодно о платформе — мы ответим."
          open
          placeholder="Например: как разместить объявление / как подтвердить бизнес…"
          reportType="question"
          title="Задать вопрос"
          onClose={() => setModalKind(null)}
        />
      ) : null}
    </div>
  );
}
