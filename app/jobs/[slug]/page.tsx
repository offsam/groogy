import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { JobProfileView } from "@/components/jobs/JobProfileView";
import { getJobBySlug } from "@/lib/jobs/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ claim?: string }>;
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

export default async function JobDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { claim } = await searchParams;
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

  let isOwner = false;
  if (user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (catalog as any)
      .from("jobs")
      .select("owner_profile_id")
      .eq("id", job.id)
      .maybeSingle();
    isOwner = Boolean(data?.owner_profile_id && data.owner_profile_id === user.id);
  }

  return (
    <JobProfileView
      autoClaim={claim === "1" && Boolean(user) && !isOwner && !isAdmin}
      isAdmin={isAdmin}
      isOwner={isOwner || isAdmin}
      job={job}
    />
  );
}
