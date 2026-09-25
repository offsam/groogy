/**
 * Turns independent observations into one snapshot.
 * No network and no model calls.
 */

import { detectPathConflicts } from "../conflicts";
import type {
  ConnectionRecord,
  ConnectionStatus,
  DeliveryStage,
  DeploymentState,
  LocalVisibility,
  LocalWorkReport,
  ObservedInputs,
  ProjectIssue,
  ProjectSnapshot,
  PullRequestState,
  SourceState,
  TaskInput,
  TaskProgress,
} from "./types";

const BEHIND_WARNING = 5;

export function reconcileProject(input: ObservedInputs, previousIssues: ProjectIssue[] = []): ProjectSnapshot {
  const tasks = input.tasks.map((task) => progressFor(task, input));
  const detected = detectIssues(input, tasks);
  const issues = mergeIssues(previousIssues, detected, input.now);
  return {
    takenAt: input.now,
    connections: connectionsOf(input, tasks),
    tasks,
    issues: issues.filter((issue) => issue.status === "open"),
    conflicts: conflictLines(tasks),
    githubRepo: input.github.value.repo,
    branches: input.github.status === "connected" ? input.github.value.branches : [],
    mainSha: input.github.value.mainSha,
    defaultBranch: input.github.value.defaultBranch,
    productionSha: readyProduction(input)?.sha ?? null,
    productionStatus: input.vercel.value.production?.status ?? null,
    productionUrl: input.vercel.value.production?.url ?? null,
  };
}

function progressFor(task: TaskInput, input: ObservedInputs): TaskProgress {
  const report = matchingReport(task, input.localReports);
  const branch = input.github.value.branches.find((item) => item.name === task.branchName);
  const openPr = input.github.value.pulls.find((item) => item.headRef === task.branchName && !item.merged);
  const mergedPr = input.github.value.pulls.find((item) => item.headRef === task.branchName && item.merged);
  const pr = openPr ?? mergedPr ?? null;
  const sha = pr?.headSha || branch?.sha || report?.headSha || null;
  const preview = input.vercel.value.previews.find((item) => item.sha && item.sha === sha) ?? null;
  const readyPreview = preview?.status === "READY" ? preview : null;
  const production = readyProduction(input);
  const productionMatches =
    input.vercel.status === "connected" && sha ? Boolean(production?.sha && production.sha === sha) : null;
  const delivery = deliveryOf({
    report,
    branchSeen: Boolean(branch),
    openPr,
    previewReady: Boolean(readyPreview),
    merged: Boolean(mergedPr),
    productionMatches: productionMatches === true,
  });
  return {
    taskId: task.id,
    title: task.title,
    taskStatus: task.status,
    assignee: input.members.find((member) => member.id === task.assignedMemberId)?.displayName ?? null,
    branch: task.branchName,
    sha,
    prNumber: pr?.number ?? null,
    prUrl: pr?.url || null,
    checks: pr?.checks ?? null,
    delivery,
    local: localVisibility(report, input),
    previewUrl: readyPreview?.url ?? null,
    previewStatus: preview?.status ?? null,
    productionMatches,
    evidence: evidenceOf(task, pr, sha, preview, production, input.now),
    checkedAt: input.now,
    paths: uniquePaths(task.scopePaths, pr?.files ?? [], report?.changedPaths ?? []),
  };
}

function deliveryOf(flags: {
  report: LocalWorkReport | null;
  branchSeen: boolean;
  openPr: PullRequestState | undefined;
  previewReady: boolean;
  merged: boolean;
  productionMatches: boolean;
}): DeliveryStage {
  if (flags.productionMatches) return "production_deployed";
  if (flags.merged) return "merged";
  if (flags.previewReady) return "preview_ready";
  if (flags.openPr?.checks === "success") return "checks_passed";
  if (flags.openPr) return "pr_open";
  if (flags.branchSeen) return "pushed";
  if (flags.report?.headSha && !flags.report.dirty) return "committed";
  if (flags.report?.dirty) return "local_work";
  return "not_started";
}

