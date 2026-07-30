import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Diagnostics — System — Admin",
};

export default function Page() {
  return (
    <AdminComingSoon
      title="System · Diagnostics"
      description="Диагностика платформы и import pipelines. Используйте Imports · History для provenance."
      legacyHref="/admin/imports"
      legacyLabel="Open Imports"
    />
  );
}
