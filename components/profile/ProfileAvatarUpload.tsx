"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Camera } from "lucide-react";
import { uploadProfileAvatarAction } from "@/lib/profile/avatar-upload-action";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  displayTitle: string;
  avatarUrl: string | null;
};

export function ProfileAvatarUpload({ displayTitle, avatarUrl }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPick() {
    inputRef.current?.click();
  }

  function onChange(file: File | undefined) {
    if (!file) return;
    setError(null);
    const local = URL.createObjectURL(file);
    setPreview(local);

    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const result = await uploadProfileAvatarAction(fd);
      if (!result.ok) {
        setError(result.message);
        setPreview(avatarUrl);
        return;
      }
      if (result.avatarUrl) setPreview(result.avatarUrl);
    });
  }

  return (
    <div className="relative size-20 shrink-0 sm:size-24">
      <button
        aria-label="Загрузить фото"
        className="relative size-full overflow-hidden rounded-full bg-slate-100 ring-4 ring-white"
        disabled={pending}
        onClick={onPick}
        type="button"
      >
        {preview ? (
          <Image
            alt={displayTitle}
            className="object-cover"
            fill
            sizes="96px"
            src={preview}
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl font-semibold text-slate-400 sm:text-3xl">
            {displayTitle.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/45 py-1 text-[10px] font-medium text-white">
          {pending ? <BrandPinLoader size="sm" /> : <Camera className="size-3" />}
          Фото
        </span>
      </button>
      <input
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
      {error ? (
        <p className="absolute left-0 top-full z-10 mt-1 w-40 text-[11px] text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
