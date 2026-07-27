import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProfessionalForm } from "@/components/professional/ProfessionalForm";
import {
  getOwnedProfessionalBySlug,
  userOwnsProfessional,
} from "@/lib/professional/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const metadata: Metadata = {
  title: "Редактирование профиля — КРУГИ",
};

export default async function EditProfessionalPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/professional/${slug}/edit`);
  }

  const professional = await getOwnedProfessionalBySlug(supabase, slug);
  if (!professional) notFound();

  const [owns, isAdmin] = await Promise.all([
    userOwnsProfessional(supabase, professional.id),
    userIsAdmin(supabase).catch(() => false),
  ]);
  if (!owns && !isAdmin) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900">
          Редактирование
        </h1>
        <p className="mt-1 text-sm text-slate-500">{professional.displayName}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <ProfessionalForm
          initial={{
            displayName: professional.displayName,
            headline: professional.headline ?? "",
            shortDescription: professional.shortDescription ?? "",
            description: professional.description ?? "",
            city: professional.city ?? "",
            region: professional.region ?? "",
            phone: professional.phone ?? "",
            email: professional.email ?? "",
            website: professional.website ?? "",
            instagramUrl: professional.instagramUrl ?? "",
            telegramUrl: professional.telegramUrl ?? "",
          }}
          mode="edit"
          slug={professional.slug}
        />
      </div>
    </div>
  );
}
