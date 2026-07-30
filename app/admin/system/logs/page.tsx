import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Logs — System — Admin",
};

export default function Page() {
  return (
    <AdminComingSoon
      title="System · Logs"
      description="Просмотр логов админ-операций. Пока без централизованного log store."
    />
  );
}
