import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminErrorReportsPanel } from "@/components/admin/AdminErrorReportsPanel";
import { listErrorReportsAction } from "@/lib/error-reports/actions";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import type { PlatformErrorReportStatus } from "@/types/database";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Error Reports — System — Admin",
};

export const dynamic = "force-dynamic";

const FILTERS: Array<{ id: PlatformErrorReportStatus | "all"; label: string }> =
  [
    { id: "open", label: "Открытые" },
    { id: "reviewed", label: "Просмотренные" },
    { id: "resolved", label: "Решённые" },
    { id: "dismissed", label: "Отклонённые" },
    { id: "all", label: "Все" },
  ];

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function AdminErrorReportsPage({ searchParams }: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/system/error-reports");
  }
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const raw = params.status ?? "open";
  const filter = (
    FILTERS.some((f) => f.id === raw) ? raw : "open"
  ) as PlatformErrorReportStatus | "all";

  const result = await listErrorReportsAction({ status: filter });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">System</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Error Reports
        </h1>
        <p className="mt-2 text-slate-500">
          Сообщения с плавающей кнопки «Ошибка»: текст и страница, с которой
          отправили.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/admin/system" className="text-brand-blue hover:underline">
            ← System
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.id}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
              filter === item.id
                ? "border-brand-blue bg-brand-blue text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
            )}
            href={
              item.id === "open"
                ? "/admin/system/error-reports"
                : `/admin/system/error-reports?status=${item.id}`
            }
          >
            {item.label}
          </Link>
        ))}
      </div>

      {!result.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {result.message}
          <p className="mt-2 text-red-600">
            Если миграция platform_error_reports ещё не применена — это ожидаемо.
          </p>
        </div>
      ) : (
        <AdminErrorReportsPanel filter={filter} reports={result.reports} />
      )}
    </div>
  );
}
