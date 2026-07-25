/**
 * Browser-side image compression for business uploads.
 * Caps dimensions and encodes WebP (or JPEG fallback) at high visual quality
 * while shrinking file size as much as practical.
 */

export type CompressedImage = {
  blob: Blob;
  file: File;
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
  mimeType: string;
};

const MAX_EDGE_PX = 2048;
/** Target upper size after encode — keep dropping quality until under this. */
const TARGET_MAX_BYTES = 700 * 1024;
/** Never go below this — visually near-lossless for photos. */
const MIN_QUALITY = 0.78;
const MAX_QUALITY = 0.92;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

function supportsWebpEncode(): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Не удалось сжать изображение."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function fitSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return { width, height };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Compress an image file for business cover upload.
 * Uses WebP when available; otherwise JPEG. Quality stays high (≥ 0.78).
 */
export async function compressBusinessImage(
  file: File,
): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Выберите файл изображения.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("Файл больше 25 МБ. Выберите фото меньшего размера.");
  }

  const img = await loadImage(file);
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, MAX_EDGE_PX);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не поддерживает сжатие изображений.");
  ctx.drawImage(img, 0, 0, width, height);

  const useWebp = supportsWebpEncode();
  const mimeType = useWebp ? "image/webp" : "image/jpeg";
  const ext = useWebp ? "webp" : "jpg";

  let quality = MAX_QUALITY;
  let blob = await canvasToBlob(canvas, mimeType, quality);

  // Binary-ish step-down: shrink until under target or floor quality.
  while (blob.size > TARGET_MAX_BYTES && quality > MIN_QUALITY + 0.01) {
    quality = Math.max(MIN_QUALITY, quality - 0.04);
    blob = await canvasToBlob(canvas, mimeType, quality);
  }

  const outName = file.name.replace(/\.[^.]+$/, "") || "cover";
  const outFile = new File([blob], `${outName}.${ext}`, {
    type: mimeType,
    lastModified: Date.now(),
  });

  return {
    blob,
    file: outFile,
    width,
    height,
    originalBytes: file.size,
    compressedBytes: blob.size,
    mimeType,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
