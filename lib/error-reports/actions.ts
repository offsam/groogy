"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import type { PlatformErrorReportStatus } from "@/types/database";

export type ErrorReportActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

export type PlatformErrorReportRow = {
  id: string;
  message: string;
  pagePath: string;
  pageUrl: string | null;
  userId: string | null;
  userAgent: string | null;
  status: PlatformErrorReportStatus;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  githubIssueUrl: string | null;
  autofixRequestedAt: string | null;
  autofixSummary: string | null;
  autofixPrUrl: string | null;
};

/** owner/repo this app's source lives in — used only for the auto-fix issue. */
const AUTOFIX_REPO = "offsam/groogy";

const STATUSES: PlatformErrorReportStatus[] = [
  "open",
  "reviewed",
  "resolved",
  "dismissed",
];

function fail(message: string): ErrorReportActionResult {
  return { ok: false, message };
}

function ok(message?: string): ErrorReportActionResult {
  return { ok: true, message };
}

function sanitizePath(raw: string): string | null {
  const path = raw.trim();
  if (!path || path.length > 2000) return null;
  if (!path.startsWith("/")) return null;
  if (path.includes("://") || path.includes("\n") || path.includes("\r")) {
    return null;
  }
  return path;
}

function sanitizeUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > 4000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { supabase, user, error: fail("Только для администраторов.") };
  }
  return { supabase, user, error: null };
}

/** Anyone (anon or signed-in) can submit a site error report. */
export async function submitErrorReportAction(input: {
  message: string;
  pagePath: string;
  pageUrl?: string | null;
}): Promise<ErrorReportActionResult> {
  const message = input.message.trim();
  if (message.length < 3) {
    return fail("Опишите ошибку чуть подробнее.");
  }
  if (message.length > 4000) {
    return fail("Сообщение слишком длинное.");
  }

  const pagePath = sanitizePath(input.pagePath);
  if (!pagePath) return fail("Некорректная страница.");

  const pageUrl = sanitizeUrl(input.pageUrl);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateKey = `error-report:${user?.id ?? "anon"}:${pagePath.slice(0, 80)}`;
  const limited = consumeRateLimit(rateKey, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return fail("Слишком много сообщений. Подождите немного.");
  }

  const headerStore = await headers();
  const userAgent = headerStore.get("user-agent")?.slice(0, 1000) ?? null;

  const { error } = await supabase.from("platform_error_reports").insert({
    message,
    page_path: pagePath,
    page_url: pageUrl,
    user_id: user?.id ?? null,
    user_agent: userAgent,
  });

  if (error) {
    return fail("Не удалось отправить. Попробуйте ещё раз.");
  }

  revalidatePath("/admin/system/error-reports");
  return ok("Спасибо! Сообщение отправлено.");
}

export async function listErrorReportsAction(input?: {
  status?: PlatformErrorReportStatus | "all";
}): Promise<
  | { ok: true; reports: PlatformErrorReportRow[] }
  | { ok: false; message: string; reports: [] }
