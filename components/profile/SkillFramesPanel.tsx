"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createSkillFrameAction,
  deleteSkillFrameAction,
  saveSkillFrameAction,
  setSkillFrameActiveAction,
  setSkillFrameShowPublicAction,
} from "@/lib/profile/skill-frame-actions";
import {
  createLocalSkillFrame,
  isSchemaMissingError,
  loadLocalSkillFrames,
  removeLocalSkillFrame,
  upsertLocalSkillFrame,
} from "@/lib/profile/skill-frames-local";
import type { ProfileSkillFrame } from "@/types/profile-cabinet";
import { cn } from "@/lib/utils";

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700">
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-8 rounded-full transition",
          checked ? "bg-brand-blue" : "bg-slate-300",
          disabled && "opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition",
            checked ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      <input
        checked={checked}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function SkillFrameEditor({
  frame,
  readOnly = false,
  localMode,
  userId,
  onLocalChange,
}: {
  frame: ProfileSkillFrame;
  readOnly?: boolean;
  localMode: boolean;
  userId: string;
  onLocalChange: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(frame.title);
  const [skills, setSkills] = useState(frame.skills);
  const [workplace, setWorkplace] = useState(frame.workplace ?? "");
  const [specialty, setSpecialty] = useState(frame.specialty ?? "");
  const [showPublic, setShowPublic] = useState(frame.showPublic);
  const [isActive, setIsActive] = useState(
    frame.isActive || frame.listingStatus === "active",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function persistLocal(patch: Partial<ProfileSkillFrame>) {
    const next: ProfileSkillFrame = {
      ...frame,
      title,
      skills,
      workplace: workplace.trim() || null,
      specialty: specialty.trim() || null,
      showPublic,
      isActive,
      updatedAt: new Date().toISOString(),
      ...patch,
    };
    upsertLocalSkillFrame(userId, next);
    onLocalChange();
  }

  function persistFields() {
    if (localMode || frame.id.startsWith("local-")) {
      persistLocal({});
      setMessage("Сохранено локально");
      return;
    }
    startTransition(async () => {
      const result = await saveSkillFrameAction({
        frameId: frame.id,
        title,
        skills,
        workplace,
        specialty,
      });
      setMessage(result.ok ? result.message ?? "Сохранено" : result.message);
      router.refresh();
    });
  }

  function onShow(next: boolean) {
    setShowPublic(next);
    if (localMode || frame.id.startsWith("local-")) {
      persistLocal({ showPublic: next });
      return;
    }
    startTransition(async () => {
      await saveSkillFrameAction({
        frameId: frame.id,
        title,
        skills,
        workplace,
        specialty,
      });
      const result = await setSkillFrameShowPublicAction(frame.id, next);
      if (!result.ok) {
        setShowPublic(!next);
        setMessage(result.message);
      }
      router.refresh();
    });
  }

  function onActive(next: boolean) {
    setIsActive(next);
    if (localMode || frame.id.startsWith("local-")) {
      persistLocal({ isActive: next });
      setMessage(
        next
          ? "Локальный режим: примените миграцию БД, чтобы создать объявление."
          : "Снято локально",
      );
      return;
    }
    startTransition(async () => {
      await saveSkillFrameAction({
        frameId: frame.id,
        title,
        skills,
        workplace,
        specialty,
      });
      const result = await setSkillFrameActiveAction(frame.id, next);
      if (!result.ok) {
        setIsActive(!next);
        setMessage(result.message);
        return;
      }
      setMessage(result.message ?? null);
      if (result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm("Удалить этот фрейм?")) return;
    if (localMode || frame.id.startsWith("local-")) {
      removeLocalSkillFrame(userId, frame.id);
      onLocalChange();
      return;
    }
    startTransition(async () => {
      const result = await deleteSkillFrameAction(frame.id);
      if (!result.ok) setMessage(result.message);
      router.refresh();
    });
  }

  if (readOnly) {
    return (
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-3 py-1.5">
          <h3 className="text-sm font-semibold text-slate-900">
            {frame.title || "Специальность"}
          </h3>
          {frame.specialty ? (
            <p className="truncate text-xs text-slate-500">{frame.specialty}</p>
          ) : null}
        </div>
        <div className="space-y-0.5 px-3 py-1.5 text-xs text-slate-700">
          {frame.skills ? (
            <p className="line-clamp-2 whitespace-pre-wrap">{frame.skills}</p>
          ) : null}
          {frame.workplace ? (
            <p className="truncate text-slate-500">
              Место работы: {frame.workplace}
            </p>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-1.5 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Объявление · навыки
          </p>
          <button
            aria-label="Удалить фрейм"
            className="inline-flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-red-600"
            disabled={pending}
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2">
          <label className="block space-y-0.5 text-xs sm:col-span-2">
            <span className="font-medium text-slate-700">Специальность</span>
            <input
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none ring-slate-900 focus:ring-1"
              maxLength={120}
              onBlur={persistFields}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Мастер маникюра"
              value={title}
            />
          </label>

          <label className="block space-y-0.5 text-xs sm:col-span-2">
            <span className="font-medium text-slate-700">Навыки</span>
            <textarea
              className="min-h-10 w-full resize-y rounded-md border border-slate-200 px-2 py-1 text-sm outline-none ring-slate-900 focus:ring-1"
              maxLength={4000}
              onBlur={persistFields}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Что умеете…"
              rows={2}
              value={skills}
            />
          </label>

          <label className="block space-y-0.5 text-xs">
            <span className="font-medium text-slate-700">Место работы</span>
            <input
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none ring-slate-900 focus:ring-1"
              maxLength={200}
              onBlur={persistFields}
              onChange={(e) => setWorkplace(e.target.value)}
              placeholder="Компания"
              value={workplace}
            />
          </label>
          <label className="block space-y-0.5 text-xs">
            <span className="font-medium text-slate-700">Должность</span>
            <input
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none ring-slate-900 focus:ring-1"
              maxLength={200}
              onBlur={persistFields}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="Роль"
              value={specialty}
            />
          </label>
        </div>

        {message ? (
          <p className="text-[11px] text-slate-500">{message}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-3 py-1">
        <Toggle
          checked={showPublic}
          disabled={pending}
          label="Показать"
          onChange={onShow}
        />
        <Toggle
          checked={isActive}
          disabled={pending}
          label="Актив"
          onChange={onActive}
        />
      </div>
    </article>
  );
}

type Props = {
  frames: ProfileSkillFrame[];
  editable: boolean;
  userId?: string | null;
};

export function SkillFramesPanel({ frames, editable, userId = null }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localFrames, setLocalFrames] = useState<ProfileSkillFrame[]>([]);
  const [localMode, setLocalMode] = useState(false);

  function reloadLocal() {
    if (!userId) return;
    setLocalFrames(loadLocalSkillFrames(userId));
  }

  useEffect(() => {
    if (!userId || !editable) return;
    const local = loadLocalSkillFrames(userId);
    setLocalFrames(local);
    if (frames.length === 0 && local.length > 0) {
      setLocalMode(true);
    }
  }, [userId, editable, frames.length]);

  const displayFrames =
    frames.length > 0
      ? frames
      : localFrames.length > 0
        ? localFrames
        : frames;

  function addFrame() {
    setError(null);
    startTransition(async () => {
      const result = await createSkillFrameAction();
      if (result.ok) {
        setLocalMode(false);
        router.refresh();
        return;
      }
      if (userId && isSchemaMissingError(result.message)) {
        createLocalSkillFrame(userId);
        setLocalMode(true);
        reloadLocal();
        setError(
          "Таблица в БД ещё не создана — фрейм сохранён локально в браузере. Для постоянной работы примените миграцию.",
        );
        return;
      }
      if (userId) {
        // Any DB failure during local testing → still allow adding
        createLocalSkillFrame(userId);
        setLocalMode(true);
        reloadLocal();
        setError(result.message);
        return;
      }
      setError(result.message);
    });
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          Специальности и навыки
        </h2>
        {editable ? (
          <button
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            disabled={pending}
            onClick={addFrame}
            type="button"
          >
            <Plus className="size-3.5" />
            Добавить
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-amber-700">{error}</p> : null}
      {localMode && editable ? (
        <p className="text-[11px] text-slate-500">
          Локальный режим (без таблицы в БД). Данные только в этом браузере.
        </p>
      ) : null}

      {displayFrames.length === 0 ? (
        <p className="text-xs text-slate-500">
          {editable
            ? "Добавьте фрейм со специальностью и навыками."
            : "Пока нет опубликованных навыков."}
        </p>
      ) : (
        <div className="space-y-2">
          {displayFrames.map((frame) => (
            <SkillFrameEditor
              frame={frame}
              key={frame.id}
              localMode={localMode || frame.id.startsWith("local-")}
              onLocalChange={reloadLocal}
              readOnly={!editable}
              userId={userId ?? frame.userId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
