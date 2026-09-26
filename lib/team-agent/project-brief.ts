/**
 * Project facts for the model, plus the deterministic team brief.
 * Counts come only from stored tasks.
 */

export const KROOGY_PROJECT_BRIEF = [
  "КРУГИ (Kroogy) — сообщество и каталог для русскоязычных людей: местный справочник и объявления, не глобальный маркетплейс.",
  "Уже существующие публичные направления: бизнесы, специалисты, объявления, работа, недвижимость, события, «лечу», трансферы, купоны.",
  "Карточка проходит разбор и человеческую проверку перед публикацией. Импорт не означает владение.",
  "Игры — отдельное направление. Не описывать раздел игр как готовый, пока контекст этого не подтверждает.",
  "Roadmap, идеи и planned не равны реализованному функционалу. Если данных нет — так и сказать.",
].join(" ");

import type { TeamAgentMember, TeamAgentMessage, TeamAgentTask, TeamAgentTaskStatus } from "./types";

export const PROJECT_STATUS_EXTERNAL_ID = "project-status";

export const PARTNER_TELEGRAM_IDS = [
  { telegramUserId: 728807017, fallbackName: "Сэм" },
  { telegramUserId: 1957896162, fallbackName: "Никитос" },
  { telegramUserId: 321922402, fallbackName: "Жека" },
] as const;

export type BriefConnections = {
  telegram: boolean;
  supabase: boolean;
  openRouter: boolean;
  github: boolean;
  vercel: boolean;
  reporter: boolean;
};

const STATUS_LABEL: Record<TeamAgentTaskStatus, string> = {
  proposed: "предложение, не утверждено",
  approved: "запланировано",
  in_progress: "в работе",
  review: "в работе",
  blocked: "заблокировано",
  completed: "выполнено",
  cancelled: "отменено",
};

export function taskBucket(status: TeamAgentTaskStatus): "done" | "active" | "planned" | "blocked" | "proposed" | "ignore" {
  if (status === "completed") return "done";
  if (status === "in_progress" || status === "review") return "active";
  if (status === "approved") return "planned";
  if (status === "blocked") return "blocked";
  if (status === "proposed") return "proposed";
  return "ignore";
}

export function connectionFacts(env: NodeJS.ProcessEnv): BriefConnections {
  return {
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_ALLOWED_CHAT_ID?.trim()),
    supabase: Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
    github: Boolean(env.GITHUB_TEAM_AGENT_TOKEN?.trim() && env.GITHUB_TEAM_AGENT_REPO?.trim()),
    vercel: Boolean(
      env.VERCEL_TEAM_AGENT_TOKEN?.trim() &&
        (env.VERCEL_PROJECT_ID?.trim() || env.VERCEL_TEAM_AGENT_PROJECT_ID?.trim()),
    ),
    reporter: Boolean(env.TEAM_AGENT_REPORTER_TOKEN?.trim()),
  };
}

function countLine(mark: string, label: string, count: number): string {
  return `${mark} ${label}: ${count}`;
}

function memberByTelegram(members: TeamAgentMember[], telegramUserId: number): TeamAgentMember | null {
  return members.find((member) => member.telegram_user_id === telegramUserId) ?? null;
}

function tasksFor(tasks: TeamAgentTask[], memberId: string | null): TeamAgentTask[] {
  return tasks.filter(
    (task) =>
      task.assigned_member_id === memberId &&
      task.status !== "cancelled" &&
      task.status !== "proposed",
  );
}

