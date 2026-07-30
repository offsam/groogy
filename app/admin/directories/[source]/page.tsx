import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DirectoryImportSourceView } from "@/components/admin/DirectoryImportSourceView";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { directorySourceBySlug } from "@/lib/import-review/directory-sources";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ source: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ source: string }>;
}): Promise<Metadata> {
  const { source: slug } = await params;
  const meta = directorySourceBySlug(slug);
  return {
    title: meta ? `${meta.title} — Imports — Admin` : "Directories — Admin",
  };
}

/** Legacy URL — same UI as IA imports directories source. */
export default async function AdminDirectorySourcePage({
  params,
  searchParams,
}: PageProps) {
  const { source: slug } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/directories/${slug}`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  const q = await searchParams;
  const page = Math.max(1, Number(q.page || "1") || 1);

  return (
    <DirectoryImportSourceView
      slug={slug}
      page={page}
      basePath="/admin/directories"
      showLegacyBanner
    />
  );
}
