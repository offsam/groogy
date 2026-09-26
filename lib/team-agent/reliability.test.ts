/**
 * Regression tests for live Team Agent failures. No paid API calls.
 */
import assert from "node:assert/strict";
import { storedAiBudgetDecision } from "./ai-budget";
import { buildTeamAgentContext } from "./context";
import { ingestTeamMessage, resolveMemberFromExternalIdentity } from "./ingest";
import {
  OpenAITeamAgentProvider,
  extractModelJson,
  publicFailureText,
  classifyBillingFailure,
  describeProviderFailure,
  TeamAgentModelError,
} from "./openai-provider";
import { InMemoryTeamAgentStore } from "./store";
import { seedMembersFromTemplate } from "./members";
import { handleTelegramUpdate } from "./telegram/handle-update";
import { resolveInvocationTopics, shouldCreateTopic } from "./topic-classifier";
import { createTopic } from "./topics";
import type { TeamAgentProvider } from "./agent-provider";
import type { AgentRespondResult, TeamAgentMessage } from "./types";
import type { TelegramUpdate } from "./telegram/types";

const CHAT = "-100555";

function env(): NodeJS.ProcessEnv {
  return {
    TEAM_AGENT_ENABLED: "1",
    TELEGRAM_BOT_USERNAME: "kroogy_bot",
    TELEGRAM_ALLOWED_CHAT_ID: CHAT,
    TELEGRAM_BOT_TOKEN: "test-token-not-real",
    TEAM_AGENT_PROVIDER: "mock",
  } as unknown as NodeJS.ProcessEnv;
}

function update(text: string, fromId: number, messageId: number, username: string): TelegramUpdate {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: 1_700_000_000 + messageId,
      text,
      from: { id: fromId, username, first_name: username, is_bot: false },
      chat: { id: Number(CHAT), type: "supergroup", title: "Kroogy" },
      entities: text.includes("@kroogy_bot")
        ? [{ type: "mention", offset: text.indexOf("@kroogy_bot"), length: "@kroogy_bot".length }]
        : [],
    },
  };
}

class CountingProvider implements TeamAgentProvider {
  calls = 0;
  reply = "черновик";
  actions: AgentRespondResult["proposedActions"] = [];
  async respond(): Promise<AgentRespondResult> {
    this.calls += 1;
    return { replyText: this.reply, proposedActions: this.actions, needsHumanApproval: false };
  }
}

