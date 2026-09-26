/**
 * Task workflow, reply salvage, and a long chat simulation. No paid calls.
 */
import assert from "node:assert/strict";
import { storedAiBudgetDecision } from "./ai-budget";
import { handleTelegramUpdate } from "./telegram/handle-update";
import type { TelegramUpdate } from "./telegram/types";
import { seedMembersFromTemplate } from "./members";
import { summarizeAgentOutcomes } from "./outcomes";
import { parseExplicitTaskIntent } from "./task-intent";
import { TEAM_AGENT_SYSTEM_PROMPT_V1 } from "./prompts/team-agent-system-v1";
import { InMemoryTeamAgentStore } from "./store";
import type { AgentRespondResult } from "./types";
import type { TeamAgentProvider } from "./agent-provider";

const CHAT = "-100555";
const SAM = 728807017;
const NIK = 1957896162;
const ZHEKA = 321922402;

function env(): NodeJS.ProcessEnv {
  return {
    TEAM_AGENT_ENABLED: "1",
    TELEGRAM_BOT_USERNAME: "kroogy_bot",
    TELEGRAM_ALLOWED_CHAT_ID: CHAT,
    TELEGRAM_BOT_TOKEN: "test-token-not-real",
    TEAM_AGENT_PROVIDER: "mock",
  } as unknown as NodeJS.ProcessEnv;
}

function update(text: string, fromId: number, messageId: number): TelegramUpdate {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: 1_700_000_000 + messageId,
      text,
      from: { id: fromId, username: "partner", first_name: "P", is_bot: false },
      chat: { id: Number(CHAT), type: "supergroup", title: "Kroogy" },
      entities: text.includes("@kroogy_bot")
        ? [{ type: "mention", offset: text.indexOf("@"), length: 11 }]
        : text.startsWith("/agent")
          ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }]
          : [],
    },
  };
}

class CountingProvider implements TeamAgentProvider {
  calls = 0;
  async respond(): Promise<AgentRespondResult> {
    this.calls += 1;
    return {
      replyText: "По контексту это обсуждение, не задача.",
      proposedActions: [{ type: "create_task", payload: { title: "Мусор из модели" } }],
      needsHumanApproval: false,
    };
  }
}

function store() {
  const value = new InMemoryTeamAgentStore();
  seedMembersFromTemplate(value, undefined, {
    sam: { display_name: "Сэм", telegram_user_id: SAM, telegram_username: "CEBEP51pyc" },
    member_2: { display_name: "Никитос", telegram_user_id: NIK, telegram_username: "hard_n1k" },
    member_3: { display_name: "Жека", telegram_user_id: ZHEKA, telegram_username: "Evg_N_N" },
  });
  return value;
}

