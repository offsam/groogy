import type { Metadata } from "next";
import { AuthLinks, AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { authMessage, safeRedirectPath } from "@/lib/auth/messages";

export const metadata: Metadata = {
  title: "Вход — КРУГИ",
};

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeRedirectPath(params.next);
  const initialError =
    params.error === "auth_callback" || params.error === "callback_failed"
      ? authMessage("callback_failed")
      : null;

  return (
    <AuthShell
      footer={
        <AuthLinks
          links={[
            { href: `/register?next=${encodeURIComponent(nextPath)}`, label: "Регистрация" },
            { href: "/forgot-password", label: "Забыли пароль?" },
          ]}
        />
      }
      subtitle="Войдите, чтобы управлять профилем и заявками на бизнес."
      title="Вход"
    >
      <LoginForm initialError={initialError} nextPath={nextPath} />
    </AuthShell>
  );
}
