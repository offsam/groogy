import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { KrugiPinIcon } from "@/components/brand/KrugiPinIcon";

type HeaderAuthProps = {
  email: string | null;
  displayName: string | null;
  username: string | null;
};

export function HeaderAuth({
  email,
  displayName,
  username,
}: HeaderAuthProps) {
  const label = displayName?.trim() || email || "Профиль";
  const href = username ? `/u/${username}` : "/profile";

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <Link
        aria-label={label}
        className="inline-flex shrink-0 transition hover:opacity-90"
        href={href}
        title={label}
      >
        <KrugiPinIcon className="size-9 sm:size-10" name="profile" />
      </Link>
      <form action={signOutAction}>
        <button
          aria-label="Выйти"
          className="inline-flex shrink-0 transition hover:opacity-90"
          title="Выйти"
          type="submit"
        >
          <KrugiPinIcon className="size-9 sm:size-10" name="logout" />
        </button>
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
