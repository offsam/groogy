/**
 * Short Russian answers from a snapshot. No model.
 */

import type { ConnectionRecord, ProjectSnapshot, TaskProgress } from "./types";

export type ProjectTopic =
  | "connections"
  | "full"
  | "people"
  | "unpushed"
  | "branches"
  | "prs"
  | "preview"
  | "production"
  | "ready_not_live"
  | "main_not_prod"
  | "migrations"
  | "issues"
  | "sync"
  | "blockers"
  | "not_in_main";

const CONNECTION_LABEL: Record<ConnectionRecord["provider"], string> = {
  github: "GitHub",
  vercel: "Vercel",
  supabase: "Supabase",
  cursor: "Cursor",
  ci: "CI",
  openrouter: "OpenRouter",
  telegram: "Telegram",
};

export function formatProjectAnswer(topic: ProjectTopic, snapshot: ProjectSnapshot): string {
  if (topic === "connections") return formatConnections(snapshot);
  if (topic === "people") return formatPeople(snapshot);
  if (topic === "unpushed") return formatUnpushed(snapshot);
  if (topic === "branches") return formatBranches(snapshot);
  if (topic === "prs") return formatPulls(snapshot);
  if (topic === "preview") return formatPreview(snapshot);
  if (topic === "production") return formatProduction(snapshot);
  if (topic === "ready_not_live") return formatReadyNotLive(snapshot);
  if (topic === "main_not_prod") return formatMainNotProduction(snapshot);
  if (topic === "not_in_main") return formatNotInMain(snapshot);
  if (topic === "migrations") return formatMigrations(snapshot);
  if (topic === "issues") return formatIssues(snapshot);
  if (topic === "sync") return formatSync(snapshot);
  if (topic === "blockers") return formatBlockers(snapshot);
  return formatFull(snapshot);
}

export function snapshotBrief(snapshot: ProjectSnapshot): string[] {
  return [
    `снимок ${snapshot.takenAt}`,
    `main ${snapshot.mainSha ?? "неизвестен"}`,
    `production ${snapshot.productionSha ?? "неизвестен"} (${snapshot.productionStatus ?? "нет данных"})`,
    ...snapshot.tasks.slice(0, 6).map((task) => `${task.title}: задача ${task.taskStatus}, доставка ${task.delivery}`),
    ...snapshot.issues.slice(0, 4).map((issue) => `проблема ${issue.component}: ${issue.evidence}`),
  ];
}

function formatFull(snapshot: ProjectSnapshot): string {
  return [
    "KROOGY — СТАТУС ПРОЕКТА",
    "",
    "Production",
    formatProduction(snapshot),
    "",
    "Preview",
    formatPreview(snapshot),
    "",
    "GitHub",
    formatBranches(snapshot),
    formatPulls(snapshot),
    "",
    "Команда",
    formatPeople(snapshot),
    "",
    "Supabase",
    formatMigrations(snapshot),
    "",
    "Проблемы",
    formatIssues(snapshot),
    "",
    "Дальше",
    formatBlockers(snapshot),
    `Проверено ${snapshot.takenAt}.`,
  ].join("\n");
}

function formatConnections(snapshot: ProjectSnapshot): string {
  return snapshot.connections
    .map((item) => {
      const sync = item.lastSuccessfulSync ?? "ещё не было";
      const problem = item.lastError ? ` Ошибка: ${item.lastError}` : "";
      return `${CONNECTION_LABEL[item.provider]}: ${statusRu(item.status)}. Последняя успешная проверка: ${sync}.${problem}`;
    })
    .join("\n");
}

function formatPeople(snapshot: ProjectSnapshot): string {
  if (snapshot.tasks.length === 0) return "Активных задач с исполнителями нет. Локальная работа без отчёта отсюда не видна.";
  return snapshot.tasks
    .map((task) => `${task.assignee ?? "без исполнителя"} — ${task.title}. ${deliverySentence(task)} ${localSentence(task)}`)
    .join("\n");
}

function formatUnpushed(snapshot: ProjectSnapshot): string {
  const rows = snapshot.tasks.filter((task) => task.delivery === "local_work" || task.delivery === "committed" || task.local === "dirty");
  if (rows.length === 0) {
    const unknown = snapshot.tasks.filter((task) => task.local === "unknown");
    if (unknown.length) {
      return `Незапушенные изменения по отчётам не видны. ${unknown.map((task) => `${task.title}: локальное состояние неизвестно`).join(". ")}.`;
    }
    return "Свежих локальных отчётов с незапушенными изменениями нет. Это не значит, что на компьютерах ничего не лежит.";
  }
  return rows.map((task) => `${task.assignee ?? task.title}: ${localSentence(task)} Ветка ${task.branch ?? "не указана"}.`).join("\n");
}

