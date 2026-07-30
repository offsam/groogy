import type { Metadata } from "next";
import { AdminComingSoon } from "@/components/admin/AdminComingSoon";

export const metadata: Metadata = {
  title: "Admins — Admin",
};

export default function AdminUsersAdminsPage() {
  return (
    <AdminComingSoon
      title="Users · Admins"
      description="Отдельный список администраторов. Сейчас роли назначаются на общей странице пользователей."
      legacyHref="/admin/users"
      legacyLabel="Пользователи и роли"
    />
  );
}
