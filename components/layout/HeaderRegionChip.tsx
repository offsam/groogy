"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { RegionHubPicker } from "@/components/regions/RegionHubPicker";
import {
  formatHubsInLabel,
  persistGuestHubIds,
  serializeHubIds,
  type RegionHub,
  type RegionHubId,
} from "@/lib/regions/hubs";
import {
  formatPlaceTokensLabel,
  parsePlaceTokens,
  persistGuestPlaceTokens,
  serializePlaceToken,
  type PlaceToken,
} from "@/lib/geo/place-tokens";
import { cn } from "@/lib/utils";

type HeaderRegionChipProps = {
  hubs: RegionHub[];
};

export function HeaderRegionChip({ hubs }: HeaderRegionChipProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hubRaw = searchParams.get("hub");
  const tokens = hubRaw ? parsePlaceTokens(hubRaw) : null;
  const hasPlace =
    tokens?.some((t) => t.kind === "county" || t.kind === "city") ?? false;
  const label =
    hasPlace && tokens
      ? formatPlaceTokensLabel(tokens)
      : formatHubsInLabel(hubs);

  function applyHubs(ids: RegionHubId[]) {
    persistGuestHubIds(ids);
    const params = new URLSearchParams(searchParams.toString());
    params.set("hub", serializeHubIds(ids));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
  }

  function applyPlace(token: PlaceToken) {
    persistGuestPlaceTokens([token]);
    const params = new URLSearchParams(searchParams.toString());
    params.set("hub", serializePlaceToken(token));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
  }

  return (
    <RegionHubPicker
      onChange={applyHubs}
      onPlaceSelect={applyPlace}
      selected={hubs}
      trigger={({ open, toggle }) => (
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex max-w-full min-w-0 items-center gap-0.5 text-left transition hover:opacity-80"
          onClick={toggle}
          type="button"
        >
          <span className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">
            Круги в {label}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-slate-400 transition",
              open && "rotate-180",
            )}
          />
        </button>
      )}
      variant="light"
    />
  );
}
