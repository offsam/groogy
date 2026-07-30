import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DirectoriesImportsIndex } from "@/components/admin/DirectoriesImportsIndex";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Directories — Imports — Admin",
};

export const dynamic = "force-dynamic";

const BASE = "/admin/imports/directories";

export default async function AdminImportsDirectoriesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${BASE}`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  return <DirectoriesImportsIndex basePath={BASE} />;
}