function formatBranches(snapshot: ProjectSnapshot): string {
  const github = connection(snapshot, "github");
  if (github?.status !== "connected") return `GitHub: ${statusRu(github?.status ?? "not_configured")}. Ветки я не выдумываю.`;
  const names = snapshot.branches.map((branch) => branch.name).filter((name) => name !== snapshot.defaultBranch);
  return names.length
    ? `Репозиторий ${snapshot.githubRepo ?? ""}. main ${snapshot.mainSha ?? "неизвестен"}. Активные ветки: ${names.join(", ")}.`
    : `Репозиторий ${snapshot.githubRepo ?? ""}. main ${snapshot.mainSha ?? "неизвестен"}. Кроме ${snapshot.defaultBranch ?? "main"} других веток не видно.`;
}

function formatPulls(snapshot: ProjectSnapshot): string {
  const github = connection(snapshot, "github");
  if (github?.status !== "connected") return "GitHub не подключён. Открытые PR я не вижу.";
  const waiting = snapshot.tasks.filter((task) => task.prNumber && task.delivery !== "merged" && task.delivery !== "production_deployed");
  if (waiting.length === 0) return "Открытых PR, связанных с задачами, не видно.";
  return waiting.map((task) => `PR #${task.prNumber} — ${task.title}. ${task.evidence}`).join("\n");
}

function formatPreview(snapshot: ProjectSnapshot): string {
  const vercel = connection(snapshot, "vercel");
  if (vercel?.status !== "connected") return "Vercel не подключён. По Preview я ничего не утверждаю.";
  const errors = snapshot.issues.filter((issue) => issue.key.startsWith("preview-error:"));
  const ready = snapshot.tasks.filter((task) => task.delivery === "preview_ready" || task.previewStatus === "READY");
  if (errors.length && ready.length === 0) return errors.map((issue) => issue.evidence).join("\n");
  if (ready.length === 0) return "Готовых Preview, совпавших по commit SHA с задачами, сейчас нет.";
  return ready.map((task) => `${task.title}: Preview готов${task.previewUrl ? ` ${task.previewUrl}` : ""}. ${task.evidence}`).join("\n");
}

function formatProduction(snapshot: ProjectSnapshot): string {
  const vercel = connection(snapshot, "vercel");
  if (vercel?.status !== "connected") return "Что сейчас на сайте: Vercel не подключён, опубликованный commit неизвестен.";
  if (snapshot.productionStatus === "ERROR") {
    return `Последняя production-сборка завершилась ошибкой. Это не опубликованное изменение. SHA ${snapshot.productionSha ?? "неизвестен"}.`;
  }
  if (!snapshot.productionSha) return "Production deployment в статусе READY не найден.";
  return `На сайте опубликован commit ${snapshot.productionSha}. Статус ${snapshot.productionStatus}. Проверено ${snapshot.takenAt}.${snapshot.productionUrl ? ` ${snapshot.productionUrl}` : ""}`;
}

function formatReadyNotLive(snapshot: ProjectSnapshot): string {
  const rows = snapshot.tasks.filter(
    (task) =>
      (task.delivery === "preview_ready" || task.delivery === "merged" || task.delivery === "checks_passed") &&
      task.productionMatches !== true,
  );
  if (rows.length === 0) return "Нет задач, которые уже проверены или собраны в Preview и при этом отсутствуют в production.";
  return rows.map((task) => deliverySentence(task)).join("\n");
}

function formatMainNotProduction(snapshot: ProjectSnapshot): string {
  if (connection(snapshot, "github")?.status !== "connected" || connection(snapshot, "vercel")?.status !== "connected") {
    return "Чтобы сравнить main и сайт, нужны оба подключения: GitHub и Vercel.";
  }
  if (snapshot.mainSha && snapshot.productionSha && snapshot.mainSha === snapshot.productionSha) {
    return `main и production совпадают: ${snapshot.mainSha}. Проверено ${snapshot.takenAt}.`;
  }
  return `В main ${snapshot.mainSha ?? "неизвестен"}. На сайте ${snapshot.productionSha ?? "другой commit"}. Совпадение ветки не означает публикацию. Проверено ${snapshot.takenAt}.`;
}

