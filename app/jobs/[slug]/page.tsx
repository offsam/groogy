import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { JobProfileView } from "@/components/jobs/JobProfileView";
import { getJobBySlug } from "@/lib/jobs/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(createServiceRoleClient(), slug).catch(() => null);
  if (!job || job.status !== "published") return { title: "Вакансия не найдена" };
  if (job.businessSlug) {
    return { title: `${job.title} — ${job.businessName}` };
  }
  return {
    title: `${job.title} — Работа — КРУГИ`,
    description: job.description?.slice(0, 160) ?? job.title,
  };
}

export default async function JobDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const catalog = createServiceRoleClient();
  const job = await getJobBySlug(catalog, slug).catch(() => null);
  if (!job || job.status !== "published") notFound();

  if (job.businessSlug) {
    redirect(`/business/${job.businessSlug}?tab=jobs`);
  }

  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  const isAdmin = user ? await userIsAdmin(session).catch(() => false) : false;

  return <JobProfileView isAdmin={isAdmin} job={job} />;
}
