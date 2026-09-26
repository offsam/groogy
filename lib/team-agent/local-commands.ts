/**
 * Deterministic Telegram commands. These do not call the model.
 */

import type { ProjectTopic } from "./control/report";

export type LocalCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "github_unavailable" }
  | { kind: "approve_invalid" }
  | { kind: "approve"; approvalId: string }
  | { kind: "brief" }
  | { kind: "brief_refresh" }
  | { kind: "project"; topic: ProjectTopic };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseLocalCommand(
  text: string,
  botUsername: string | null,
): LocalCommand | null {
  let body = text.trim();
  if (botUsername) {
    const token = botUsername.replace(/^@/, "");
    body = body.replace(new RegExp(`@${escapeRegExp(token)}\\b`, "ig"), " ").trim();
  }
  const lower = body.replace(/\s+/g, " ").trim().toLowerCase();

  const approve = lower.match(/^\/agent(?:@\S+)?\s+approve\s+(\S+)$/);
  if (approve?.[1] && UUID.test(approve[1])) {
    return { kind: "approve", approvalId: approve[1] };
  }
  if (/^\/agent(?:@\S+)?\s+approve\b/.test(lower)) {
    return { kind: "approve_invalid" };
  }
  if (/^\/agent(?:@\S+)?\s+brief\s+refresh\b/.test(lower)) return { kind: "brief_refresh" };
  if (/^\/agent(?:@\S+)?\s+brief\b/.test(lower)) return { kind: "brief" };

  if (
    lower === "/agent help" ||
    lower === "/agent" ||
    lower.startsWith("/agent help") ||
    lower.includes("что ты умеешь") ||
    lower.includes("как тобой пользоваться")
  ) {
    return { kind: "help" };
  }

  if (
    lower === "/agent status" ||
    lower.startsWith("/agent status") ||
    lower.includes("статус агента") ||
    lower.includes("подключён ли ты к github") ||
    lower.includes("подключен ли ты к github")
  ) {
    return { kind: "status" };
  }

  const topic = projectTopic(lower);
  if (topic) return { kind: "project", topic };
  return null;
}

function projectTopic(lower: string): ProjectTopic | null {
  if (
    lower.includes("проверь все подключения") ||
    lower.includes("проверь подключения") ||
    lower.includes("какие подключения")
  ) {
    return "connections";
  }
  if (lower.includes("полный статус") || lower.includes("статус проекта")) return "full";
  if (lower.includes("что сейчас делает")) return "people";
  if (lower.includes("не запуш")) return "unpushed";
  if (lower.includes("активные ветки") || lower.includes("какие ветки")) return "branches";
  if (lower.includes("какие pr") || lower.includes("какие pull") || lower.includes("ждут проверки")) return "prs";
  if (lower.includes("для просмотра")) return "preview";
  if (
    lower.includes("опубликовано на сайте") ||
    lower.includes("выложено на сайт") ||
    lower.includes("что сейчас на сайте")
  ) {
    return "production";
  }
  if (lower.includes("ещё не выложено") || lower.includes("еще не выложено") || lower.includes("готово, но")) {
    return "ready_not_live";
  }
  if (lower.includes("есть в main")) return "main_not_prod";
  if (lower.includes("не попали в main") || lower.includes("не попало в main")) return "not_in_main";
  if (lower.includes("миграц")) return "migrations";
  if (lower.includes("проблемы в проекте") || lower.includes("где сейчас проблемы") || lower.includes("пересечься")) {
    return "issues";
  }
  if (lower.includes("последний раз проверял")) return "sync";
  if (lower.includes("что мешает закончить")) return "blockers";
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
