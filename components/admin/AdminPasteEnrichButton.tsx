"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  applyPasteEnrichAction,
  evaluatePasteAddressGeoAction,
  loadPasteEnrichExistingAction,
  readPasteEnrichImageAction,
  type PasteEnrichTargetKind,
} from "@/lib/admin/paste-enrich-actions";
import {
  buildPasteEnrichPreview,
  type PasteEnrichExisting,
  type PasteEnrichPreviewItem,
} from "@/lib/admin/paste-enrich";
import { parsePasteEnrichTextWithName } from "@/lib/admin/paste-enrich-name";
import {
  compressBusinessImage,
  formatBytes,
} from "@/lib/business/compress-image";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  kind: PasteEnrichTargetKind;
  entityId: string;
  slug?: string;
  className?: string;
  disabled?: boolean;
  /** Lens chip style vs secondary button (inbox). */
  variant?: "chip" | "button";
};

export function AdminPasteEnrichButton({
  kind,
  entityId,
  slug = "",
  className,
  disabled,
  variant = "chip",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [existing, setExisting] = useState<PasteEnrichExisting | null>(null);
  const [preview, setPreview] = useState<PasteEnrichPreviewItem[] | null>(null);
  /** Which «replace» rows the admin confirmed (address/city/…). */
  const [replaceKeys, setReplaceKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [compressHint, setCompressHint] = useState<string | null>(null);
  const [photoText, setPhotoText] = useState("");
  const [reading, setReading] = useState(false);
  const preparedRef = useRef<{ source: File; file: File } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingExisting(true);
    setError(null);
    setMessage(null);
    setPreview(null);
    setReplaceKeys(new Set());
    setPhotoText("");
    setCompressHint(null);
    preparedRef.current = null;
    void loadPasteEnrichExistingAction({ kind, id: entityId }).then((res) => {
      if (cancelled) return;
      setLoadingExisting(false);
      if (!res.ok) {
        setError(res.message);
        setExisting({});
        return;
      }
      setExisting(res.existing);
    });
    return () => {
      cancelled = true;
    };
  }, [open, kind, entityId]);

  async function runParse() {
    setError(null);
    setMessage(null);
    if (!text.trim() && !file) {
      setError("Вставьте текст или прикрепите фото.");
      setPreview(null);
      return;
    }

    let fromPhoto = photoText;
    if (file && !fromPhoto) {
      setReading(true);
      try {
        const prepared = await prepareFile(file);
        const fd = new FormData();
        fd.set("file", prepared);
        const res = await readPasteEnrichImageAction(fd);
        if (!res.ok) {
          setError(res.message);
          return;
        }
        fromPhoto = res.text;
        setPhotoText(fromPhoto);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не удалось прочитать фото.",
        );
        return;
      } finally {
        setReading(false);
      }
    }

    const combined = [text, fromPhoto]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
    const extracted = parsePasteEnrichTextWithName(combined);
    let addressGeo = null;
    if (extracted.addressLine) {
      setReading(true);
      try {
        const geoRes = await evaluatePasteAddressGeoAction({
          existing: existing ?? {},
          addressLine: extracted.addressLine,
          city: extracted.city,
          state: extracted.state,
          postalCode: extracted.postalCode,
        });
        if (geoRes.ok) addressGeo = geoRes.gate;
      } finally {
        setReading(false);
      }
    }
    const rows = buildPasteEnrichPreview(
      existing ?? {},
      extracted,
      Boolean(file),
      addressGeo,
    );
    if (rows.length === 0) {
      setError("В тексте ничего не распознано.");
      setPreview([]);
      setReplaceKeys(new Set());
      return;
    }
    setPreview(rows);
    // Never auto-check replaces — admin must tick «обновить».
    setReplaceKeys(new Set());
  }

  function toggleReplace(key: string) {
    setReplaceKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Compress once — the same file is reused for OCR and for upload. */
  async function prepareFile(source: File): Promise<File> {
    if (preparedRef.current?.source === source) {
      return preparedRef.current.file;
    }
    const compressed = await compressBusinessImage(source);
    preparedRef.current = { source, file: compressed.file };
    if (compressed.originalBytes > compressed.compressedBytes) {
      setCompressHint(
        `Фото: ${formatBytes(compressed.originalBytes)} → ${formatBytes(compressed.compressedBytes)}`,
      );
    }
    return compressed.file;
  }

  function runApply() {
    if (pending) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      let uploadFile = file;
      if (file) {
        try {
          uploadFile = await prepareFile(file);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Не удалось сжать изображение.",
          );
          return;
        }
      }

      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("id", entityId);
      if (slug) fd.set("slug", slug);
      fd.set("text", text);
      fd.set("photoText", photoText);
      for (const key of replaceKeys) {
        fd.append("applyReplaceKeys", key);
      }
      // Explicit empty list = no replaces (fill-empty only).
      if (replaceKeys.size === 0) fd.set("applyReplaceKeys", "");
      if (uploadFile) fd.set("file", uploadFile);
      const res = await applyPasteEnrichAction(fd);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message);
      setPreview(null);
      setReplaceKeys(new Set());
      setText("");
      setFile(null);
      setPhotoText("");
      preparedRef.current = null;
      router.refresh();
      const again = await loadPasteEnrichExistingAction({ kind, id: entityId });
      if (again.ok) setExisting(again.existing);
    });
  }

  return (
    <>
      {variant === "chip" ? (
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50",
            className,
          )}
          onClick={() => setOpen(true)}
        >
          <ClipboardPaste aria-hidden className="size-3.5" />
          Вставить текст
        </button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          className={cn(
            "min-h-10 w-full gap-1.5 sm:min-h-0 sm:w-auto",
            className,
          )}
          onClick={() => setOpen(true)}
        >
          <ClipboardPaste className="size-4" />
          Вставить текст
        </Button>
      )}

      {open ? (
        <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Вставить текст
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Один кусок текста (+ фото) → разберём сами. Потом можно снова
                  Обогатить.
                </p>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <textarea
                className="min-h-[9rem] w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  placeholder="Google Maps, Yelp («Yelp 4.1 (7 reviews)»), bio, контакты…"
                value={text}
                disabled={pending}
                onChange={(e) => {
                  setText(e.target.value);
                  setPreview(null);
                  setReplaceKeys(new Set());
                }}
              />

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Фото (необязательно)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-slate-800"
                  disabled={pending}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                    setReplaceKeys(new Set());
                    setCompressHint(null);
                    setPhotoText("");
                    preparedRef.current = null;
                  }}
                />
                {file ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {file.name}
                    {file.size > 0 ? ` · ${formatBytes(file.size)}` : ""}
                    {" · сожмём и прочитаем текст"}
                  </p>
                ) : null}
              </div>

              {reading ? (
                <p className="inline-flex items-center gap-2 text-xs text-slate-500">
                  <BrandPinLoader size="sm" />
                  Читаю текст с фото…
                </p>
              ) : null}

              {photoText ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                  <p className="text-xs font-medium text-slate-600">
                    Распознано на фото
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                    {photoText}
                  </p>
                </div>
              ) : null}

              {loadingExisting ? (
                <p className="inline-flex items-center gap-2 text-xs text-slate-500">
                  <BrandPinLoader size="sm" />
                  Загрузка карточки…
                </p>
              ) : null}

              {preview && preview.length > 0 ? (
                <ul className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm">
                  {preview.map((row) => {
                    const willReplace =
                      row.action === "replace" && replaceKeys.has(row.key);
                    return (
                      <li
                        key={`${row.key}-${row.action}`}
                        className="flex items-start justify-between gap-2"
                      >
                        <span className="min-w-0 text-slate-700">
                          <span className="font-medium">{row.label}</span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            {row.value}
                          </span>
                          {row.hint ? (
                            <span className="mt-0.5 block text-xs text-amber-700/90">
                              {row.hint}
                            </span>
                          ) : null}
                          {row.action === "replace" && row.currentValue ? (
                            <span className="mt-0.5 block truncate text-xs text-amber-700/90">
                              сейчас: {row.currentValue}
                            </span>
                          ) : null}
                        </span>
                        {row.action === "replace" ? (
                          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pt-0.5 text-xs font-medium text-amber-800">
                            <input
                              type="checkbox"
                              className="size-3.5 rounded border-slate-300"
                              checked={willReplace}
                              disabled={pending}
                              onChange={() => toggleReplace(row.key)}
                            />
                            обновить
                          </label>
                        ) : (
                          <span
                            className={
                              row.action === "add"
                                ? "shrink-0 text-xs font-medium text-emerald-700"
                                : "shrink-0 text-xs text-slate-400"
                            }
                          >
                            {row.action === "add" ? "добавим" : "уже есть"}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
                  {message}
                  {compressHint ? (
                    <span className="mt-0.5 block text-emerald-700/80">
                      {compressHint}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
              <Button
                type="button"
                variant="secondary"
                disabled={pending || loadingExisting || reading}
                onClick={() => void runParse()}
              >
                {reading ? "Читаю фото…" : "Разобрать"}
              </Button>
              <Button
                type="button"
                disabled={
                  pending ||
                  loadingExisting ||
                  reading ||
                  !preview ||
                  !preview.some(
                    (r) =>
                      r.action === "add" ||
                      (r.action === "replace" && replaceKeys.has(r.key)),
                  )
                }
                onClick={runApply}
              >
                {pending ? "Сохраняю…" : "Применить"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
