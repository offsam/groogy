import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Jobs — System — Admin",
};

export default function Page() {
  return (
    <AdminComingSoon
      title="System · Jobs"
      description="Управление фоновыми job-ами. Отдельного admin job runner UI пока нет."
    />
  );
}