function localVisibility(report: LocalWorkReport | null, input: ObservedInputs): LocalVisibility {
  if (!report) return "unknown";
  const age = Date.parse(input.now) - Date.parse(report.reportedAt);
  if (!Number.isFinite(age) || age > input.staleAfterMs) return "stale";
  return report.dirty ? "dirty" : "clean";
}

function detectIssues(input: ObservedInputs, tasks: TaskProgress[]): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const open = (issue: Omit<ProjectIssue, "detectedAt" | "lastSeenAt" | "status">) => {
    issues.push({ ...issue, detectedAt: input.now, lastSeenAt: input.now, status: "open" });
  };
  const githubReady = input.github.status === "connected";
  if (githubReady) {
    for (const branch of input.github.value.branches) {
      if (branch.behind !== null && branch.behind >= BEHIND_WARNING && branch.name !== input.github.value.defaultBranch) {
        open({
          key: `git-behind:${branch.name}`,
          severity: "warning",
          source: "github",
          component: branch.name,
          evidence: `Ветка отстаёт от ${input.github.value.defaultBranch ?? "main"} на ${branch.behind} коммитов. SHA ${branch.sha}. Проверено ${input.now}.`,
          nextAction: "Обновить ветку от актуального main до открытия PR.",
        });
      }
    }
    for (const pull of input.github.value.pulls.filter((item) => !item.merged)) {
      if (pull.mergeable === false) {
        open({
          key: `pr-conflict:${pull.number}`,
          severity: "blocking",
          source: "github",
          component: `PR #${pull.number}`,
          evidence: `PR #${pull.number} (${pull.url || pull.headRef}) имеет конфликт слияния. Проверено ${input.now}.`,
          nextAction: "Разрешить конфликт в ветке PR и обновить его.",
        });
      }
      if (pull.checks === "failure") {
        open({
          key: `ci-failed:${pull.number}`,
          severity: "blocking",
          source: "ci",
          component: `PR #${pull.number}`,
          evidence: `Проверки PR #${pull.number} завершились с ошибкой. SHA ${pull.headSha}. ${pull.url}`.trim(),
          nextAction: "Открыть упавшую проверку и исправить её до review.",
        });
      }
      if (pull.checks === "pending") {
        open({
          key: `ci-pending:${pull.number}`,
          severity: "info",
          source: "ci",
          component: `PR #${pull.number}`,
          evidence: `Проверки PR #${pull.number} ещё идут. SHA ${pull.headSha}.`,
          nextAction: "Дождаться завершения проверок.",
        });
      }
    }
    for (const task of input.tasks) {
      if (!task.branchName || task.status === "cancelled") continue;
      const known = input.github.value.branches.some((branch) => branch.name === task.branchName);
      const pr = input.github.value.pulls.some((item) => item.headRef === task.branchName);
      if (!known && !pr && task.status !== "completed") {
        open({
          key: `branch-missing:${task.id}`,
          severity: "warning",
          source: "github",
          component: task.title,
          evidence: `У задачи указана ветка ${task.branchName}, на GitHub её нет. Проверено ${input.now}.`,
          nextAction: "Проверить, не удалена ли ветка, и обновить задачу.",
        });
      }
      if (task.status === "completed" && !pr) {
        open({
          key: `completed-without-pr:${task.id}`,
          severity: "warning",
          source: "github",
          component: task.title,
          evidence: `Задача в статусе completed, PR для ветки ${task.branchName} не найден. Проверено ${input.now}.`,
          nextAction: "Не считать задачу выложенной, пока нет PR или явной отметки, что код не нужен.",
        });
      }
    }
  }
  for (const line of conflictLines(tasks)) {
    open({
      key: `paths:${line}`,
      severity: "warning",
      source: "git",
      component: "files",
      evidence: `${line} Проверено ${input.now}.`,
      nextAction: "Согласовать порядок правок общих файлов.",
    });
  }
  for (const preview of input.vercel.value.previews) {
    if (preview.status === "ERROR") {
      open({
        key: `preview-error:${preview.id}`,
        severity: "blocking",
        source: "vercel",
        component: preview.branch ?? preview.id,
        evidence: `Preview ${preview.id} для SHA ${preview.sha ?? "неизвестен"} завершился ошибкой. ${preview.url ?? ""}`.trim(),
        nextAction: "Открыть лог сборки Preview. Push в GitHub не заменяет успешный deployment.",
      });
    }
  }
  const production = input.vercel.value.production;
  if (production?.status === "ERROR") {
    open({
      key: `production-error:${production.id}`,
      severity: "blocking",
      source: "vercel",
      component: "production",
      evidence: `Production deployment ${production.id} завершился ошибкой. SHA ${production.sha ?? "неизвестен"}.`,
      nextAction: "Ошибка сборки не означает, что изменение опубликовано.",
    });
  }
  if (
    input.vercel.status === "connected" &&
    input.github.status === "connected" &&
    input.github.value.mainSha &&
    production?.status === "READY" &&
    production.sha &&
    production.sha !== input.github.value.mainSha
  ) {
    open({
      key: "production-sha-differs",
      severity: "info",
      source: "vercel",
      component: "production",
      evidence: `main ${input.github.value.mainSha} и production ${production.sha} различаются. Проверено ${input.now}.`,
      nextAction: "Не называть main опубликованным, пока production SHA не совпадёт.",
    });
  }
  if (input.supabase.status === "connected") {
    for (const version of input.supabase.pending) {
      open({
        key: `migration-pending:${version}`,
        severity: "warning",
        source: "supabase",
        component: version,
        evidence: `Файл миграции ${version} есть в репозитории и не найден в удалённой истории. Совпадение имён не доказывает совпадение схемы.`,
        nextAction: "Показать файл владельцу. Не применять миграцию из чата.",
      });
    }
    for (const version of input.supabase.unknownRemote) {
      open({
        key: `migration-unknown:${version}`,
        severity: "warning",
        source: "supabase",
        component: version,
        evidence: `В удалённой истории есть ${version}, такого файла в репозитории нет.`,
        nextAction: "Проверить, не потерян ли файл и не относится ли версия к repair history.",
      });
    }
  }
  for (const task of tasks) {
    if (task.local === "stale") {
      open({
        key: `local-stale:${task.taskId}`,
        severity: "info",
        source: "cursor",
        component: task.title,
        evidence: `Последний локальный отчёт по «${task.title}» устарел. Проверено ${input.now}.`,
        nextAction: "Попросить автора снова отправить локальный отчёт.",
      });
    }
  }
  if (input.openrouter.status === "authorization_failed" || /billing|credit|limit/i.test(input.openrouter.error ?? "")) {
    open({
      key: "openrouter",
      severity: "blocking",
      source: "openrouter",
      component: "ai",
      evidence: input.openrouter.error ?? "OpenRouter отклонил проверку ключа.",
      nextAction: "Проверить баланс и лимит ключа в кабинете OpenRouter.",
    });
  }
  if (input.telegram.error) {
    open({
      key: "telegram-webhook",
      severity: "warning",
      source: "telegram",
      component: "webhook",
      evidence: input.telegram.error,
      nextAction: "Проверить, что webhook указывает на доступный Preview.",
    });
  }
  return issues;
}

