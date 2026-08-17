import { cn } from "@/lib/utils";

function formatRouteDate(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

/** Dotted route: circles between departure and arrival. */
export function LechuRouteDots({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex min-w-[4.5rem] items-center justify-center gap-1 px-1 sm:min-w-[5.5rem] sm:gap-1.5",
        className,
      )}
    >
      <span className="size-2.5 shrink-0 rounded-full bg-brand-blue" />
      <span className="h-px min-w-3 flex-1 bg-slate-300" />
      <span className="size-1.5 shrink-0 rounded-full bg-slate-300" />
      <span className="h-px min-w-3 flex-1 bg-slate-300" />
      <span className="size-1.5 shrink-0 rounded-full bg-slate-300" />
      <span className="h-px min-w-3 flex-1 bg-slate-300" />
      <span className="size-2.5 shrink-0 rounded-full bg-brand-green" />
    </div>
  );
}

type LechuRoutePlaqueProps = {
  departure: string;
  destination: string;
  /** Only departure date exists in schema today. */
  departureDate?: string | null;
  arrivalDate?: string | null;
  className?: string;
  /** Larger type for profile header. */
  size?: "card" | "profile";
};

/**
 * Left: city + date · route dots · Right: city + date.
 * Card face for «Лечу»; detail (who posted, etc.) lives behind the click.
 */
export function LechuRoutePlaque({
  departure,
  destination,
  departureDate,
  arrivalDate = null,
  className,
  size = "card",
}: LechuRoutePlaqueProps) {
  const depDate = formatRouteDate(departureDate);
  const arrDate = formatRouteDate(arrivalDate);
  const cityClass =
    size === "profile"
      ? "text-base font-semibold text-slate-900 sm:text-lg"
      : "text-sm font-semibold text-slate-900";
  const dateClass =
    size === "profile"
      ? "mt-1 text-sm text-slate-500"
      : "mt-0.5 text-xs text-slate-500";

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3",
        className,
      )}
    >
      <div className="min-w-0 text-left">
        <p className={cn(cityClass, "line-clamp-2 break-words")}>{departure}</p>
        <p className={dateClass}>{depDate ?? "дата не указана"}</p>
      </div>
      <LechuRouteDots />
      <div className="min-w-0 text-right">
        <p className={cn(cityClass, "line-clamp-2 break-words")}>
          {destination}
        </p>
        <p className={dateClass}>{arrDate ?? "\u00a0"}</p>
      </div>
    </div>
  );
}
