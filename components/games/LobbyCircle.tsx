import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LobbyCircle({
  href,
  title,
  caption,
  felt,
  mark,
}: {
  href?: string;
  title: string;
  caption?: string;
  felt?: boolean;
  mark?: ReactNode;
}) {
  const body = (
    <>
      <span
        className={cn(
          "relative flex size-24 items-center justify-center overflow-hidden rounded-full shadow-md sm:size-32",
          felt
            ? "bg-[radial-gradient(circle_at_50%_40%,#3cb371_0%,#1b7a48_55%,#0c4a2c_100%)] ring-4 ring-[#6b4423] ring-offset-2 ring-offset-slate-50"
            : "bg-[radial-gradient(circle_at_50%_35%,#4a8eef_0%,#1f6fe5_60%,#164e9e_100%)] ring-4 ring-white shadow-[0_8px_20px_rgba(31,111,229,0.25)]",
        )}
      >
        <span className="pointer-events-none absolute inset-2 rounded-full border border-white/25" />
        {mark}
      </span>
      <span className="text-center text-sm font-semibold text-slate-900">{title}</span>
      {caption ? (
        <span className="text-center text-xs text-slate-500">{caption}</span>
      ) : null}
    </>
  );

  const className =
    "flex min-h-11 w-full max-w-36 flex-col items-center gap-2 sm:max-w-40";

  if (!href) {
    return (
      <div aria-disabled="true" className={cn(className, "opacity-70")}>
        {body}
      </div>
    );
  }

  return (
    <Link className={className} href={href}>
      {body}
    </Link>
  );
}

export function LobbyGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 justify-items-center gap-x-2 gap-y-5 sm:gap-x-6">
      {children}
    </div>
  );
}

export function CardFanMark() {
  return (
    <span className="relative h-12 w-14" aria-hidden>
      <span className="absolute left-0 top-2 h-10 w-7 -rotate-12 rounded-md border border-white/40 bg-[#123056] shadow" />
      <span className="absolute left-3 top-1 h-10 w-7 -rotate-2 rounded-md border border-white/40 bg-[#16386a] shadow" />
      <span className="absolute left-6 top-2 h-10 w-7 rotate-12 rounded-md border border-white/40 bg-[#123056] shadow" />
    </span>
  );
}
