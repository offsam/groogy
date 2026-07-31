import type { Metadata } from "next";
import { AuthLinks, AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { safeRedirectPath } from "@/lib/auth/messages";

export const metadata: Metadata = {
  title: "Регистрация — КРУГИ",
};

type RegisterPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const nextPath = safeRedirectPath(params.next ?? "/profile");

  return (
    <AuthShell
      footer={
        <AuthLinks
          links={[{ href: `/login?next=${encodeURIComponent(nextPath)}`, label: "Уже есть аккаунт? Войти" }]}
        />
      }
      subtitle="Создайте аккаунт — профиль появится автоматически после регистрации."
      title="Регистрация"
    >
      <RegisterForm nextPath={nextPath} />
    </AuthShell>
  );
}
