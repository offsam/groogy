"use client";

import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

type EditPencilProps = {
  label: string;
  onClick: () => void;
  className?: string;
};

export function EditPencil({ label, onClick, className }: EditPencilProps) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg border border-brand-blue/30 bg-brand-blue/5 text-brand-blue-deep transition-colors hover:bg-brand-blue/10",
        className,
      )}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Pencil aria-hidden="true" className="size-3.5" />
    </button>
  );
}
