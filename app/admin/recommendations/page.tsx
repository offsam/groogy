import { redirect } from "next/navigation";

/** Legacy recommendations → Community / Recommendations. */
export default function AdminRecommendationsRedirect() {
  redirect("/admin/community/recommendations");
}