function conflictLines(tasks: TaskProgress[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const left = tasks[i];
      const right = tasks[j];
      if (!left || !right) continue;
      if (left.taskStatus === "cancelled" || right.taskStatus === "cancelled") continue;
      const report = detectPathConflicts(left.paths, right.paths);
      if (report.severity === "none") continue;
      lines.push(`${left.title} и ${right.title}: ${report.overlaps.map((item) => item.pathA).join(", ")}`);
    }
  }
  return lines;
}

function connectionsOf(input: ObservedInputs, tasks: TaskProgress[]): ConnectionRecord[] {
  const latestLocal = [...input.localReports].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0];
  const localStatus: ConnectionStatus = !latestLocal
    ? "not_configured"
    : tasks.some((task) => task.local === "stale") && tasks.every((task) => task.local !== "dirty" && task.local !== "clean")
      ? "stale"
      : Date.parse(input.now) - Date.parse(latestLocal.reportedAt) > input.staleAfterMs
        ? "stale"
        : "connected";
  const ciStatus: ConnectionStatus =
    input.github.status === "not_configured"
      ? "not_configured"
      : input.github.status === "connected"
        ? "connected"
        : input.github.status;
  return [
    sourceConnection("github", input.github, "чтение репозитория", input.github.value.repo ? [input.github.value.repo] : []),
    sourceConnection("ci", { ...input.github, status: ciStatus }, "статусы проверок через GitHub", []),
    sourceConnection("vercel", input.vercel, "чтение deployments", []),
    sourceConnection(
      "supabase",
      { status: input.supabase.status, checkedAt: input.supabase.checkedAt, error: input.supabase.error, value: {} },
      "история миграций, без изменений базы",
      [],
    ),
    {
      provider: "cursor",
      status: localStatus,
      lastSuccessfulSync: latestLocal?.reportedAt ?? null,
      lastAttemptedSync: latestLocal?.reportedAt ?? null,
      lastError: null,
      permissions: "только отчёт разработчика",
      resources: [],
      fresh: localStatus === "connected",
    },
    sourceConnection("openrouter", input.openrouter, "проверка ключа, без генерации", []),
    sourceConnection("telegram", input.telegram, "webhook бота", input.telegram.value.webhookUrl ? ["webhook"] : []),
  ];
}

