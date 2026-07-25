import type { Metadata } from "next";
import { AuthLinks, AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Восстановление пароля — КРУГИ",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      footer={<AuthLinks links={[{ href: "/login", label: "Вернуться ко входу" }]} />}
      subtitle="Укажите email — пришлём ссылку для сброса пароля."
      title="Восстановление пароля"
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
