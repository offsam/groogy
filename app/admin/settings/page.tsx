import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Settings — Admin",
};

export default function AdminSettingsPage() {
  return (
    <AdminComingSoon
      title="Settings"
      description="Глобальные настройки Admin Panel. Раздел заложен в IA V2 — без legacy fallback."
    />
  );
}
