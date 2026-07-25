import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </div>
      {footer && <div className="text-center text-sm text-slate-500">{footer}</div>}
    </div>
  );
}

export function AuthAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "info"
        ? "border-sky-200 bg-sky-50 text-sky-800"
        : "border-red-200 bg-red-50 text-red-800";

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`} role="alert">
      {children}
    </div>
  );
}

export function AuthField({
  label,
  id,
  type = "text",
  name,
  autoComplete,
  required,
  defaultValue,
  placeholder,
  minLength,
}: {
  label: string;
  id: string;
  type?: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  minLength?: number;
}) {
  return (
    <label className="block space-y-1.5 text-sm" htmlFor={id}>
      <span className="font-medium text-slate-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
        defaultValue={defaultValue}
        id={id}
        minLength={minLength}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

export function AuthLinks({
  links,
}: {
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <p className="space-x-1">
      {links.map((link, index) => (
        <span key={link.href}>
          {index > 0 && <span className="text-slate-300">·</span>}{" "}
          <Link className="font-medium text-slate-900 underline-offset-2 hover:underline" href={link.href}>
            {link.label}
          </Link>
        </span>
      ))}
    </p>
  );
}
