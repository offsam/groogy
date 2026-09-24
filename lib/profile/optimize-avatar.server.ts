import "server-only";

import sharp from "sharp";

export const PROFILE_AVATARS_BUCKET = "profile-avatars";
export const PROFILE_AVATAR_MAX_EDGE = 512;
export const PROFILE_AVATAR_TARGET_BYTES = 180 * 1024;
export const PROFILE_AVATAR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const PROFILE_COVER_MAX_WIDTH = 1600;
export const PROFILE_COVER_MAX_HEIGHT = 480;
export const PROFILE_COVER_TARGET_BYTES = 350 * 1024;
export const PROFILE_COVER_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export function profileAvatarStoragePrefix(userId: string): string {
  return `avatars/${userId}/`;
}

export function profileCoverStoragePrefix(userId: string): string {
  return `covers/${userId}/`;
}

export function profileAvatarPathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const marker = `/${PROFILE_AVATARS_BUCKET}/`;
    const idx = parsed.pathname.indexOf(marker);
    if (idx < 0) return null;
    return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

export type OptimizedAvatar = {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  bytes: number;
};

export async function optimizeProfileAvatar(
  input: Buffer,
): Promise<OptimizedAvatar> {
  const base = sharp(input, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error("Некорректное изображение.");
  }

  const edge = Math.min(PROFILE_AVATAR_MAX_EDGE, Math.max(width, height));
  let quality = 88;
  let buffer = await base
    .clone()
    .resize(edge, edge, { fit: "cover", position: "attention" })
    .webp({ quality })
    .toBuffer();

  while (buffer.byteLength > PROFILE_AVATAR_TARGET_BYTES && quality > 70) {
    quality -= 4;
    buffer = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(edge, edge, { fit: "cover", position: "attention" })
      .webp({ quality })
      .toBuffer();
  }

  const outMeta = await sharp(buffer).metadata();
  return {
    buffer,
    contentType: "image/webp",
    width: outMeta.width ?? edge,
    height: outMeta.height ?? edge,
    bytes: buffer.byteLength,
  };
}

/**
 * Recompress an already-cropped cover. Client sends the selected fragment;
 * we only resize/compress — no extra attention-crop that would shift framing.
 */
export async function optimizeProfileCover(
  input: Buffer,
): Promise<OptimizedAvatar> {
  const base = sharp(input, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error("Некорректное изображение.");
  }

  let quality = 86;
  let buffer = await base
    .clone()
    .resize(PROFILE_COVER_MAX_WIDTH, PROFILE_COVER_MAX_HEIGHT, {
      fit: "fill",
    })
    .webp({ quality })
    .toBuffer();

  while (buffer.byteLength > PROFILE_COVER_TARGET_BYTES && quality > 70) {
    quality -= 4;
    buffer = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(PROFILE_COVER_MAX_WIDTH, PROFILE_COVER_MAX_HEIGHT, {
        fit: "fill",
      })
      .webp({ quality })
      .toBuffer();
  }

  const outMeta = await sharp(buffer).metadata();
  return {
    buffer,
    contentType: "image/webp",
    width: outMeta.width ?? PROFILE_COVER_MAX_WIDTH,
    height: outMeta.height ?? PROFILE_COVER_MAX_HEIGHT,
    bytes: buffer.byteLength,
  };
}