function formatNotInMain(snapshot: ProjectSnapshot): string {
  if (connection(snapshot, "github")?.status !== "connected") return "GitHub не подключён. Я не знаю, что ещё не попало в main.";
  const rows = snapshot.tasks.filter((task) => task.delivery !== "merged" && task.delivery !== "production_deployed" && task.branch);
  if (rows.length === 0) return "По связанным задачам отдельных веток вне main не видно.";
  return rows.map((task) => `${task.title}: ветка ${task.branch}, этап ${task.delivery}.`).join("\n");
}

function formatMigrations(snapshot: ProjectSnapshot): string {
  const db = connection(snapshot, "supabase");
  if (db?.status !== "connected") {
    return "История миграций Supabase не подключена. Я не буду говорить, что база совпадает с репозиторием.";
  }
  const pending = snapshot.issues.filter((issue) => issue.key.startsWith("migration-pending:"));
  const unknown = snapshot.issues.filter((issue) => issue.key.startsWith("migration-unknown:"));
  if (pending.length === 0 && unknown.length === 0) {
    return "По именам миграций расхождений не найдено. Это не проверка всей схемы. Repair history имён не заменяет сравнение таблиц.";
  }
  return [...pending, ...unknown].map((issue) => issue.evidence).join("\n");
}

function formatIssues(snapshot: ProjectSnapshot): string {
  if (snapshot.issues.length === 0) return "Открытых предупреждений по доступным источникам нет. Неподключённые источники в это число не входят.";
  return snapshot.issues.map((issue) => `${issue.severity}: ${issue.evidence} Дальше: ${issue.nextAction}`).join("\n");
}

function formatSync(snapshot: ProjectSnapshot): string {
  return snapshot.connections
    .filter((item) => item.provider === "github" || item.provider === "vercel")
    .map((item) => `${CONNECTION_LABEL[item.provider]}: ${item.lastSuccessfulSync ?? "успешной проверки не было"} (${statusRu(item.status)}).`)
    .join("\n");
}

function formatBlockers(snapshot: ProjectSnapshot): string {
  const blocking = snapshot.issues.filter((issue) => issue.severity === "blocking" || issue.severity === "warning");
  if (blocking.length === 0) return "Среди доступных данных нет блокера. Невидимая локальная работа сюда не входит.";
  return blocking.map((issue) => `${issue.component}: ${issue.nextAction}`).join("\n");
}

export function deliverySentence(task: TaskProgress): string {
  if (task.delivery === "merged" && task.productionMatches === false && task.checks === "success") {
    return `${task.title} прошёл проверку и объединён с main, но ещё не опубликован в production.`;
  }
  if (task.delivery === "merged" && task.productionMatches === false) {
    return `${task.title} объединён с main, но ещё не опубликован в production.`;
  }
  if (task.delivery === "production_deployed") {
    return `${task.title} опубликован в production. Commit совпадает с сайтом.`;
  }
  if (task.delivery === "preview_ready") {
    return `${task.title} готов на Preview и ещё не опубликован в production.`;
  }
  if (task.previewStatus === "ERROR") {
    return `${task.title}: сборка Preview не прошла. Это не готовая функция.`;
  }
  if (task.delivery === "pushed" || task.delivery === "pr_open" || task.delivery === "checks_passed") {
    return `${task.title} есть на GitHub. Наличие ветки или push не означает, что изменение выложено на сайт.`;
  }
  if (task.delivery === "local_work" || task.delivery === "committed") {
    return `${task.title} пока только на компьютере автора.`;
  }
  return `${task.title}: этап доставки ${task.delivery}. Статус задачи ${task.taskStatus}.`;
}

function localSentence(task: TaskProgress): string {
  if (task.local === "unknown") return "Локальное состояние неизвестно.";
  if (task.local === "stale") return "Локальный статус устарел.";
  if (task.local === "dirty") return "Есть незакоммиченные локальные изменения.";
  return "Последний локальный отчёт: рабочее дерево чистое.";
}

function connection(snapshot: ProjectSnapshot, provider: ConnectionRecord["provider"]): ConnectionRecord | undefined {
  return snapshot.connections.find((item) => item.provider === provider);
}

function statusRu(status: ConnectionRecord["status"]): string {
  if (status === "connected") return "подключено";
  if (status === "not_configured") return "не подключено";
  if (status === "authorization_failed") return "доступ отклонён";
  if (status === "temporarily_unavailable") return "временно недоступно";
  if (status === "syncing") return "идёт проверка";
  if (status === "stale") return "данные устарели";
  return "не реализовано";
}