async function main() {
  assert.equal(parseExplicitTaskIntent("Надо подумать над карточкой клиента"), null);
  assert.equal(parseExplicitTaskIntent("Как подтвердить предложение? Какие шаги дальше?"), null);
  assert.equal(TEAM_AGENT_SYSTEM_PROMPT_V1.includes("Предложи задачи из текущего разговора"), false);
  assert.equal(TEAM_AGENT_SYSTEM_PROMPT_V1.includes("Telegram ID троих уже известны"), true);

  const memory = store();
  const provider = new CountingProvider();
  const idea = await handleTelegramUpdate({
    update: update("Надо подумать над карточкой клиента", SAM, 1),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(idea.providerCalls, 0);
  assert.equal((await memory.listTasks()).length, 0);

  const created = await handleTelegramUpdate({
    update: update("@kroogy_bot Создай Никитосу задачу сделать карточку клиента", SAM, 2),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(created.providerCalls, 0);
  assert.equal(provider.calls, 0);
  const task = (await memory.listTasks())[0];
  assert.equal(task?.status, "proposed");
  assert.match(task?.title ?? "", /карточку клиента/i);
  const nikitos = (await memory.listActiveMembers()).find((member) => member.telegram_user_id === NIK);
  assert.equal(task?.assigned_member_id, nikitos?.id);

  const confirmed = await handleTelegramUpdate({
    update: update("@kroogy_bot подтверждаю", NIK, 3),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(confirmed.providerCalls, 0);
  assert.equal((await memory.getTask(task!.id))?.status, "approved");

  const startedByOther = await handleTelegramUpdate({
    update: update("@kroogy_bot я начал её делать", SAM, 4),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(startedByOther.providerCalls, 0);
  assert.equal((await memory.getTask(task!.id))?.status, "approved");

  const started = await handleTelegramUpdate({
    update: update("@kroogy_bot начал делать карточку", NIK, 5),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(started.providerCalls, 0);
  assert.equal((await memory.getTask(task!.id))?.status, "in_progress");

  const tooEarly = await handleTelegramUpdate({
    update: update("@kroogy_bot карточку закончил", SAM, 6),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(tooEarly.providerCalls, 0);
  assert.equal((await memory.getTask(task!.id))?.status, "in_progress");

  const done = await handleTelegramUpdate({
    update: update("@kroogy_bot карточку закончил", NIK, 7),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(done.providerCalls, 0);
  assert.equal((await memory.getTask(task!.id))?.status, "completed");

  await handleTelegramUpdate({
    update: update("Жека: клиентская карточка ещё сырая", ZHEKA, 8),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  const said = await handleTelegramUpdate({
    update: update("@kroogy_bot что сказал Жека?", SAM, 9),
    store: memory,
    env: env(),
    provider,
    botUserId: 1,
  });
  assert.equal(said.providerCalls, 0);
  const conversationId = [...memory.conversations.values()][0]!.id;
  const messages = await memory.listRecentMessages(conversationId, 20);
  const bot = messages.find((message) => message.body.includes("Жека написал"));
  assert.ok(bot?.body.includes("клиентская карточка"));

  const chat = store();
  const chatter = new CountingProvider();
  const script = [
    [SAM, "сегодня просто болтаем"],
    [NIK, "ок"],
    [ZHEKA, "давай потом"],
    [SAM, "@kroogy_bot что думаешь?"],
    [NIK, "идея про бонусы"],
    [ZHEKA, "/agent status"],
    [SAM, "/agent brief"],
    [NIK, "@kroogy_bot а с этим что делать?"],
    [ZHEKA, "бля, ну и ну"],
    [SAM, "коротко"],
    [NIK, "@kroogy_bot есть ли у меня активные задачи?"],
    [ZHEKA, "я не уверен"],
    [SAM, "Надо подумать над экраном"],
    [NIK, "не сейчас"],
    [ZHEKA, "@kroogy_bot кто над чем?"],
    [SAM, "/agent help"],
    [NIK, "ладно"],
    [ZHEKA, "ок ок"],
    [SAM, "@kroogy_bot почему так"],
    [NIK, "reply без смысла"],
    [ZHEKA, "ещё одно"],
    [SAM, "/agent brief refresh"],
    [NIK, "@kroogy_bot статус команды"],
    [ZHEKA, "мат без вызова бота"],
    [SAM, "вопрос без знака"],
    [NIK, "да"],
    [ZHEKA, "@kroogy_bot и что дальше"],
    [SAM, "хм"],
    [NIK, "ясно"],
    [ZHEKA, "финиш болтовни"],
  ] as const;
  let providerCalls = 0;
  for (let index = 0; index < script.length; index += 1) {
    const [from, text] = script[index]!;
    const result = await handleTelegramUpdate({
      update: update(text, from, 100 + index),
      store: chat,
      env: env(),
      provider: chatter,
      botUserId: 1,
    });
    providerCalls += result.providerCalls ?? 0;
    if (!text.includes("@kroogy_bot")) assert.equal(result.providerCalls, 0, text);
    if (text.startsWith("/agent")) assert.equal(result.providerCalls, 0, text);
  }
  assert.equal((await chat.listTasks()).length, 0);
  assert.equal(chatter.calls, providerCalls);
  assert.equal(providerCalls, script.filter((row) => row[1].includes("@kroogy_bot")).length);

  const samId = "sam-id";
  const nikId = "nik-id";
  const now = Date.now();
  const budgetMessages = [samId, samId, samId, samId, samId, samId].map((memberId, index) => ({
    id: `b${index}`,
    member_id: null,
    reply_to_message_id: `p${index}`,
    message_type: "bot",
    occurred_at: new Date(now - 1000).toISOString(),
    metadata: { usage: { total_tokens: 1 } },
  }));
  const parents = budgetMessages.map((message, index) => ({
    id: `p${index}`,
    member_id: index < 6 ? samId : nikId,
    reply_to_message_id: null,
    message_type: "text",
    occurred_at: new Date(now - 2000).toISOString(),
    metadata: {},
  }));
  const blocked = storedAiBudgetDecision({ messages: [...parents, ...budgetMessages], memberId: samId, now });
  const open = storedAiBudgetDecision({ messages: [...parents, ...budgetMessages], memberId: nikId, now });
  assert.equal(blocked.ok, false);
  assert.equal(open.ok, true);

  const outcomes = summarizeAgentOutcomes([
    { message_type: "bot", metadata: { usage: { total_tokens: 1 } } },
    { message_type: "bot", metadata: { error_type: "malformed" } },
    { message_type: "bot", metadata: { error_type: "timeout" } },
    { message_type: "bot", metadata: { error_type: "provider_error" } },
    { message_type: "text", metadata: { error_type: "malformed" } },
  ]);
  assert.deepEqual(outcomes, {
    success: 1,
    malformed: 1,
    empty: 0,
    timeout: 1,
    providerError: 1,
    rateLimited: 0,
    other: 0,
  });

  console.log("team-agent workflow: ok");
}

main();
