import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DirectoriesImportsIndex } from "@/components/admin/DirectoriesImportsIndex";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Directories — Imports — Admin",
};

export const dynamic = "force-dynamic";

/** Legacy URL — same UI as IA `/admin/imports/directories`. */
export default async function AdminDirectoriesIndexPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/directories");
  if (!(await userIsAdmin(supabase))) redirect("/");

  return (
    <DirectoriesImportsIndex
      basePath="/admin/directories"
      showLegacyBanner
    />
  );
}
