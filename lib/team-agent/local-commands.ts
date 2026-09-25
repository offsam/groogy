/**
 * Deterministic Telegram commands. These do not call the model.
 */

export type LocalCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "github_unavailable" }
  | { kind: "approve_invalid" }
  | { kind: "approve"; approvalId: string };

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

  if (isGithubQuestion(lower)) return { kind: "github_unavailable" };
  return null;
}

function isGithubQuestion(lower: string): boolean {
  return (
    lower.includes("активные ветки") ||
    lower.includes("какие pr") ||
    lower.includes("какие pull") ||
    lower.includes("не попали в main") ||
    lower.includes("пересечься по файлам")
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
