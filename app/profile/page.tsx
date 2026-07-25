import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileSettingsForm } from "@/components/auth/ProfileSettingsForm";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { getMyListings } from "@/lib/listings/queries";
import { getUsStates } from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";
import { getIncompleteVerificationsForUser } from "@/lib/reviews/queries";
import type { IncompleteVerificationItem } from "@/types/review";
import type { Listing, ListingStatus } from "@/types/listing";
import { LISTING_STATUS_LABELS } from "@/types/listing";

export const metadata: Metadata = {
  title: "Профиль — КРУГИ",
};

const ROLE_LABELS: Record<string, string> = {
  user: "Пользователь",
  business_owner: "Владелец бизнеса",
  moderator: "Модератор",
  admin: "Администратор",
};

const MY_LISTING_GROUPS: ListingStatus[] = [
  "draft",
  "active",
  "reserved",
  "completed",
  "archived",
];

const MY_SERVICE_GROUPS: ListingStatus[] = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
];

const MODERATED_STATUSES: ListingStatus[] = ["removed", "rejected"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRemaining(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "срок истёк";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `~${days} д.`;
  if (hours >= 1) return `~${hours} ч.`;
  return `~${Math.max(1, Math.floor(ms / (1000 * 60)))} мин.`;
}

function groupListingsByStatus(
  listings: Listing[],
  groups: ListingStatus[],
) {
  const map = new Map<ListingStatus, Listing[]>();
  for (const status of groups) {
    map.set(status, []);
  }
  for (const listing of listings) {
    const bucket = map.get(listing.status);
    if (bucket) bucket.push(listing);
  }
  return map;
}

export default async function ProfilePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  const profile = await getProfileById(supabase, user.id);

  let incomplete: IncompleteVerificationItem[] = [];
  try {
    incomplete = await getIncompleteVerificationsForUser(supabase, user.id);
  } catch {
    incomplete = [];
  }

  let myListings: Listing[] = [];
  let myServices: Listing[] = [];
  let usStates: Awaited<ReturnType<typeof getUsStates>> = [];
  try {
    [myListings, myServices, usStates] = await Promise.all([
      getMyListings(supabase, user.id, null, "marketplace_item"),
      getMyListings(supabase, user.id, null, "service"),
      getUsStates(),
    ]);
  } catch {
    myListings = [];
    myServices = [];
  }

  const listingGroups = groupListingsByStatus(myListings, MY_LISTING_GROUPS);
  const serviceGroups = groupListingsByStatus(myServices, MY_SERVICE_GROUPS);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Профиль</h1>
        <p className="mt-2 text-slate-500">
          Настройки аккаунта, публичная страница, объявления Marketplace и Услуги.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-900">{user.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
            <dt className="text-slate-500">Роль</dt>
            <dd className="font-medium text-slate-900">
              {ROLE_LABELS[profile?.role ?? "user"] ?? profile?.role ?? "Пользователь"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Дата регистрации</dt>
            <dd className="font-medium text-slate-900">
              {profile?.created_at ? formatDate(profile.created_at) : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {profile && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Настройки профиля</h2>
            {profile.username && (
              <Link
                className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline"
                href={`/u/${profile.username}`}
              >
                Публичная страница →
              </Link>
            )}
          </div>
          <ProfileSettingsForm profile={profile} usStates={usStates} />
        </section>
      )}

      <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Мои объявления Marketplace</h2>
          <Link
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            href="/marketplace/new"
            style={{ color: "#ffffff" }}
          >
            Разместить
          </Link>
        </div>

        {myListings.length === 0 ? (
          <p className="text-sm text-slate-500">
            У вас пока нет объявлений.{" "}
            <Link className="font-medium text-slate-900 underline" href="/marketplace/new">
              Создать первое
            </Link>
          </p>
        ) : (
          <>
            {MY_LISTING_GROUPS.map((status) => {
              const items = listingGroups.get(status) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={status} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                    {LISTING_STATUS_LABELS[status]} ({items.length})
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {items.map((listing) => (
                      <ListingCard key={listing.id} listing={listing} showStatus />
                    ))}
                  </div>
                </div>
              );
            })}
            {(() => {
              const moderated = myListings.filter((l) =>
                MODERATED_STATUSES.includes(l.status),
              );
              if (moderated.length === 0) return null;
              return (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                    Скрытые / отклонённые ({moderated.length})
                  </h3>
                  <ul className="space-y-2 text-sm">
                    {moderated.map((listing) => (
                      <li
                        key={listing.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                      >
                        <p className="font-medium text-slate-900">{listing.title}</p>
                        <p className="text-slate-500">
                          {LISTING_STATUS_LABELS[listing.status]}
                          {listing.moderationReason
                            ? ` — ${listing.moderationReason}`
                            : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </>
        )}
      </section>

      <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Мои услуги</h2>
          <Link
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            href="/services/new"
            style={{ color: "#ffffff" }}
          >
            Разместить
          </Link>
        </div>

        {myServices.length === 0 ? (
          <p className="text-sm text-slate-500">
            У вас пока нет услуг.{" "}
            <Link className="font-medium text-slate-900 underline" href="/services/new">
              Создать первую
            </Link>
          </p>
        ) : (
          <>
            {MY_SERVICE_GROUPS.map((status) => {
              const items = serviceGroups.get(status) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={status} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                    {LISTING_STATUS_LABELS[status]} ({items.length})
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {items.map((listing) => (
                      <ServiceCard key={listing.id} listing={listing} showStatus />
                    ))}
                  </div>
                </div>
              );
            })}
            {(() => {
              const moderated = myServices.filter((l) =>
                MODERATED_STATUSES.includes(l.status),
              );
              if (moderated.length === 0) return null;
              return (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                    Скрытые / отклонённые ({moderated.length})
                  </h3>
                  <ul className="space-y-2 text-sm">
                    {moderated.map((listing) => (
                      <li
                        key={listing.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                      >
                        <p className="font-medium text-slate-900">{listing.title}</p>
                        <p className="text-slate-500">
                          {LISTING_STATUS_LABELS[listing.status]}
                          {listing.moderationReason
                            ? ` — ${listing.moderationReason}`
                            : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Незавершённые проверки</h2>
        {incomplete.length === 0 ? (
          <p className="text-sm text-slate-500">Нет активных AI-проверок отзывов.</p>
        ) : (
          <ul className="space-y-3">
            {incomplete.map((item) => (
              <li
                key={item.sessionId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{item.businessName}</p>
                  <p className="text-xs text-slate-500">
                    Вопрос {item.currentQuestionIndex} из {item.questionsRequired} ·{" "}
                    {formatRemaining(item.expiresAt)}
                  </p>
                </div>
                <Link
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  href={`/business/${item.businessSlug}`}
                  style={{ color: "#ffffff" }}
                >
                  Продолжить проверку
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