function sourceConnection(
  provider: ConnectionRecord["provider"],
  source: SourceState<unknown>,
  permissions: string,
  resources: string[],
): ConnectionRecord {
  return {
    provider,
    status: source.status,
    lastSuccessfulSync: source.status === "connected" ? source.checkedAt : null,
    lastAttemptedSync: source.checkedAt,
    lastError: source.error,
    permissions,
    resources,
    fresh: source.status === "connected",
  };
}

export function mergeIssues(previous: ProjectIssue[], detected: ProjectIssue[], now: string): ProjectIssue[] {
  const found = new Map(detected.map((issue) => [issue.key, issue]));
  const merged: ProjectIssue[] = detected.map((issue) => {
    const prior = previous.find((item) => item.key === issue.key);
    return prior ? { ...issue, detectedAt: prior.detectedAt, lastSeenAt: now } : issue;
  });
  for (const issue of previous) {
    if (issue.status === "open" && !found.has(issue.key)) {
      merged.push({ ...issue, status: "resolved", lastSeenAt: now });
    }
  }
  return merged;
}

function matchingReport(task: TaskInput, reports: LocalWorkReport[]): LocalWorkReport | null {
  const rows = reports.filter((report) => report.taskId === task.id || (task.branchName && report.branch === task.branchName));
  return rows.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0] ?? null;
}

function readyProduction(input: ObservedInputs): DeploymentState | null {
  const production = input.vercel.value.production;
  return production?.status === "READY" ? production : null;
}

function evidenceOf(
  task: TaskInput,
  pr: PullRequestState | null,
  sha: string | null,
  preview: DeploymentState | null,
  production: DeploymentState | null,
  checkedAt: string,
): string {
  const parts = [`задача ${task.title}`, `проверено ${checkedAt}`];
  if (sha) parts.push(`SHA ${sha}`);
  if (pr) parts.push(`PR #${pr.number}${pr.url ? ` ${pr.url}` : ""}`);
  if (preview) parts.push(`Preview ${preview.status}${preview.url ? ` ${preview.url}` : ""}`);
  if (production?.sha) parts.push(`production SHA ${production.sha}`);
  return parts.join(". ");
}

function uniquePaths(...groups: string[][]): string[] {
  return [...new Set(groups.flat().map((path) => path.trim()).filter(Boolean))];
}
