import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "CSV Imports — Admin",
};

export default function AdminImportsCsvPage() {
  return (
    <AdminComingSoon
      title="Imports · CSV"
      description="История CSV/one-off импортов и статусы пайплайна. Модерация загруженных записей — в Review Center Inbox."
      legacyHref="/admin/review/inbox"
      legacyLabel="Open Inbox"
    />
  );
}
