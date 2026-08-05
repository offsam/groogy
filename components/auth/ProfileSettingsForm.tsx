"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  updateProfileSettingsAction,
  type ProfileActionResult,
} from "@/lib/profile/actions";
import { stateCodeFromAbbreviation } from "@/lib/master-data/location";
import { AuthAlert } from "@/components/auth/AuthShell";
import { StateSelect } from "@/components/master-data/StateSelect";
import { Button } from "@/components/ui/Button";
import type { ProfileRow } from "@/types/database";
import type { UsStateOption } from "@/types/master-data";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const initialState: ProfileActionResult | null = null;

const AUTHOR_OPTIONS = [
  { value: "public", label: "Полное имя" },
  { value: "initials", label: "Инициалы" },
  { value: "anonymous", label: "Анонимно" },
] as const;

type ProfileSettingsFormProps = {
  profile: ProfileRow;
  usStates?: UsStateOption[];
};

export function ProfileSettingsForm({
  profile,
  usStates = [],
}: ProfileSettingsFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateProfileSettingsAction,
    initialState,
  );

  const initialStateCode = useMemo(
    () => stateCodeFromAbbreviation(profile.state ?? "", usStates) ?? "",
    [profile.state, usStates],
  );
  const [stateCode, setStateCode] = useState(initialStateCode);
  const stateAbbreviation =
    usStates.find((s) => s.code === stateCode)?.abbreviation ??
    profile.state ??
    "";

  useEffect(() => {
    if (!state?.ok || !state.username) return;
    if (state.username !== profile.username) {
      router.replace(`/u/${state.username}`);
    }
    router.refresh();
  }, [state, profile.username, router]);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && <AuthAlert>{state.message}</AuthAlert>}
      {state?.ok && state.message && (
        <AuthAlert tone="success">{state.message}</AuthAlert>
      )}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Основное
        </h3>

        <label className="block space-y-1.5 text-sm" htmlFor="display_name">
          <span className="font-medium text-slate-700">Отображаемое имя</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            defaultValue={profile.display_name ?? ""}
            id="display_name"
            maxLength={80}
            name="display_name"
            type="text"
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="username">
          <span className="font-medium text-slate-700">Username (латиница)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            defaultValue={profile.username ?? ""}
            id="username"
            maxLength={30}
            name="username"
            pattern="[a-z0-9_]{3,30}"
            placeholder="my_username"
            type="text"
          />
          <p className="text-xs text-slate-500">
            Публичная страница: /u/{profile.username || "username"}. Меняйте
            осторожно — ссылка изменится.
          </p>
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="avatar_url">
          <span className="font-medium text-slate-700">URL аватара</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            defaultValue={profile.avatar_url ?? ""}
            id="avatar_url"
            maxLength={500}
            name="avatar_url"
            placeholder="https://…"
            type="url"
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="bio">
          <span className="font-medium text-slate-700">О себе</span>
          <textarea
            className="min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            defaultValue={profile.bio ?? ""}
            id="bio"
            maxLength={1000}
            name="bio"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm" htmlFor="postal_code">
            <span className="font-medium text-slate-700">ZIP-код</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              defaultValue={profile.postal_code ?? ""}
              id="postal_code"
              inputMode="numeric"
              maxLength={10}
              name="postal_code"
              pattern="\d{5}(-\d{4})?"
              placeholder="92618"
              type="text"
            />
            <p className="text-xs text-slate-500">
              По ZIP определяем county: «КРУГИ в Оранж Каунти», «в Лос-Анджелесе» и т.д.
            </p>
          </label>

          <label className="block space-y-1.5 text-sm" htmlFor="city">
            <span className="font-medium text-slate-700">Город</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              defaultValue={profile.city ?? ""}
              id="city"
              maxLength={80}
              name="city"
              type="text"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm" htmlFor="state">
            <span className="font-medium text-slate-700">Штат</span>
            {usStates.length > 0 ? (
              <>
                <StateSelect
                  id="state"
                  onChange={(code) => setStateCode(code)}
                  states={usStates}
                  value={stateCode}
                />
                <input name="state" type="hidden" value={stateAbbreviation} />
              </>
            ) : (
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
                defaultValue={profile.state ?? ""}
                id="state"
                maxLength={40}
                name="state"
                type="text"
              />
            )}
          </label>
        </div>
      </section>

      <section className="space-y-4 border-t border-slate-100 pt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Приватность
        </h3>

        <label className="block space-y-1.5 text-sm" htmlFor="profile_visibility">
          <span className="font-medium text-slate-700">Видимость профиля</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            defaultValue={profile.profile_visibility}
            id="profile_visibility"
            name="profile_visibility"
          >
            <option value="public">Публичный</option>
            <option value="private">Приватный</option>
          </select>
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="default_author_visibility">
          <span className="font-medium text-slate-700">Автор по умолчанию</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
            defaultValue={profile.default_author_visibility}
            id="default_author_visibility"
            name="default_author_visibility"
          >
            {AUTHOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              defaultChecked={profile.public_activity_enabled}
              name="public_activity_enabled"
              type="checkbox"
            />
            <span>
              <span className="font-medium text-slate-700">Публичная активность</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Показывать счётчики отзывов и объявлений на странице профиля
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              defaultChecked={profile.show_reviews_in_profile}
              name="show_reviews_in_profile"
              type="checkbox"
            />
            <span>
              <span className="font-medium text-slate-700">Показывать отзывы</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Отзывы видны на публичной странице
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              defaultChecked={profile.show_listings_in_profile}
              name="show_listings_in_profile"
              type="checkbox"
            />
            <span>
              <span className="font-medium text-slate-700">Показывать объявления</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Активные объявления Marketplace на странице профиля
              </span>
            </span>
          </label>
        </div>
      </section>

      <Button className="gap-2 disabled:opacity-60" disabled={pending} type="submit">
        {pending && <BrandPinLoader size="sm" />}
        Сохранить профиль
      </Button>
    </form>
  );
}
