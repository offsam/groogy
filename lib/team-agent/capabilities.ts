/**
 * Live capability registry. Status comes from runtime facts, not from docs or mock data.
 */

export type CapabilityStatus =
  | "available"
  | "not_configured"
  | "temporarily_unavailable"
  | "not_implemented";

export type CapabilityCategory =
  | "communication"
  | "memory"
  | "tasks"
  | "repository"
  | "ai"
  | "restricted";

export type Capability = {
  id: string;
  category: CapabilityCategory;
  title: string;
  status: CapabilityStatus;
};

export type CapabilityFacts = {
  telegramConfigured: boolean;
  persistenceConfigured: boolean;
  topicMemory: boolean;
  github:
    | "available"
    | "not_configured"
    | "temporarily_unavailable";
  ai:
    | "available"
    | "not_configured"
    | "temporarily_unavailable";
  providerLabel: string | null;
  model: string | null;
};

const STATUS_RU: Record<CapabilityStatus, string> = {
  available: "работает",
  not_configured: "не подключено",
  temporarily_unavailable: "временно недоступно",
  not_implemented: "не выполняется",
};

export function buildCapabilityRegistry(facts: CapabilityFacts): Capability[] {
  const telegram: CapabilityStatus = facts.telegramConfigured
    ? "available"
    : "not_configured";
  const memory: CapabilityStatus = facts.topicMemory ? "available" : "not_configured";
  const tasks: CapabilityStatus = facts.persistenceConfigured
    ? "available"
    : "not_configured";
  return [
    { id: "telegram_receive", category: "communication", title: "получать сообщения Telegram", status: telegram },
    { id: "telegram_store", category: "communication", title: "сохранять переписку", status: facts.persistenceConfigured ? "available" : "not_configured" },
    { id: "telegram_reply", category: "communication", title: "отвечать по явному обращению", status: telegram },
    { id: "conversation_context", category: "communication", title: "брать контекст разговора", status: facts.persistenceConfigured ? "available" : "not_configured" },
    { id: "topic_memory", category: "memory", title: "тематическая память и краткие итоги", status: memory },
    { id: "topic_search", category: "memory", title: "находить прошлые обсуждения", status: memory },
    { id: "confirmed_decisions", category: "memory", title: "помнить подтверждённые решения", status: facts.persistenceConfigured ? "available" : "not_configured" },
    { id: "active_tasks", category: "memory", title: "видеть активные задачи", status: tasks },
    { id: "constraints", category: "memory", title: "учитывать общие ограничения", status: facts.persistenceConfigured ? "available" : "not_configured" },
    { id: "propose_task", category: "tasks", title: "предлагать задачу из разговора", status: tasks },
    { id: "propose_assignment", category: "tasks", title: "предлагать распределение работы", status: tasks },
    { id: "conflicts", category: "tasks", title: "проверять пересечения по файлам", status: "available" },
    { id: "branch_name", category: "tasks", title: "предлагать имя ветки GitHub", status: "available" },
    { id: "approvals", category: "tasks", title: "ждать подтверждения человека", status: tasks },
    { id: "github_link", category: "repository", title: "GitHub", status: facts.github },
    { id: "github_branches", category: "repository", title: "смотреть ветки", status: facts.github },
    { id: "github_commits", category: "repository", title: "смотреть коммиты", status: facts.github },
    { id: "github_prs", category: "repository", title: "смотреть открытые PR и файлы", status: facts.github },
    { id: "github_checks", category: "repository", title: "смотреть статусы проверок", status: facts.github },
    { id: "ai", category: "ai", title: "отвечать через AI", status: facts.ai },
    { id: "merge", category: "restricted", title: "сливать ветки", status: "not_implemented" },
    { id: "deploy", category: "restricted", title: "деплоить и менять production", status: "not_implemented" },
    { id: "db_push", category: "restricted", title: "применять миграции базы", status: "not_implemented" },
    { id: "shell", category: "restricted", title: "выполнять команды shell", status: "not_implemented" },
  ];
}

export function formatCapabilitiesReply(facts: CapabilityFacts): string {
  const caps = buildCapabilityRegistry(facts);
  const can = caps.filter(
    (cap) => cap.status === "available" && cap.category !== "restricted" && cap.category !== "ai",
  );
  const github = caps.find((cap) => cap.id === "github_link");
  const lines = [
    "Я Kroogy Team Agent, помощник вашей команды.",
    "",
    "Могу:",
    ...can.slice(0, 8).map((cap) => `— ${cap.title}`),
    "",
    githubLine(github?.status ?? "not_configured", facts),
    aiLine(facts),
    "",
    "Не могу самостоятельно делать merge, deploy, менять production, применять миграции или выполнять shell.",
    "Задача и решение, которые я записываю из разговора, остаются предложением, пока человек их не подтвердит.",
    "",
    "Для работы напишите @kroogy_bot и свой запрос. Команды: /agent help, /agent status, /agent approve <id>.",
  ];
  return lines.join("\n");
}

function githubLine(status: CapabilityStatus, facts: CapabilityFacts): string {
  if (status === "available") return "GitHub: подключён, только чтение.";
  if (status === "temporarily_unavailable") {
    return "GitHub: временно недоступен. Ветки и PR я сейчас не вижу.";
  }
  void facts;
  return "GitHub: не подключён. Ветки, коммиты и PR я не выдумываю.";
}

function aiLine(facts: CapabilityFacts): string {
  if (facts.ai === "available" && facts.providerLabel && facts.model) {
    return `AI: ${facts.providerLabel}, модель ${facts.model}.`;
  }
  if (facts.ai === "temporarily_unavailable") return "AI: временно недоступен.";
  return "AI: не настроен.";
}

export function statusLabel(status: CapabilityStatus): string {
  return STATUS_RU[status];
}

export function formatStatusReply(input: {
  provider: string;
  model: string;
  ai: CapabilityFacts["ai"];
  telegram: boolean;
  persistence: boolean;
  activeTopics: number;
  github: CapabilityFacts["github"];
  activeTasks: number;
  confirmedDecisions: number;
  lastAiAt: string | null;
  lastError: string | null;
}): string {
  const ai =
    input.ai === "available"
      ? `${input.provider}, модель ${input.model}`
      : input.ai === "temporarily_unavailable"
        ? "временно недоступен"
        : "не настроен";
  const github =
    input.github === "available"
      ? "подключён (только чтение)"
      : input.github === "temporarily_unavailable"
        ? "временно недоступен"
        : "не подключён";
  return [
    `AI: ${ai}`,
    `Telegram: ${input.telegram ? "подключён" : "не настроен"}`,
    `База: ${input.persistence ? "запись работает" : "не настроена"}`,
    `Темы: ${input.activeTopics} активных`,
    `GitHub: ${github}`,
    `Активные задачи: ${input.activeTasks}`,
    `Подтверждённые решения: ${input.confirmedDecisions}`,
    `Последний успешный AI: ${input.lastAiAt ?? "ещё не было"}`,
    `Ошибки интеграций: ${input.lastError ?? "нет"}`,
  ].join("\n");
}
