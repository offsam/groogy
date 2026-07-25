"use client";

import { useRef, useState } from "react";
import { Eye, MapPin } from "lucide-react";
import { BusinessContactActions } from "@/components/business-offers/BusinessContactActions";
import { trackContactRevealAction } from "@/lib/admin/actions";

type RevealContactsProps = {
  businessId: string;
  businessSlug: string;
  offerId?: string | null;
  offerSlug?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  surface: "business" | "offer";
  /** When true, contacts are shown immediately (owner / manage). */
  initiallyRevealed?: boolean;
  compact?: boolean;
  className?: string;
};

export function RevealContacts({
  businessId,
  businessSlug,
  offerId = null,
  offerSlug = null,
  phone = null,
  website = null,
  address = null,
  surface,
  initiallyRevealed = false,
  compact = false,
  className,
}: RevealContactsProps) {
  const hasContacts = Boolean(phone || website || address);
  const [revealed, setRevealed] = useState(initiallyRevealed);
  const tracked = useRef(initiallyRevealed);

  if (!hasContacts) return null;

  async function reveal() {
    setRevealed(true);
    if (tracked.current) return;
    tracked.current = true;
    void trackContactRevealAction({
      businessId,
      businessSlug,
      offerId,
      offerSlug,
      surface,
      path:
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : null,
    });
  }

  if (!revealed) {
    return (
      <div className={className}>
        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 sm:w-auto"
          style={{ color: "#ffffff" }}
          type="button"
          onClick={() => void reveal()}
        >
          <Eye aria-hidden="true" className="size-4" style={{ color: "#ffffff" }} />
          Показать контакты
        </button>
      </div>
    );
  }

  return (
    <div className={className ? `space-y-3 ${className}` : "space-y-3"}>
      <BusinessContactActions compact={compact} phone={phone} website={website} />
      {address ? (
        <p className="flex items-start gap-2 text-sm text-slate-600">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <span>{address}</span>
        </p>
      ) : null}
    </div>
  );
}
