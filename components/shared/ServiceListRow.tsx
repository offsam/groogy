import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ServiceListRowProps = {
  title: string;
  price: string;
  href?: string | null;
  subtitle?: string | null;
  className?: string;
};

/**
 * Compact profile service tile (no photo): title + $price / $уточняйте.
 * Detail pages keep photos and fuller copy.
 */
export function ServiceListRow({
  title,
  price,
  href,
  subtitle,
  className,
}: ServiceListRowProps) {
  const body = (
    <>
      <div className="min-h-0 flex-1">
        <p className="line-clamp-3 text-sm font-medium leading-snug text-slate-900">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">
            {subtitle}
          </p>
        ) : null}
      </div>
      <p className="mt-2 shrink-0 text-sm font-semibold tabular-nums text-slate-900">
        {price}
      </p>
    </>
  );

  const shell = cn(
    "flex aspect-square w-[calc(50%-0.25rem)] max-w-[9rem] flex-col rounded-xl border border-slate-200 bg-white p-2.5 sm:w-[7.75rem] sm:max-w-none",
    href
      ? "transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
      : null,
    className,
  );

  if (href) {
    return (
      <Link className={shell} href={href}>
        {body}
      </Link>
    );
  }

  return <div className={shell}>{body}</div>;
}

/** Wrapping row of compact service tiles — as many as fit. */
export function ServiceTileRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>
  );
}
