import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfessionalForm } from "@/components/professional/ProfessionalForm";
import {
  canCurrentUserPublish,
  getMyProfessional,
} from "@/lib/professional/queries";
import { getProfileById } from "@/lib/supabase/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Новый профиль специалиста — КРУГИ",
};

export default async function NewProfessionalPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/professional/new");
  }

  const existing = await getMyProfessional(supabase, user.id).catch(() => null);
  if (existing) {
    redirect(`/professional/${existing.slug}/edit`);
  }

  const [isAdmin, canPublish, profile] = await Promise.all([
    userIsAdmin(supabase).catch(() => false),
    canCurrentUserPublish(supabase),
    getProfileById(supabase, user.id),
  ]);

  const profileReady = Boolean(
    profile?.display_name?.trim() && profile?.postal_code?.trim(),
  );
  const canDraft = isAdmin || profileReady;
  const canGoLive = isAdmin || canPublish;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Профиль специалиста
        </h1>
        <p className="mt-2 text-sm text-slate-500 sm:text-base">
          Отдельная страница для мастера или профессионала — не бизнес и не
          объявление услуги.
        </p>
      </div>

      {!canDraft ? (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <p>Сначала заполните имя и ZIP в профиле аккаунта.</p>
          <Link className="font-semibold text-brand-blue" href="/profile">
            Открыть настройки профиля
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {!canGoLive ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Черновик можно сохранить сейчас. Для публикации нужен подтверждённый
              email.
            </p>
          ) : null}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <ProfessionalForm
              initial={{
                displayName: profile?.display_name?.trim() || "",
                email: user.email ?? "",
              }}
              mode="create"
            />
          </div>
        </div>
      )}
    </div>
  );
}
