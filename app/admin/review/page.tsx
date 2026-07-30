import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Phase 1 redirect: Review Center root → Inbox. */
export default async function Page() {
  redirect('/admin/review/inbox');
}
