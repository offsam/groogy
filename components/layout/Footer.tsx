import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500 sm:px-6 lg:px-8">
        <span>
          © {new Date().getFullYear()} {BRAND_NAME}
        </span>
        <Link className="text-brand-blue hover:underline" href="/add-business">
          Добавить бизнес
        </Link>
      </div>
    </footer>
  );
}
