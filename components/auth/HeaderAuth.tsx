import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";
import { KrugiPinIcon } from "@/components/brand/KrugiPinIcon";

type HeaderAuthProps = {
  email: string | null;
  displayName: string | null;
};

export function HeaderAuth({ email, displayName }: HeaderAuthProps) {
  const label = displayName?.trim() || email || "Профиль";

  return (
    <div className="flex items-center gap-2">
      <Link
        className="inline-flex max-w-[10rem] items-center gap-1.5 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 sm:max-w-[14rem]"
        href="/profile"
        title={label}
      >
        <KrugiPinIcon className="size-6 shrink-0" name="profile" />
        <span className="truncate">{label}</span>
      </Link>
      <form action={signOutAction}>
        <Button
          aria-label="Выйти"
          className="gap-1.5 px-3"
          type="submit"
          variant="secondary"
        >
          <KrugiPinIcon className="size-5" name="logout" />
          <span className="hidden sm:inline">Выйти</span>
        </Button>
      </form>
    </div>
  );
}

export function HeaderGuestAuth() {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <Link
        className="rounded-lg px-2 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:px-3"
        href="/login"
      >
        Войти
      </Link>
      <Link
        className="rounded-lg border border-slate-900 bg-slate-900 px-2.5 py-2 text-sm font-medium transition-colors hover:bg-slate-800 sm:px-3"
        href="/register"
        style={{ color: "#ffffff" }}
      >
        <span className="sm:hidden">Рег.</span>
        <span className="hidden sm:inline">Регистрация</span>
      </Link>
    </div>
  );
}
