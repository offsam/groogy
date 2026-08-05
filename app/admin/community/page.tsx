import { redirect } from "next/navigation";

/** Community hub → reviews moderation. */
export default function AdminCommunityIndexPage() {
  redirect("/admin/community/reviews");
}
