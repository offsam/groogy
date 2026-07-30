import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { Shield } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { HeaderAuth, HeaderGuestAuth } from "@/components/auth/HeaderAuth";
import { HeaderRegionChip } from "@/components/layout/HeaderRegionChip";
import { SearchBar } from "@/components/search/SearchBar";
import { BRAND_NAME } from "@/lib/brand";
import { getBrandLocationForProfile } from "@/lib/brand/location";
import {
  GUEST_REGION_COOKIE,
  USA_OVERVIEW_HUB,
  formatHubsInLabel,
  getRegionHubsByIds,
  parseHubIds,
  resolveRegionHub,
} from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";
import { userIsAdmin } from "@/lib/reviews/queries";

export async function Header() {
  let email: string | null = null;
  let displayName: string | null = null;
  let isAuthenticated = false;
  let isAdmin = false;
  let hubs = [USA_OVERVIEW_HUB];

  try {
    const cookieStore = await cookies();
    const cookieHub = cookieStore.get(GUEST_REGION_COOKIE)?.value;
    if (cookieHub) {
      hubs = getRegionHubsByIds(parseHubIds(decodeURIComponent(cookieHub)));
    }

    const client = await createServerClient();
    const userResult = await client.auth.getUser();
    const user = userResult.data.user;
    if (user) {
      isAuthenticated = true;
      email = user.email ?? null;
      const [profile, admin] = await Promise.all([
        getProfileById(client, user.id),
        userIsAdmin(client).catch(() => false),
      ]);
      displayName = profile?.display_name ?? null;
      isAdmin = admin;

      // Profile location wins when no guest cookie override yet
      if (!cookieHub) {
        const brandLocation = await getBrandLocationForProfile(client, profile);
        if (brandLocation) {
          hubs = [
            resolveRegionHub({
              countyGeoid: brandLocation.countyGeoid,
              hubId: brandLocation.hub?.id,
            }),
          ];
        }
      }
    }
  } catch {
    // Auth/profile optional for header chrome
  }

  const inLabel = formatHubsInLabel(hubs);

  return (
    <header className="w-full border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:gap-x-4 sm:gap-y-3 sm:px-6 sm:py-3 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-2.5">
          <Link
            className="inline-flex shrink-0 items-center"
            href="/"
            title={BRAND_NAME}
          >
            <BrandMark className="size-8 sm:size-9" priority size={36} />
          </Link>
          <Suspense
            fallback={
              <span className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                Круги в {inLabel}
              </span>
            }
          >
            <HeaderRegionChip hubs={hubs} />
          </Suspense>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0 sm:gap-2">
          {isAdmin ? (
            <Link
              className="inline-flex items-center gap-2 rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-2.5 py-2 text-sm font-medium text-brand-blue-deep transition-colors hover:bg-brand-blue/10 sm:px-3"
              href="/admin"
            >
              <Shield aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Админ</span>
            </Link>
          ) : null}
          {isAuthenticated ? (
            <HeaderAuth displayName={displayName} email={email} />
          ) : (
            <HeaderGuestAuth />
          )}
        </div>

        <div className="header-search order-last min-w-0 w-full flex-none sm:order-none sm:max-w-md sm:flex-1">
          <SearchBar />
        </div>
      </div>
    </header>
  );
}
