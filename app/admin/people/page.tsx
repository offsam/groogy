import type { Metadata } from "next";
import { AdminCapabilityEditor } from "@/components/admin/AdminCapabilityEditor";
import { AdminSectionHub } from "@/components/admin/AdminSectionHub";
import { ALL_ADMIN_CAPABILITIES } from "@/lib/admin/capabilities";
import { loadAdminCapabilityGrants } from "@/lib/admin/capability-grants";
import { getAdminUsers } from "@/lib/admin/queries";
import { searchAdminSection } from "@/lib/admin/section-search";
import { getAdminSection } from "@/lib/admin/sections";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Люди — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const supabase = await createServerClient();
  const [hits, users, grants] = await Promise.all([
    q.trim() ? searchAdminSection(supabase, "people", q) : Promise.resolve([]),
    getAdminUsers(supabase).catch(() => []),
    loadAdminCapabilityGrants(supabase),
  ]);
  const admins = users
    .filter((user) => user.role === "admin")
    .map((user) => ({
      id: user.id,
      name: user.display_name || user.email || "Без имени",
      email: user.email,
      capabilities: grants?.[user.id] ?? ALL_ADMIN_CAPABILITIES,
    }));

  return (
    <AdminSectionHub
      hits={hits}
      query={q}
      section={getAdminSection("people")}
    >
      <AdminCapabilityEditor admins={admins} grantsReady={grants !== null} />
    </AdminSectionHub>
  );
}