function storeWithTeam() {
  const store = new InMemoryTeamAgentStore();
  const [sam, nikitos, zheka] = seedMembersFromTemplate(store, undefined, {
    sam: { display_name: "Сэм", telegram_user_id: 728807017, telegram_username: "CEBEP51pyc" },
    member_2: { display_name: "Никитос", telegram_user_id: 1957896162, telegram_username: "hard_n1k" },
    member_3: { display_name: "Жека", telegram_user_id: 321922402, telegram_username: "Evg_N_N" },
  });
  return { store, sam: sam!, nikitos: nikitos!, zheka: zheka! };
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.telegram.org") && url.includes("/sendMessage")) {
      const fail = url.includes("FAILSEND");
      if (fail) {
        return new Response(JSON.stringify({ ok: false, description: "send failed" }), { status: 400 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 50 } }), { status: 200 });
    }
    throw new Error("unexpected fetch");
  };

  try {
    const { store, sam, nikitos, zheka } = storeWithTeam();
    assert.equal((await resolveMemberFromExternalIdentity(store, "728807017", "newsam")).member?.id, sam.id);
    assert.equal((await resolveMemberFromExternalIdentity(store, "1957896162", "hard_n1k")).member?.display_name, "Никитос");
    assert.equal((await resolveMemberFromExternalIdentity(store, "321922402", "Evg_N_N")).member?.display_name, "Жека");
    const impostor = await resolveMemberFromExternalIdentity(store, "999", "Evg_N_N");
    assert.equal(impostor.member, null);
    assert.equal(impostor.unknownSender, true);
    assert.equal((await store.findMemberByTelegramUserId(728807017))?.telegram_username, "newsam");

    const provider = new CountingProvider();
    const passive = await handleTelegramUpdate({
      update: update("я Жека и ничего не прошу", 728807017, 1, "CEBEP51pyc"),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(passive.shouldRespond, false);
    assert.equal(provider.calls, 0);
    const savedPassive = [...store.messages.values()].find((message) => message.external_message_id === "1");
    assert.equal(savedPassive?.member_id, sam.id);

    await ingestTeamMessage(store, {
      source: "telegram",
      conversationExternalId: CHAT,
      messageExternalId: "2",
      senderExternalId: "728807017",
      senderUsername: "CEBEP51pyc",
      text: "Никитос сейчас работает над карточкой клиента и её жизненным циклом. Я занимаюсь исходящими для игр и главным экраном. Жека скоро включится в проект.",
    });
    await createTopic(store, { title: "kroogy ответь одним словом", summary: "" });
    const asked = await ingestTeamMessage(store, {
      source: "telegram",
      conversationExternalId: CHAT,
      messageExternalId: "3",
      senderExternalId: "728807017",
      senderUsername: "CEBEP51pyc",
      replyToExternalMessageId: "2",
      text: "@kroogy_bot кто над чем сейчас работает?",
      botUsername: "kroogy_bot",
    });
    const topics = await resolveInvocationTopics(store, asked.message);
    assert.equal(topics.createdTopicId, null);
    const ctx = await buildTeamAgentContext(store, {
      conversationId: asked.conversation.id,
      requestingMember: sam,
      triggerMessage: asked.message,
    });
    assert.ok(ctx.recentMessages.some((message) => message.body.includes("карточкой клиента")));
    assert.equal(ctx.requestingMember?.telegram_user_id, 728807017);
    assert.ok(ctx.recentMessages.some((message) => message.id === asked.message.reply_to_message_id));

    assert.equal(shouldCreateTopic("@kroogy_bot kroogy ответь одним словом"), false);
    assert.equal(shouldCreateTopic("привет"), false);
    assert.equal(shouldCreateTopic("/agent status"), false);

    const help = await handleTelegramUpdate({
      update: update("@kroogy_bot что ты умеешь", 1957896162, 4, "hard_n1k"),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(help.providerCalls, 0);
    const status = await handleTelegramUpdate({
      update: update("/agent status", 321922402, 5, "Evg_N_N"),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(status.providerCalls, 0);

    provider.actions = [{
      type: "create_task",
      payload: { title: "Карточка клиента", description: "Жизненный цикл карточки" },
    }];
    const proposed = await handleTelegramUpdate({
      update: update("@kroogy_bot запиши задачу про карточку клиента и её жизненный цикл", 728807017, 6, "CEBEP51pyc"),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(proposed.providerCalls, 1);
    const task = (await store.listTasks()).find((item) => item.title === "Карточка клиента");
    assert.equal(task?.status, "proposed");
    const approval = await store.insertApproval({
      approval_type: "task_assignment",
      status: "pending",
      payload: { taskId: task!.id, memberId: nikitos.id },
      proposed_by_member_id: sam.id,
      decided_by_member_id: null,
      source_message_id: null,
    });
    const stranger = await handleTelegramUpdate({
      update: update(`/agent approve ${approval.id}`, 999, 7, "stranger"),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(stranger.providerCalls, 0);
    assert.equal((await store.getApproval(approval.id))?.status, "pending");
    const approved = await handleTelegramUpdate({
      update: update(`/agent approve ${approval.id}`, 321922402, 8, "Evg_N_N"),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(approved.providerCalls, 0);
    const botRow = [...store.messages.values()].find((message) => message.body.includes("Предложение подтверждено"));
    assert.ok(botRow);
    const storedTask = await store.getTask(task!.id);
    assert.equal(storedTask?.status, "approved");
    assert.equal(storedTask?.assigned_member_id, nikitos.id);
    const again = await buildTeamAgentContext(store, {
      conversationId: asked.conversation.id,
      requestingMember: zheka,
      triggerMessage: asked.message,
    });
    assert.ok(again.activeTasks.some((item) => item.id === task!.id));

    assert.equal(classifyBillingFailure(402, "insufficient credits"), "billing_credits");
    assert.equal(publicFailureText("timeout").includes("вовремя"), true);
    assert.equal(publicFailureText("rate_limited").includes("частоту"), true);
    assert.equal(publicFailureText("malformed").includes("неверном виде"), true);
    const fenced = extractModelJson("вот\n```json\n{\"reply\":\"ок\"}\n```");
    assert.equal(JSON.parse(fenced).reply, "ок");

    const calls = { n: 0 };
    const model = new OpenAITeamAgentProvider({
      env: env(),
      caller: async () => {
        calls.n += 1;
        const error = Object.assign(new Error("too many"), { status: 429, name: "APIError" });
        throw error;
      },
    });
    await assert.rejects(() => model.respond(ctx, { triggerMessage: asked.message, userText: "x" }));
    assert.equal(calls.n, 2);

    const once = { n: 0 };
    const billing = new OpenAITeamAgentProvider({
      env: env(),
      caller: async () => {
        once.n += 1;
        throw Object.assign(new Error("insufficient credits"), { status: 402 });
      },
    });
    await assert.rejects(() => billing.respond(ctx, { triggerMessage: asked.message, userText: "x" }));
    assert.equal(once.n, 1);

    const parsed = new OpenAITeamAgentProvider({
      env: env(),
      caller: async () => ({
        id: "resp_1",
        output_text: "```json\n{\"reply\":\"нашёл переписку\",\"topicIds\":[],\"proposedActions\":[],\"memoryProposals\":[],\"topicSummaryUpdates\":[]}\n```",
      }),
    });
    const okReply = await parsed.respond(ctx, { triggerMessage: asked.message, userText: "x" });
    assert.equal(okReply.replyText, "нашёл переписку");

    const now = Date.now();
    const parent: TeamAgentMessage = {
      id: "human",
      conversation_id: "c",
      member_id: sam.id,
      external_message_id: "h",
      reply_to_message_id: null,
      message_type: "text",
      body: "вопрос",
      metadata: {},
      occurred_at: new Date(now).toISOString(),
      created_at: new Date(now).toISOString(),
    };
    const bots = Array.from({ length: 6 }, (_, index) => ({
      id: `b${index}`,
      conversation_id: "c",
      member_id: null,
      external_message_id: `agent:${index}`,
      reply_to_message_id: "human",
      message_type: "bot" as const,
      body: "ответ",
      metadata: { usage: { total_tokens: 1 } },
      occurred_at: new Date(now - index * 1000).toISOString(),
      created_at: new Date(now).toISOString(),
    }));
    const limited = storedAiBudgetDecision({ messages: [parent, ...bots], memberId: sam.id, now });
    assert.equal(limited.ok, false);
    const other = storedAiBudgetDecision({ messages: [parent, ...bots], memberId: nikitos.id, now });
    assert.equal(other.ok, true);

    const delivery = new InMemoryTeamAgentStore();
    seedMembersFromTemplate(delivery, undefined, {
      sam: { display_name: "Сэм", telegram_user_id: 728807017, telegram_username: "CEBEP51pyc" },
    });
    const sendProvider = new CountingProvider();
    sendProvider.reply = "готовый ответ";
    const badToken = { ...env(), TELEGRAM_BOT_TOKEN: "FAILSEND" };
    const first = await handleTelegramUpdate({
      update: update("@kroogy_bot повтори статус", 728807017, 20, "CEBEP51pyc"),
      store: delivery,
      env: badToken,
      provider: sendProvider,
      botUserId: 1,
    });
    assert.equal(first.providerCalls, 1);
    assert.equal(first.replySent, false);
    const kept = [...delivery.messages.values()].find((message) => message.body === "готовый ответ");
    assert.ok(kept);
    globalThis.fetch = originalFetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 });
    const second = await handleTelegramUpdate({
      update: update("@kroogy_bot повтори статус", 728807017, 20, "CEBEP51pyc"),
      store: delivery,
      env: env(),
      provider: sendProvider,
      botUserId: 1,
    });
    assert.equal(second.providerCalls, 0);
    assert.equal(sendProvider.calls, 1);
    assert.equal(second.replySent, true);

    const leaked = describeProviderFailure(
      new TypeError("connect failed sk-supersecret OPENROUTER_API_KEY=sk-abcdefghij bot12345:AAAbbb"),
      "before_http",
    );
    assert.equal(leaked.exception_name, "TypeError");
    assert.equal(leaked.stage, "before_http");
    assert.equal(leaked.exception_message?.includes("sk-"), false);
    assert.equal(leaked.exception_message?.includes("AAAbbb"), false);
    assert.equal(leaked.provider_request_id, null);

    const upstream = Object.assign(new Error("provider down"), {
      status: 503,
      request_id: "req-123456-abcdef",
      cause: new Error("socket hang up"),
    });
    const wrapped = new OpenAITeamAgentProvider({
      env: env(),
      caller: async () => {
        throw upstream;
      },
    });
    await assert.rejects(
      () => wrapped.respond(ctx, { triggerMessage: asked.message, userText: "x" }),
      (err: unknown) => {
        assert.ok(err instanceof TeamAgentModelError);
        assert.equal(err.code, "upstream");
        const log = describeProviderFailure(err, "before_http");
        assert.equal(log.stage, "http_response");
        assert.equal(log.http_status, 503);
        assert.equal(log.provider_request_id, "req-123456-abcdef");
        assert.equal(log.cause_name, "Error");
        assert.match(log.cause_message ?? "", /provider down/);
        return true;
      },
    );

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const boom = new CountingProvider();
      boom.reply = "не должен уйти";
      const failing = {
        ...boom,
        async respond() {
          throw Object.assign(new TypeError("fetch failed before body"), { cause: new Error("ECONNREFUSED") });
        },
      };
      const hidden = await handleTelegramUpdate({
        update: update("@kroogy_bot диагностика", 728807017, 30, "CEBEP51pyc"),
        store,
        env: env(),
        provider: failing,
        botUserId: 1,
      });
      assert.equal(hidden.providerCalls, 1);
      const row = logs.map((line) => {
        try {
          return JSON.parse(line) as { error_type?: string; exception_name?: string; stage?: string; cause_name?: string; exception_message?: string };
        } catch {
          return null;
        }
      }).find((item) => item?.error_type === "provider_error");
      assert.equal(row?.exception_name, "TypeError");
      assert.equal(row?.cause_name, "Error");
      assert.equal(row?.stage, "before_http");
      assert.match(row?.exception_message ?? "", /fetch failed/);
    } finally {
      console.error = originalError;
    }

    console.log("team-agent reliability: ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
