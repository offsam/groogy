"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { patchBusinessProfileAction } from "@/lib/business/owner-actions";
import { uploadBusinessCoverAction } from "@/lib/business/cover-upload-action";
import {
  compressBusinessImage,
  formatBytes,
  type CompressedImage,
} from "@/lib/business/compress-image";
import { SectionEditDialog } from "@/components/business/profile/edit/SectionEditDialog";

type EditPhotoDialogProps = {
  businessId: string;
  businessSlug: string;
  open: boolean;
  onClose: () => void;
  imageUrl: string | null;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-blue";

export function EditPhotoDialog({
  businessId,
  businessSlug,
  open,
  onClose,
  imageUrl,
}: EditPhotoDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(imageUrl ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const [compressed, setCompressed] = useState<CompressedImage | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [mode, setMode] = useState<"file" | "url">("file");

  async function onPickFile(file: File | null) {
    setError(null);
    setCompressed(null);
    if (preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    }
    if (!file) return;

    setCompressing(true);
    try {
      const result = await compressBusinessImage(file);
      setCompressed(result);
      setPreview(URL.createObjectURL(result.blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сжать фото.");
    } finally {
      setCompressing(false);
    }
  }

  return (
    <SectionEditDialog
      error={error}
      open={open}
      pending={pending || compressing}
      title="Фото"
      onClose={() => {
        if (preview) URL.revokeObjectURL(preview);
        onClose();
      }}
      onSave={() => {
        setError(null);
        startTransition(async () => {
          if (mode === "file") {
            if (!compressed) {
              setError("Выберите фото для загрузки.");
              return;
            }
            const formData = new FormData();
            formData.set("file", compressed.file);
            const result = await uploadBusinessCoverAction({
              businessId,
              businessSlug,
              formData,
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
          } else {
            const result = await patchBusinessProfileAction({
              businessId,
              businessSlug,
              patch: { imageUrl: url },
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
          }
          if (preview) URL.revokeObjectURL(preview);
          onClose();
          router.refresh();
        });
      }}
    >
      <div className="mb-3 flex rounded-xl border border-slate-200 p-0.5 text-sm">
        <button
          className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${
            mode === "file"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}
          style={mode === "file" ? { color: "#ffffff" } : undefined}
          type="button"
          onClick={() => setMode("file")}
        >
          Загрузить файл
        </button>
        <button
          className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${
            mode === "url"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}
          style={mode === "url" ? { color: "#ffffff" } : undefined}
          type="button"
          onClick={() => setMode("url")}
        >
          По ссылке
        </button>
      </div>

      {mode === "file" ? (
        <div className="space-y-3">
          <Field label="Фото с устройства">
            <input
              accept="image/jpeg,image/png,image/webp,image/*"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-blue/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-blue-deep"
              type="file"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          {compressing ? (
            <p className="text-sm text-slate-500">Сжимаем без потери качества…</p>
          ) : null}
          {compressed ? (
            <p className="text-xs text-slate-500">
              Было {formatBytes(compressed.originalBytes)} → стало{" "}
              {formatBytes(compressed.compressedBytes)}
              {compressed.originalBytes > compressed.compressedBytes
                ? ` (−${Math.round(
                    (1 - compressed.compressedBytes / compressed.originalBytes) *
                      100,
                  )}%)`
                : null}
              , {compressed.width}×{compressed.height}
            </p>
          ) : null}
          {(preview || imageUrl) && (
            <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Превью"
                className="h-full w-full object-cover"
                src={preview || imageUrl || ""}
              />
            </div>
          )}
          <p className="text-xs text-slate-500">
            Фото автоматически уменьшается до 2048px и сжимается в WebP так, чтобы
            файл был маленьким, а картинка оставалась чёткой.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Field label="URL изображения">
            <input
              className={inputClass}
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
        </div>
      )}
    </SectionEditDialog>
  );
}