> {
  const { supabase, error } = await requireAdmin();
  if (error) {
    return {
      ok: false,
      message: error.ok === false ? error.message : "Только для администраторов.",
      reports: [],
    };
  }

  let query = supabase
    .from("platform_error_reports")
    .select(
      "id, message, page_path, page_url, user_id, user_agent, status, admin_note, reviewed_by, reviewed_at, created_at, github_issue_url, autofix_requested_at, autofix_summary, autofix_pr_url",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const status = input?.status ?? "open";
  if (status !== "all" && STATUSES.includes(status)) {
    query = query.eq("status", status);
  }

  const { data, error: queryError } = await query;
  if (queryError) {
    return {
      ok: false,
      message: "Не удалось загрузить сообщения об ошибках.",
      reports: [],
    };
  }

  return {
    ok: true,
    reports: (data ?? []).map((row) => ({
      id: row.id,
      message: row.message,
      pagePath: row.page_path,
      pageUrl: row.page_url,
      userId: row.user_id,
      userAgent: row.user_agent,
      status: row.status,
      adminNote: row.admin_note,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      githubIssueUrl: row.github_issue_url,
      autofixRequestedAt: row.autofix_requested_at,
      autofixSummary: row.autofix_summary,
      autofixPrUrl: row.autofix_pr_url,
    })),
  };
}

/**
 * Admin clicks "Почини" on a report: files a GitHub issue + a follow-up
 * comment mentioning @claude, which triggers the claude-code-action
 * workflow (.github/workflows/claude-fix.yml) to investigate and open a
 * PR. Nothing here touches production directly — it only ever produces a
 * PR for a human to review and merge.
 *
 * Requires the GITHUB_ISSUES_TOKEN env var (fine-grained PAT, Issues:
 * write, scoped to this repo only) — see docs/architecture or the admin
 * page copy for setup steps. Missing token fails loudly but never crashes
 * the page (same "missing env must never take the whole site down"
 * pattern used elsewhere in this app).
 */
export async function triggerErrorReportAutofixAction(input: {
  id: string;
}): Promise<ErrorReportActionResult> {
  const { supabase, user, error } = await requireAdmin();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const token = process.env.GITHUB_ISSUES_TOKEN?.trim();
  if (!token) {
    return fail(
      "GITHUB_ISSUES_TOKEN не настроен в переменных окружения Vercel. См. инструкцию на этой странице.",
    );
  }

  const { data: report, error: fetchError } = await supabase
    .from("platform_error_reports")
    .select("id, message, page_path, page_url, github_issue_url")
    .eq("id", input.id)
    .maybeSingle();
  if (fetchError || !report) return fail("Репорт не найден.");
  if (report.github_issue_url) {
    return fail("Issue уже создан для этого репорта.");
  }

  const rateKey = `error-report-autofix:${user.id}`;
  const limited = consumeRateLimit(rateKey, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) {
    return fail("Слишком много запросов на автопочинку. Подождите немного.");
  }

  const title = `[auto-fix] ${report.message.slice(0, 80).replace(/\s+/g, " ").trim()}`;
  const body = [
    `Репорт с сайта, страница: \`${report.page_path}\``,
    report.page_url ? `URL: ${report.page_url}` : null,
    "",
    "Описание от пользователя:",
    "> " + report.message.replace(/\n/g, "\n> "),
    "",
    `_Admin error-report id: ${report.id}_`,
  ]
    .filter((x): x is string => x !== null)
    .join("\n");

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  try {
    const issueRes = await fetch(
      `https://api.github.com/repos/${AUTOFIX_REPO}/issues`,
      { method: "POST", headers: ghHeaders, body: JSON.stringify({ title, body }) },
    );
    if (!issueRes.ok) {
      const text = await issueRes.text().catch(() => "");
      return fail(`GitHub API отказал (${issueRes.status}): ${text.slice(0, 300)}`);
    }
    const issue = (await issueRes.json()) as { html_url: string; number: number };

    // Separate comment (not the issue body) so the @claude mention lands
    // as an issue_comment event, matching the documented default trigger.
    await fetch(
      `https://api.github.com/repos/${AUTOFIX_REPO}/issues/${issue.number}/comments`,
      {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          body: "@claude почини эту ошибку. Разберись в причине, внеси минимально необходимую правку и открой Pull Request — не мержи и не деплой сам.",
        }),
      },
    );

    await supabase
      .from("platform_error_reports")
      .update({
        github_issue_url: issue.html_url,
        autofix_requested_by: user.id,
        autofix_requested_at: new Date().toISOString(),
      })
      .eq("id", report.id);

    revalidatePath("/admin/system/error-reports");
    return ok(`Issue создан: ${issue.html_url}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Не удалось создать issue.");
  }
}

export async function updateErrorReportStatusAction(input: {
  id: string;
  status: PlatformErrorReportStatus;
  adminNote?: string | null;
}): Promise<ErrorReportActionResult> {
  const { supabase, user, error } = await requireAdmin();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  if (!STATUSES.includes(input.status)) {
    return fail("Некорректный статус.");
  }

  const adminNote = input.adminNote?.trim() || null;
  if (adminNote && adminNote.length > 2000) {
    return fail("Заметка слишком длинная.");
  }

  const { error: updateError } = await supabase
    .from("platform_error_reports")
    .update({
      status: input.status,
      admin_note: adminNote,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  if (updateError) {
    return fail("Не удалось обновить статус.");
  }

  revalidatePath("/admin/system/error-reports");
  return ok("Статус обновлён.");
}
