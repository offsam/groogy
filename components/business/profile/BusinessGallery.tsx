import Image from "next/image";
import { Images } from "lucide-react";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import { cn } from "@/lib/utils";

type BusinessGalleryProps = {
  name: string;
  images: string[];
  /** Business logo URL when available; otherwise shows «Лого». */
  logoUrl?: string | null;
  /** Drop horizontal inset (admin preview on phone). */
  flush?: boolean;
  className?: string;
};

function GalleryLogoBadge({
  logoUrl,
  className,
}: {
  logoUrl?: string | null;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-2.5 top-2.5 z-[1] flex size-14 items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_2px_12px_rgba(15,23,42,0.2)] ring-1 ring-black/[0.06] sm:left-3 sm:top-3 sm:size-16",
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="h-full w-full object-cover" src={logoUrl} />
      ) : (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:text-xs">
          Лого
        </span>
      )}
    </div>
  );
}

export function BusinessGallery({
  name,
  images,
  logoUrl = null,
  flush = false,
  className,
}: BusinessGalleryProps) {
  const photos = images.filter((url) => hasRealBusinessPhoto(url));
  const main = photos[0] ?? null;
  const side = photos.slice(1, 4);
  const extraCount = Math.max(0, photos.length - 4);

  if (!main) {
    return (
      <div
        className={cn(
          "relative flex aspect-[16/10] items-center justify-center bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 text-sm text-slate-300 sm:aspect-[21/9] sm:rounded-2xl",
          className,
        )}
      >
        <GalleryLogoBadge logoUrl={logoUrl} />
        Нет фото
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      {/* Mobile: hero + thumb strip */}
      <div className="sm:hidden">
        <div
          className={cn(
            "relative aspect-[16/11] overflow-hidden rounded-xl bg-slate-100",
            flush ? "mx-0" : "mx-4",
          )}
        >
          <Image
            alt={name}
            className="object-cover"
            fill
            priority
            sizes="100vw"
            src={main}
            unoptimized
          />
          <GalleryLogoBadge logoUrl={logoUrl} />
        </div>
        {side.length > 0 ? (
          <div
            className={cn(
              "mt-1.5 grid grid-cols-3 gap-1.5",
              flush ? "px-0" : "px-4",
            )}
          >
            {side.map((url, i) => (
              <div
                key={`${url}-${i}`}
                className="relative aspect-square overflow-hidden rounded-lg bg-slate-100"
              >
                <Image
                  alt=""
                  className="object-cover"
                  fill
                  sizes="33vw"
                  src={url}
                  unoptimized
                />
                {i === side.length - 1 && extraCount > 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-sm font-semibold text-white">
                    +{extraCount}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Desktop / tablet: 1 large + up to 3 stacked */}
      <div className="hidden gap-1.5 sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] sm:rounded-2xl sm:overflow-hidden">
        <div className="relative min-h-[220px] overflow-hidden bg-slate-100 md:min-h-[280px]">
          <Image
            alt={name}
            className="object-cover"
            fill
            priority
            sizes="(max-width: 1024px) 65vw, 700px"
            src={main}
            unoptimized
          />
          <GalleryLogoBadge logoUrl={logoUrl} />
        </div>
        <div
          className={cn(
            "grid gap-1.5",
            side.length <= 1 ? "grid-rows-1" : side.length === 2 ? "grid-rows-2" : "grid-rows-3",
          )}
        >
          {(side.length > 0 ? side : [main]).map((url, i) => (
            <div
              key={`${url}-d-${i}`}
              className="relative min-h-[70px] overflow-hidden bg-slate-100 md:min-h-[90px]"
            >
              <Image
                alt=""
                className="object-cover"
                fill
                sizes="(max-width: 1024px) 35vw, 320px"
                src={url}
                unoptimized
              />
              {i === Math.min(side.length, 3) - 1 && extraCount > 0 ? (
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-slate-950/55 text-sm font-semibold text-white">
                  <Images aria-hidden="true" className="size-4" />
                  +{extraCount}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
