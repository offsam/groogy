"use client";

import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { LikeFollowButtons } from "@/components/engagement/LikeFollowButtons";
import { ShareEntityButton } from "@/components/engagement/ShareEntityButton";
import { formatProfessionalPrice } from "@/lib/professional/mappers";
import { ProfessionalContactsCard } from "@/components/professional/ProfessionalContactsCard";
import { ProfessionalOriginBadges } from "@/components/professional/ProfessionalOriginBadges";
import { ProfessionalSourceCard } from "@/components/professional/ProfessionalSourceCard";
import type { EntityEngagement } from "@/types/engagement";
import type { Professional, ProfessionalService } from "@/types/professional";

type ProfessionalProfileViewProps = {
  professional: Professional;
  services: ProfessionalService[];
  isOwner: boolean;
  currentUserId: string | null;
  engagement?: EntityEngagement;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "К";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function ProfessionalProfileView({
  professional,
  services,
  isOwner,
  currentUserId,
  engagement,
}: ProfessionalProfileViewProps) {
  const location = [professional.city, professional.region || professional.stateCode]
    .filter(Boolean)
    .join(", ");
  const about =
    professional.shortDescription ||
    (professional.description &&
    professional.description !== professional.shortDescription
      ? professional.description
      : null);
  const longAbout =
    professional.description &&
    professional.description !== professional.shortDescription
      ? professional.description
      : null;
  const engagementState: EntityEngagement = engagement ?? {
    likesCount: professional.likesCount ?? 0,
    dislikesCount: professional.dislikesCount ?? 0,
    followersCount: professional.followersCount ?? 0,
    likedByMe: false,
    dislikedByMe: false,
    followedByMe: false,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-6 sm:px-6 sm:py-8">
      {isOwner ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-3 py-2.5 text-sm">
          <span className="text-slate-700">Это ваш профиль специалиста</span>
          <Link
            className="font-semibold text-brand-blue"
            href={`/professional/${professional.slug}/edit`}
          >
            Редактировать
          </Link>
        </div>
      ) : null}

      <header className="flex gap-3">
        <div
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-base font-bold tracking-tight sm:size-16 sm:text-lg"
          style={{ color: "#ffffff" }}
        >
          {initials(professional.displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {professional.displayName}
          </h1>
          <p className="mt-0.5 truncate text-sm leading-7 text-slate-500">
            {[professional.categoryName || professional.headline, location]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            {professional.ratingAvg > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                <Star
                  aria-hidden="true"
                  className="size-3.5 fill-amber-500 text-amber-500"
                />
                {professional.ratingAvg.toFixed(1)}
                <span className="font-normal text-slate-500">
                  ({professional.reviewsCount})
                </span>
              </span>
            ) : null}
            {engagementState.likesCount > 0 ? (
              <span>{engagementState.likesCount} лайков</span>
            ) : null}
            {engagementState.dislikesCount > 0 ? (
              <span>{engagementState.dislikesCount} дизлайков</span>
            ) : null}
            {engagementState.followersCount > 0 ? (
              <span>{engagementState.followersCount} подписчиков</span>
            ) : null}
            {professional.experienceYears != null ? (
              <span>Опыт: {professional.experienceYears} лет</span>
            ) : null}
            {location && !professional.categoryName && !professional.headline ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {location}
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            <ProfessionalOriginBadges professional={professional} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <LikeFollowButtons
              dislikesCount={engagementState.dislikesCount}
              followersCount={engagementState.followersCount}
              initialDisliked={engagementState.dislikedByMe}
              initialFollowed={engagementState.followedByMe}
              initialLiked={engagementState.likedByMe}
              isAuthenticated={Boolean(currentUserId)}
              kind="professional"
              likesCount={engagementState.likesCount}
              slug={professional.slug}
              targetId={professional.id}
            />
            <ShareEntityButton
              title={professional.displayName}
              url={`/professional/${professional.slug}`}
              variant="button"
            />
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <aside className="order-1 space-y-3 lg:order-2 lg:sticky lg:top-24">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Услуги</h2>
              {isOwner ? (
                <Link
                  className="text-xs font-medium text-brand-blue hover:underline"
                  href={`/professional/${professional.slug}/edit`}
                >
                  Изменить
                </Link>
              ) : null}
            </div>
            {services.length > 0 ? (
              <ul className="mt-2 divide-y divide-slate-100">
                {services.map((s) => (
                  <li
                    className="flex items-start justify-between gap-3 py-2.5 first:pt-1 last:pb-0"
                    key={s.id}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {s.title}
                      </p>
                      {s.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                          {s.description}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
                      {formatProfessionalPrice(s)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Услуги пока не указаны
                {isOwner ? (
                  <>
                    {" "}
                    —{" "}
                    <Link
                      className="font-semibold text-brand-blue"
                      href={`/professional/${professional.slug}/edit`}
                    >
                      добавить
                    </Link>
                  </>
                ) : null}
              </p>
            )}
            {professional.serviceAreaText ? (
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                Зона: {professional.serviceAreaText}
              </p>
            ) : null}
          </section>

          <ProfessionalContactsCard
            initiallyRevealed={Boolean(
              isOwner ||
                professional.phone ||
                professional.email ||
                professional.website ||
                professional.instagramUrl ||
                professional.telegramUrl,
            )}
            isAuthenticated={Boolean(currentUserId)}
            professional={professional}
          />

          <ProfessionalSourceCard
            initiallyRevealed={Boolean(
              isOwner ||
                professional.sourceUrl ||
                professional.sourceKind === "platform",
            )}
            isAuthenticated={Boolean(currentUserId)}
            professional={professional}
          />
        </aside>

        <div className="order-2 space-y-4 lg:order-1">
          {about || longAbout ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-base font-semibold text-slate-900">
                О специалисте
              </h2>
              {professional.shortDescription ? (
                <p className="mt-3 text-base leading-relaxed text-slate-800">
                  {professional.shortDescription}
                </p>
              ) : null}
              {longAbout ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                  {longAbout}
                </p>
              ) : null}
            </section>
          ) : isOwner ? (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 sm:p-5">
              <h2 className="text-base font-semibold text-slate-900">
                О специалисте
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Добавьте короткое описание —{" "}
                <Link
                  className="font-semibold text-brand-blue"
                  href={`/professional/${professional.slug}/edit`}
                >
                  редактировать
                </Link>
              </p>
            </section>
          ) : null}

          {professional.availabilityText ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Доступность
              </h2>
              <p className="mt-2 text-sm text-slate-700">
                {professional.availabilityText}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
