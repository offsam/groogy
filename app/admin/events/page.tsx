import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "События — верификация — Admin",
};

export const dynamic = "force-dynamic";

/**
 * Legacy `/admin/events` → Review Center Inbox Events view.
 * Approve / Structure / Translate live in `/admin/review/[taskId]`.
 */
export default async function AdminEventsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/review/inbox?view=events");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  redirect("/admin/review/inbox?view=events");
}
