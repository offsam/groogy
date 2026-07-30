import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Roles — Admin",
};

export default function AdminUsersRolesPage() {
  return (
    <AdminComingSoon
      title="Users · Roles"
      description="Управление ролями и permissions. Phase 1: назначение admin/user на странице Users."
      legacyHref="/admin/users"
      legacyLabel="Пользователи"
    />
  );
}
