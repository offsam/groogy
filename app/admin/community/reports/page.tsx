import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Reports — Community — Admin",
};

export default function AdminCommunityReportsPage() {
  return (
    <AdminComingSoon
      title="Community · Reports"
      description="Единый центр жалоб (listings + reviews). Пока жалобы на отзывы — в Community · Reviews (filter=reported)."
      legacyHref="/admin/community/reviews?filter=reported"
      legacyLabel="Open reported reviews"
    />
  );
}
