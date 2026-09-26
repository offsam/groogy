/**
 * Persistent task changes come from the user's words, not from model output.
 * One unambiguous task, or no write.
 */

import type { TeamAgentStore } from "./store-port";
import { approveTask, completeTask, proposeTask, startTask } from "./tasks";
import type { TeamAgentMember, TeamAgentMessage, TeamAgentTask } from "./types";

export type TaskIntent =
  | { kind: "create"; title: string; assigneeTelegramId: number | null; assignSelf: boolean }
  | { kind: "confirm"; hint: string }
  | { kind: "start"; hint: string }
  | { kind: "complete"; hint: string };

const PARTNERS = [
  { telegramUserId: 728807017, forms: ["сэм", "сем", "сэма", "сэму", "сэмом", "сэме"] },
  { telegramUserId: 1957896162, forms: ["никитос", "никитоса", "никитосу", "никитосом", "никитосе"] },
  { telegramUserId: 321922402, forms: ["жека", "жеки", "жеке", "жеку", "жекой"] },
] as const;

const STOP_WORDS = new Set([
  "подтверждаю",
  "задачу",
  "задача",
  "задачи",
  "поставь",
  "работе",
  "работа",
  "начал",
  "начала",
  "делать",
  "это",
  "эту",
]);

export function parseExplicitTaskIntent(text: string): TaskIntent | null {
  const addressed = /@\w+/.test(text);
  const body = text.replace(/@\w+/g, " ").replace(/\s+/g, " ").trim();
  const lower = body.toLowerCase().replace(/ё/g, "е");
  if (!body || /как\s+подтверд/.test(lower) || /какие\s+шаги/.test(lower)) return null;
  if (/надо\s+подумать|когда-нибудь|обсудим/.test(lower) && !/создай|запиши|заведи|оформи/.test(lower)) {
    return null;
  }

  const created = lower.match(
    /(?:создай|создайте|запиши|заведи|оформи)(?:\s+(сэму|никитосу|жеке|мне))?\s+задач[а-я]*/,
  );
  if (created?.[0]) {
    const title = titleAfter(body, created[0]);
    if (!title) return null;
    const named = created[1] && created[1] !== "мне" ? partnerId(created[1]) : null;
    return {
      kind: "create",
      title,
      assigneeTelegramId: named,
      assignSelf: created[1] === "мне",
    };
  }

  if (/^подтверж\w*/.test(lower) || /\bподтверждаю\b/.test(lower)) {
    return { kind: "confirm", hint: lower.replace(/подтверж\w*/, " ") };
  }
  if (
    (addressed && /(начал[аи]?\s+(делать|ее|её|это|карточк)|\bв работ[уе]\b)/.test(lower)) ||
    /(поставь|переведи).{0,48}в работ/.test(lower)
  ) {
    return { kind: "start", hint: lower };
  }
  if (addressed && /законч|заверш|сделал[аи]?\s+карточк|карточк[а-я]*\s+законч/.test(lower)) {
    return { kind: "complete", hint: lower };
  }
  return null;
}

export function quotePartnerSpeech(
  text: string,
  messages: TeamAgentMessage[],
  members: TeamAgentMember[],
): string | null {
  const lower = text.toLowerCase().replace(/ё/g, "е");
  if (!/что\s+(сказал|сказала|говорил|говорила)/.test(lower)) return null;
  const partner = PARTNERS.find((person) => person.forms.some((form) => lower.includes(form)));
  if (!partner) return null;
  const member = members.find((item) => item.telegram_user_id === partner.telegramUserId);
  const name = member?.display_name ?? "участника";
  if (!member) return `В списке участников нет записи для этого Telegram ID.`;
  const said = messages.filter(
    (message) =>
      message.member_id === member.id &&
      message.message_type !== "bot" &&
      message.message_type !== "system" &&
      !message.body.trim().startsWith("/agent"),
  );
  const last = said.slice(-3);
  if (last.length === 0) return `В свежих сообщениях ${name} ничего нет.`;
  return [`${name} написал:`, ...last.map((message) => `• ${message.body.replace(/\s+/g, " ").trim().slice(0, 180)}`)].join("\n");
}

