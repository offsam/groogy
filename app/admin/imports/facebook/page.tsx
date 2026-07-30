import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Facebook Imports — Admin",
};

export default function AdminImportsFacebookPage() {
  return (
    <AdminComingSoon
      title="Imports · Facebook"
      description="История и диагностика Facebook-групп. Модерация FB-кандидатов — в Review Center (Events / Recommendations Views)."
      legacyHref="/admin/review/inbox?view=events"
      legacyLabel="Open Events in Inbox"
    />
  );
}
