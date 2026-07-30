import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Health — System — Admin",
};

export default function Page() {
  return (
    <AdminComingSoon
      title="System · Health"
      description="Мониторинг сервисов и зависимостей. Backend health API пока не подключён."
    />
  );
}