export async function runTaskIntent(input: {
  store: TeamAgentStore;
  text: string;
  member: TeamAgentMember | null;
  tasks: TeamAgentTask[];
  members: TeamAgentMember[];
}): Promise<{ text: string; taskId: string | null } | null> {
  const intent = parseExplicitTaskIntent(input.text);
  if (!intent) return null;
  if (!input.member) return { text: "Это может сделать только участник команды.", taskId: null };

  if (intent.kind === "create") {
    const assignee = intent.assigneeTelegramId
      ? input.members.find((member) => member.telegram_user_id === intent.assigneeTelegramId) ?? null
      : intent.assignSelf
        ? input.member
        : null;
    if (intent.assigneeTelegramId && !assignee) {
      return { text: "Не вижу этого человека среди участников по Telegram ID.", taskId: null };
    }
    const task = await proposeTask(input.store, {
      title: intent.title,
      assigned_member_id: assignee?.id ?? null,
      created_by_member_id: input.member.id,
    });
    const who = assignee ? assignee.display_name : "без исполнителя";
    return {
      text: `Записал предложение «${task.title}». Исполнитель: ${who}. Это ещё не утверждённая работа. Если это она, ответь «подтверждаю».`,
      taskId: task.id,
    };
  }

  const pool =
    intent.kind === "confirm"
      ? input.tasks.filter((task) => task.status === "proposed")
      : intent.kind === "start"
        ? input.tasks.filter((task) => task.status === "approved" || task.status === "proposed")
        : input.tasks.filter((task) => ["in_progress", "review", "approved", "proposed"].includes(task.status));
  const found = pickTask(pool, intent.hint);
  if (found.kind === "none") {
    return {
      text:
        intent.kind === "confirm"
          ? "Нет предложения, которое можно подтвердить. Назови задачу или сначала попроси её записать."
          : "Не вижу ровно одной задачи, к которой это относится. Назови её название.",
      taskId: null,
    };
  }
  if (found.kind === "many") {
    return {
      text: `Подходит несколько задач:\n${found.tasks
        .slice(0, 5)
        .map((task) => `• ${task.title}`)
        .join("\n")}\nНапиши, какую именно.`,
      taskId: null,
    };
  }
  const task = found.task;

  if (intent.kind === "confirm") {
    const updated = await approveTask(input.store, task.id);
    return {
      text: `Подтвердил задачу «${updated.title}». Это запланированная работа, ещё не «в работе».`,
      taskId: updated.id,
    };
  }
  if (intent.kind === "start") {
    if (task.status !== "approved") {
      return {
        text: `«${task.title}» сейчас «${task.status}». В работу её можно перевести только после подтверждения.`,
        taskId: task.id,
      };
    }
    if (!task.assigned_member_id) {
      return { text: `«${task.title}» без исполнителя. Сначала назови, кто её делает.`, taskId: task.id };
    }
    if (task.assigned_member_id !== input.member.id) {
      return { text: `«${task.title}» назначена не тебе. Статус не меняю.`, taskId: task.id };
    }
    const updated = await startTask(input.store, task.id);
    return { text: `«${updated.title}» теперь в работе.`, taskId: updated.id };
  }
  if (task.status !== "in_progress" && task.status !== "review") {
    return {
      text: `«${task.title}» сейчас «${task.status}». Закончить можно только задачу в работе.`,
      taskId: task.id,
    };
  }
  if (task.assigned_member_id && task.assigned_member_id !== input.member.id) {
    return { text: `«${task.title}» назначена не тебе. В completed не переводу.`, taskId: task.id };
  }
  const updated = await completeTask(input.store, task.id);
  return { text: `«${updated.title}» отмечена выполненной.`, taskId: updated.id };
}

function titleAfter(body: string, matched: string): string | null {
  const at = body.toLowerCase().replace(/ё/g, "е").indexOf(matched);
  if (at < 0) return null;
  let title = body.slice(at + matched.length).replace(/^[\s:;,—-]+/, "").replace(/^про\s+/i, "").trim();
  title = title.replace(/[.!?]+$/, "").trim();
  if (title.length < 3) return null;
  return title.charAt(0).toUpperCase() + title.slice(1, 140);
}

function partnerId(form: string): number | null {
  const person = PARTNERS.find((item) => (item.forms as readonly string[]).includes(form));
  return person?.telegramUserId ?? null;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((word) => (word.length >= 4 || word === "жц") && !STOP_WORDS.has(word));
}

function pickTask(
  tasks: TeamAgentTask[],
  hint: string,
): { kind: "one"; task: TeamAgentTask } | { kind: "many"; tasks: TeamAgentTask[] } | { kind: "none" } {
  const words = tokens(hint);
  if (words.length === 0) {
    if (tasks.length === 1) return { kind: "one", task: tasks[0] };
    if (tasks.length === 0) return { kind: "none" };
    return { kind: "many", tasks };
  }
  const scored = tasks
    .map((task) => {
      const title = task.title.toLowerCase().replace(/ё/g, "е");
      const score = words.filter((word) => (word === "жц" ? title.includes("жизнен") : title.includes(word))).length;
      return { task, score };
    })
    .filter((row) => row.score > 0);
  const best = Math.max(0, ...scored.map((row) => row.score));
  const winners = scored.filter((row) => row.score === best).map((row) => row.task);
  if (winners.length === 1) return { kind: "one", task: winners[0] };
  if (winners.length > 1) return { kind: "many", tasks: winners };
  return { kind: "none" };
}
