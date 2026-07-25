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
import { cn } from "@/lib/utils";

type HeaderRegionChipProps = {
  hubs: RegionHub[];
};

export function HeaderRegionChip({ hubs }: HeaderRegionChipProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const label = formatHubsInLabel(hubs);

  function applyHubs(ids: RegionHubId[]) {
    persistGuestHubIds(ids);
    const params = new URLSearchParams(searchParams.toString());
    params.set("hub", serializeHubIds(ids));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
  }

  return (
    <RegionHubPicker
      onChange={applyHubs}
      selected={hubs}
      trigger={({ open, toggle }) => (
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex max-w-full items-center gap-0.5 text-left text-xs font-medium leading-tight text-slate-500 transition hover:text-slate-800 sm:text-[13px]"
          onClick={toggle}
          type="button"
        >
          <span className="truncate">в {label}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-slate-400 transition",
              open && "rotate-180",
            )}
          />
        </button>
      )}
      variant="light"
    />
  );
}
