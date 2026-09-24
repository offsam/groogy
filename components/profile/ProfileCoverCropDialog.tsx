"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

/** Banner aspect — matches server cover output 1600×480. */
export const COVER_CROP_ASPECT = 1600 / 480;

type Props = {
  imageSrc: string;
  open: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
};

type Size = { w: number; h: number };

/**
 * Fixed-aspect crop: drag to pan, slider to zoom.
 * Exports only the visible crop as a webp/jpeg blob.
 */
export function ProfileCoverCropDialog({
  imageSrc,
  open,
  pending = false,
  onCancel,
  onConfirm,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [viewport, setViewport] = useState<Size>({ w: 320, h: 96 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const img = new Image();
    img.onload = () => {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setZoom(1);
    };
    img.src = imageSrc;
  }, [imageSrc, open]);

  useEffect(() => {
    if (!natural || viewport.w <= 0) return;
    const scale = Math.max(viewport.w / natural.w, viewport.h / natural.h) * zoom;
    const dw = natural.w * scale;
    const dh = natural.h * scale;
    setOffset({
      x: (viewport.w - dw) / 2,
      y: (viewport.h - dh) / 2,
    });
    // Only recenter when image or viewport first ready / zoom reset to 1 from new image
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: center on new natural size
  }, [natural, viewport.w, viewport.h]);

  useEffect(() => {
    if (!open) return;
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setViewport({ w, h: Math.round(w / COVER_CROP_ASPECT) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const coverScale = (() => {
    if (!natural || viewport.w <= 0) return 1;
    return Math.max(viewport.w / natural.w, viewport.h / natural.h);
  })();

  const displayScale = coverScale * zoom;
  const displayW = natural ? natural.w * displayScale : 0;
  const displayH = natural ? natural.h * displayScale : 0;

  const clampOffset = useCallback(
    (x: number, y: number, z = zoom) => {
      if (!natural) return { x: 0, y: 0 };
      const scale = coverScale * z;
      const dw = natural.w * scale;
      const dh = natural.h * scale;
      const minX = Math.min(0, viewport.w - dw);
      const minY = Math.min(0, viewport.h - dh);
      return {
        x: Math.min(0, Math.max(minX, x)),
        y: Math.min(0, Math.max(minY, y)),
      };
    },
    [natural, coverScale, zoom, viewport.w, viewport.h],
  );

  useEffect(() => {
    setOffset((prev) => clampOffset(prev.x, prev.y, zoom));
  }, [zoom, clampOffset]);

  function onPointerDown(e: React.PointerEvent) {
    if (pending || exporting) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(
      clampOffset(dragRef.current.originX + dx, dragRef.current.originY + dy),
    );
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function confirm() {
    if (!natural || !imgRef.current) return;
    setExporting(true);
    try {
      const scale = coverScale * zoom;
      const sx = Math.max(0, -offset.x / scale);
      const sy = Math.max(0, -offset.y / scale);
      const sw = Math.min(natural.w - sx, viewport.w / scale);
      const sh = Math.min(natural.h - sy, viewport.h / scale);

      const outW = 1600;
      const outH = Math.round(outW / COVER_CROP_ASPECT);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");

      ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, outW, outH);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.92),
      );
      if (!blob) {
        const jpeg = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.92),
        );
        if (!jpeg) throw new Error("export");
        onConfirm(jpeg);
        return;
      }
      onConfirm(blob);
    } catch {
      // keep dialog open
    } finally {
      setExporting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/55 p-3 sm:items-center"
      role="dialog"
      aria-modal
      aria-label="Обрезка фона"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            Выберите область фона
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Перетащите фото и измените масштаб. Сохранится только выбранный
            фрагмент.
          </p>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div
            ref={viewportRef}
            className="relative w-full cursor-grab touch-none overflow-hidden rounded-xl bg-slate-900 active:cursor-grabbing"
            style={{ height: viewport.h || 96 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              alt=""
              draggable={false}
              src={imageSrc}
              className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
              style={{
                width: displayW || undefined,
                height: displayH || undefined,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/80"
            />
          </div>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Масштаб</span>
            <input
              className="w-full accent-brand-blue"
              disabled={pending || exporting}
              max={3}
              min={1}
              onChange={(e) => setZoom(Number(e.target.value))}
              step={0.01}
              type="range"
              value={zoom}
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <button
            className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-white"
            disabled={pending || exporting}
            onClick={onCancel}
            type="button"
          >
            Отмена
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-blue px-4 text-sm font-medium text-white disabled:opacity-60"
            disabled={pending || exporting || !natural}
            onClick={() => void confirm()}
            style={{ color: "#ffffff" }}
            type="button"
          >
            {pending || exporting ? <BrandPinLoader size="sm" /> : null}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
