import type { Metadata } from "next";
import { AdminSectionHub } from "@/components/admin/AdminSectionHub";
import { searchAdminSection } from "@/lib/admin/section-search";
import { getAdminSection } from "@/lib/admin/sections";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Карточки — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const supabase = await createServerClient();
  const hits = q.trim()
    ? await searchAdminSection(supabase, "cards", q)
    : [];
  return (
    <AdminSectionHub
      hits={hits}
      query={q}
      section={getAdminSection("cards")}
    />
  );
}
