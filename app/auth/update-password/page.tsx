import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { UpdatePasswordForm } from "@/components/auth/UpdatePasswordForm";

export const metadata: Metadata = {
  title: "Новый пароль — КРУГИ",
};

export default function UpdatePasswordPage() {
  return (
    <AuthShell
      subtitle="Придумайте новый пароль для вашего аккаунта."
      title="Обновление пароля"
    >
      <UpdatePasswordForm />
    </AuthShell>
  );
}
