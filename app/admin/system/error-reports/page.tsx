import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminErrorReportsPanel } from "@/components/admin/AdminErrorReportsPanel";
import {
  listErrorReportsAction,
  type PlatformErrorReportType,
} from "@/lib/error-reports/actions";
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
    { id: "needs_attention", label: "Требуют внимания" },
    { id: "reviewed", label: "Просмотренные" },
    { id: "resolved", label: "Решённые" },
    { id: "dismissed", label: "Отклонённые" },
    { id: "all", label: "Все" },
  ];

const TYPE_FILTERS: Array<{ id: PlatformErrorReportType | "all"; label: string }> =
  [
    { id: "all", label: "Все типы" },
    { id: "error", label: "Ошибки" },
    { id: "question", label: "Вопросы" },
    { id: "complaint", label: "Жалобы" },
  ];

type PageProps = {
  searchParams: Promise<{ status?: string; type?: string }>;
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
  const rawType = params.type ?? "all";
  const typeFilter = (
    TYPE_FILTERS.some((t) => t.id === rawType) ? rawType : "all"
  ) as PlatformErrorReportType | "all";

  function buildHref(next: { status?: string; type?: string }) {
    const qs = new URLSearchParams();
    const status = next.status ?? filter;
    const type = next.type ?? typeFilter;
    if (status !== "open") qs.set("status", status);
    if (type !== "all") qs.set("type", type);
    const query = qs.toString();
    return query
      ? `/admin/system/error-reports?${query}`
      : "/admin/system/error-reports";
  }

  const result = await listErrorReportsAction({
    status: filter,
    reportType: typeFilter,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">System</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Error Reports
        </h1>
        <p className="mt-2 text-slate-500">
          Обращения от пользователей трёх типов: ошибки и вопросы — из меню
          поддержки в шапке сайта; жалобы — с кнопки-флажка на карточках
          бизнесов, специалистов и других разделов.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Кнопка «Почини» (только для ошибок) создаёт GitHub Issue с текстом
          репорта и упоминанием{" "}
          <code className="text-xs">@claude</code> — это запускает воркфлоу{" "}
          <code className="text-xs">.github/workflows/claude-fix.yml</code>,
          который читает код и вносит правку. Когда Claude заканчивает,
          статус репорта меняется сам: «Решена» — если открыт Pull Request
          на ревью (ничего не мержится и не деплоится автоматически), или
          «Требует внимания» — если Claude решил, что чинить вслепую
          небезопасно, и оставил объяснение в Issue. Под текстом репорта
          появится короткий отчёт о том, что было сделано. Чтобы кнопка
          заработала: 1) поставьте GitHub-приложение Claude на репозиторий
          (github.com/apps/claude), 2) добавьте секрет с ключом/токеном
          Claude в GitHub Actions, 3) добавьте переменную{" "}
          <code className="text-xs">GITHUB_ISSUES_TOKEN</code> (fine-grained
          PAT с правом Issues: write на этот репозиторий) в Vercel, 4)
          добавьте одинаковый секрет{" "}
          <code className="text-xs">CLAUDE_FIX_WEBHOOK_SECRET</code> и в
          GitHub Actions, и в Vercel — им воркфлоу подтверждает Vercel, что
          отчёт настоящий.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TYPE_FILTERS.map((item) => (
          <Link
            key={item.id}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
              typeFilter === item.id
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
            )}
            href={buildHref({ type: item.id })}
          >
            {item.label}
          </Link>
        ))}
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
            href={buildHref({ status: item.id })}
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
