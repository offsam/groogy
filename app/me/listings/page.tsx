import Link from "next/link";
import { redirect } from "next/navigation";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { CabinetLeftNav } from "@/components/profile/CabinetLeftNav";
import { OwnListingArchiveButton } from "@/components/profile/OwnListingArchiveButton";
import { getMyListings } from "@/lib/listings/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function MeListingsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/me/listings");
  }

  const [profile, allListings] = await Promise.all([
    getProfileById(supabase, user.id),
    getMyListings(supabase, user.id, null, "marketplace_item").catch(() => []),
  ]);

  // Актуальные: не архив и не удалённые.
  const listings = allListings.filter(
    (l) => l.status !== "archived" && l.status !== "removed",
  );

  return (
    <div className="cabinet-wide mx-auto flex max-w-[1400px] flex-col gap-4 px-3 py-6 pb-24 sm:px-6 md:flex-row md:pb-6 lg:px-8">
      <CabinetLeftNav active="listings" username={profile?.username ?? null} />
      <div className="min-w-0 flex-1 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
              Мои объявления
            </h1>
            <p className="text-sm text-slate-500">
              Актуальные объявления купи-продай.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-blue px-3 text-sm font-medium text-white"
            href="/marketplace/new"
            style={{ color: "#ffffff" }}
          >
            Разместить
          </Link>
        </header>

        {listings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            <p>Нет объявлений.</p>
            <Link
              className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
              href="/marketplace/new"
            >
              Разместить объявление
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
            {listings.map((listing) => (
              <div key={listing.id}>
                <ListingCard listing={listing} showStatus />
                {listing.status !== "archived" &&
                listing.status !== "removed" ? (
                  <OwnListingArchiveButton listingId={listing.id} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
