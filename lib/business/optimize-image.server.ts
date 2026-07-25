import "server-only";

import sharp from "sharp";

export const BUSINESS_IMAGES_BUCKET = "business-images";
export const BUSINESS_COVER_MAX_EDGE = 2048;
export const BUSINESS_COVER_TARGET_BYTES = 700 * 1024;
export const BUSINESS_COVER_MIN_QUALITY = 78;
export const BUSINESS_COVER_MAX_QUALITY = 90;
export const BUSINESS_COVER_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export function businessCoverStoragePrefix(businessId: string): string {
  return `covers/${businessId}/`;
}

export type OptimizedCover = {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  bytes: number;
};

/**
 * Server-side recompress: WebP, max edge 2048, high quality floor.
 * Guarantees size/format even if the client skipped compression.
 */
export async function optimizeBusinessCover(
  input: Buffer,
): Promise<OptimizedCover> {
  const base = sharp(input, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error("Некорректное изображение.");
  }

  let quality = BUSINESS_COVER_MAX_QUALITY;
  let buffer = await base
    .clone()
    .resize({
      width: BUSINESS_COVER_MAX_EDGE,
      height: BUSINESS_COVER_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 6 })
    .toBuffer();

  while (
    buffer.length > BUSINESS_COVER_TARGET_BYTES &&
    quality > BUSINESS_COVER_MIN_QUALITY
  ) {
    quality = Math.max(BUSINESS_COVER_MIN_QUALITY, quality - 4);
    buffer = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({
        width: BUSINESS_COVER_MAX_EDGE,
        height: BUSINESS_COVER_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 6 })
      .toBuffer();
  }

  const outMeta = await sharp(buffer).metadata();
  return {
    buffer,
    contentType: "image/webp",
    width: outMeta.width ?? width,
    height: outMeta.height ?? height,
    bytes: buffer.length,
  };
}

/** Extract storage object path from a public business-images URL, if any. */
export function businessCoverPathFromPublicUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUSINESS_IMAGES_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0] ?? "");
  return path.startsWith("covers/") ? path : null;
}