export function formatProjectBrief(input: {
  tasks: TeamAgentTask[];
  members: TeamAgentMember[];
  recentMessages?: TeamAgentMessage[];
  connections: BriefConnections;
  now?: Date;
}): string {
  const open = input.tasks.filter((task) => task.status !== "cancelled");
  const done = open.filter((task) => taskBucket(task.status) === "done");
  const active = open.filter((task) => taskBucket(task.status) === "active");
  const planned = open.filter((task) => taskBucket(task.status) === "planned");
  const blocked = open.filter((task) => taskBucket(task.status) === "blocked");
  const proposed = open.filter((task) => taskBucket(task.status) === "proposed");
  const lines = [
    "KROOGY — PROJECT BRIEF",
    "",
    "Задачи",
    countLine("✓", "Выполнено", done.length),
    countLine("▶", "В работе", active.length),
    countLine("○", "Запланировано", planned.length),
    countLine("!", "Заблокировано", blocked.length),
    `Предложено: ${proposed.length}`,
    "",
    "Команда",
  ];

  for (const partner of PARTNER_TELEGRAM_IDS) {
    const member = memberByTelegram(input.members, partner.telegramUserId);
    const name = member?.display_name ?? partner.fallbackName;
    lines.push("", name);
    if (!member) {
      lines.push("• нет записи с этим Telegram ID");
      continue;
    }
    const own = tasksFor(open, member.id);
    if (own.length === 0) lines.push("• нет подтверждённых задач");
    for (const task of own) {
      lines.push(`• ${task.title} — ${STATUS_LABEL[task.status]}`);
    }
  }

  const unassigned = tasksFor(open, null);
  lines.push("", "Не назначено");
  if (unassigned.length === 0) lines.push("• нет");
  for (const task of unassigned) {
    lines.push(`• ${task.title} — ${STATUS_LABEL[task.status]}`);
  }

  if (proposed.length) {
    lines.push("", "Требует внимания");
    for (const task of proposed.slice(0, 8)) lines.push(`• ${task.title} — предложение, не утверждено`);
  }

  lines.push(
    "",
    "Подключения",
    `Telegram: ${input.connections.telegram ? "connected" : "not configured"}`,
    `Supabase Team Agent: ${input.connections.supabase ? "connected" : "not configured"}`,
    `OpenRouter: ${input.connections.openRouter ? "connected" : "not configured"}`,
    `GitHub: ${input.connections.github ? "connected" : "not configured"}`,
    `Vercel API: ${input.connections.vercel ? "connected" : "not configured"}`,
    `Local Reporter: ${input.connections.reporter ? "connected" : "not configured"}`,
    "",
    `Последнее обновление: ${formatStamp(input.now ?? new Date())}`,
  );
  return lines.join("\n");
}

export function formatPinnedProjectStatus(input: {
  tasks: TeamAgentTask[];
  members: TeamAgentMember[];
  connections: BriefConnections;
  now?: Date;
}): string {
  const open = input.tasks.filter((task) => task.status !== "cancelled");
  const done = open.filter((task) => taskBucket(task.status) === "done").length;
  const active = open.filter((task) => taskBucket(task.status) === "active").length;
  const planned = open.filter((task) => taskBucket(task.status) === "planned").length;
  const blocked = open.filter((task) => taskBucket(task.status) === "blocked").length;
  const lines = [
    "KROOGY — СТАТУС ПРОЕКТА",
    "",
    done ? `✓ Выполнено: ${done}` : "✓ Выполнено: нет подтверждённых задач в этом статусе.",
    active ? `▶ В работе: ${active}` : "▶ В работе: нет подтверждённых задач в этом статусе.",
    planned ? `○ Запланировано: ${planned}` : "○ Запланировано: нет подтверждённых задач в этом статусе.",
    blocked ? `! Заблокировано: ${blocked}` : "! Заблокировано: нет подтверждённых задач в этом статусе.",
    "",
  ];
  for (const partner of PARTNER_TELEGRAM_IDS) {
    const member = memberByTelegram(input.members, partner.telegramUserId);
    const name = member?.display_name ?? partner.fallbackName;
    const count = member
      ? tasksFor(open, member.id).filter((task) => {
          const bucket = taskBucket(task.status);
          return bucket === "active" || bucket === "planned" || bucket === "blocked";
        }).length
      : 0;
    lines.push(count ? `${name} — ${count} активные` : `${name} — нет подтверждённых активных задач`);
  }
  lines.push(
    "",
    `GitHub: ${input.connections.github ? "connected" : "not configured"}`,
    `Preview tracking: ${input.connections.vercel ? "connected" : "not configured"}`,
    "",
    `Обновлено: ${formatStamp(input.now ?? new Date())}`,
  );
  return lines.join("\n");
}

function formatStamp(now: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "America/Los_Angeles",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}
