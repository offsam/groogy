import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Background Tasks — System — Admin",
};

export default function Page() {
  return (
    <AdminComingSoon
      title="System · Background Tasks"
      description="Очереди фоновых задач. Появится после единого task runner."
    />
  );
}
