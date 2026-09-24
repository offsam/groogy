"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Camera } from "lucide-react";
import { uploadProfileCoverAction } from "@/lib/profile/cover-upload-action";
import {
  ProfileCoverCropDialog,
} from "@/components/profile/ProfileCoverCropDialog";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";
import { cn } from "@/lib/utils";

const LOCAL_KEY = "kroogy.profile_cover.";

type Props = {
  coverUrl: string | null;
  editable: boolean;
  userId?: string | null;
  className?: string;
};

export function ProfileCoverBanner({
  coverUrl,
  editable,
  userId = null,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(coverUrl);
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  useEffect(() => {
    if (coverUrl) {
      setPreview(coverUrl);
      setBroken(false);
      return;
    }
    if (userId && typeof window !== "undefined") {
      const local = localStorage.getItem(LOCAL_KEY + userId);
      if (local) {
        setPreview(local);
        setBroken(false);
      }
    }
  }, [coverUrl, userId]);

  function onPick() {
    if (!editable || pending) return;
    inputRef.current?.click();
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBroken(false);
    const url = URL.createObjectURL(file);
    setCropSrc(url);
    if (inputRef.current) inputRef.current.value = "";
  }

  function closeCrop() {
    if (cropSrc?.startsWith("blob:")) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  function onCropConfirm(blob: Blob) {
    const localPreview = URL.createObjectURL(blob);
    setPreview(localPreview);
    setBroken(false);
    closeCrop();

    const fd = new FormData();
    fd.set(
      "file",
      new File([blob], "cover.webp", {
        type: blob.type || "image/webp",
      }),
    );
    startTransition(async () => {
      const result = await uploadProfileCoverAction(fd);
      if (!result.ok) {
        setError(result.message);
        setPreview(coverUrl);
        return;
      }
      if (result.coverUrl) {
        setPreview(result.coverUrl);
        if (userId) {
          localStorage.setItem(LOCAL_KEY + userId, result.coverUrl);
        }
      }
    });
  }

  const showImage = Boolean(preview) && !broken;

  return (
    <div className={cn("relative h-28 w-full sm:h-36", className)}>
      {showImage ? (
        <Image
          alt=""
          className="object-cover"
          fill
          sizes="(max-width: 768px) 100vw, 800px"
          src={preview!}
          unoptimized
          onError={() => setBroken(true)}
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-brand-yellow via-brand-orange to-brand-blue"
        />
      )}

      {editable ? (
        <>
          <button
            aria-label="Загрузить баннер"
            className="absolute bottom-2 right-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-black/50 px-3 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/65"
            disabled={pending}
            onClick={onPick}
            type="button"
          >
            {pending ? (
              <BrandPinLoader size="sm" />
            ) : (
              <Camera className="size-3.5" />
            )}
            Фон
          </button>
          <input
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
            ref={inputRef}
            type="file"
          />
          {error ? (
            <p className="absolute bottom-2 left-2 max-w-[60%] rounded bg-white/90 px-2 py-1 text-[11px] text-red-600">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {cropSrc ? (
        <ProfileCoverCropDialog
          imageSrc={cropSrc}
          open
          pending={pending}
          onCancel={closeCrop}
          onConfirm={onCropConfirm}
        />
      ) : null}
    </div>
  );
}
