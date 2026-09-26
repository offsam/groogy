/**
 * Collaborative assistant routing, brief counts, and pinned status.
 * No paid API calls.
 */
import assert from "node:assert/strict";
import { buildTeamAgentContext } from "./context";
import { ingestTeamMessage, resolveMemberFromExternalIdentity } from "./ingest";
import { parseLocalCommand } from "./local-commands";
import { buildTeamAgentModelInput } from "./openai-provider";
import { formatProjectBrief, taskBucket } from "./project-brief";
import { refreshPinnedProjectStatus, type PinTransport } from "./project-status";
import { TEAM_AGENT_SYSTEM_PROMPT_V1 } from "./prompts/team-agent-system-v1";
import { seedMembersFromTemplate } from "./members";
import { InMemoryTeamAgentStore } from "./store";
import { approveTask, completeTask, proposeTask, startTask } from "./tasks";
import { archiveTopic, createTopic } from "./topics";
import { resolveInvocationTopics } from "./topic-classifier";
import { handleTelegramUpdate } from "./telegram/handle-update";
import { normalizeTelegramUpdate } from "./telegram/normalize";
import type { TeamAgentProvider } from "./agent-provider";
import type { AgentRespondResult, TeamAgentContext } from "./types";
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

function update(text: string, fromId: number, messageId: number, extra?: Partial<TelegramUpdate["message"]>): TelegramUpdate {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: 1_700_000_000 + messageId,
      text,
      from: { id: fromId, username: "CEBEP51pyc", first_name: "Sam", is_bot: false },
      chat: { id: Number(CHAT), type: "supergroup", title: "Kroogy" },
      entities: text.includes("@kroogy_bot")
        ? [{ type: "mention", offset: text.indexOf("@kroogy_bot"), length: "@kroogy_bot".length }]
        : text.startsWith("/agent")
          ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }]
          : [],
      ...extra,
    },
  };
}

class CaptureProvider implements TeamAgentProvider {
  calls = 0;
  seen = "";
  reply = "Контекст принят. Уточни, если нужно.";
  async respond(context: TeamAgentContext, request: { userText: string }): Promise<AgentRespondResult> {
    this.calls += 1;
    this.seen = `${request.userText}\n${context.recentMessages.map((message) => message.body).join("\n")}`;
    return { replyText: this.reply, proposedActions: [], needsHumanApproval: false };
  }
}

function teamStore() {
  const store = new InMemoryTeamAgentStore();
  const [sam, nikitos, zheka] = seedMembersFromTemplate(store, undefined, {
    sam: { display_name: "Сэм", telegram_user_id: 728807017, telegram_username: "CEBEP51pyc" },
    member_2: { display_name: "Никитос", telegram_user_id: 1957896162, telegram_username: "hard_n1k" },
    member_3: { display_name: "Жека", telegram_user_id: 321922402, telegram_username: "Evg_N_N" },
  });
  return { store, sam: sam!, nikitos: nikitos!, zheka: zheka! };
}

function telegramOk() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    if (url.includes("/sendMessage")) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 90 } }), { status: 200 });
    }
    if (url.includes("FAILSEND")) {
      return new Response(JSON.stringify({ ok: false, description: "send failed" }), { status: 400 });
    }
    if (!body.includes("brief")) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 91, status: "administrator", can_pin_messages: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 90 } }), { status: 200 });
  };
}

async function main(): Promise<void> {
  const original = globalThis.fetch;
  telegramOk();
  try {
    const { store, sam, nikitos } = teamStore();
    const provider = new CaptureProvider();

    const passive = await handleTelegramUpdate({
      update: update("Сегодня занимаюсь карточкой клиента", 728807017, 1),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(passive.shouldRespond, false);
    assert.equal(provider.calls, 0);
    assert.equal([...store.messages.values()].some((message) => message.body.includes("карточкой клиента")), true);

    const screen = await proposeTask(store, { title: "Главный экран", assigned_member_id: sam.id });
    await approveTask(store, screen.id);
    await startTask(store, screen.id);
    const before = (await store.getTask(screen.id))?.status;
    await handleTelegramUpdate({
      update: update("Я закончил главный экран", 728807017, 2),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal((await store.getTask(screen.id))?.status, before);
    assert.equal(provider.calls, 0);

    await ingestTeamMessage(store, {
      source: "telegram",
      conversationExternalId: CHAT,
      messageExternalId: "3",
      senderExternalId: "728807017",
      senderUsername: "CEBEP51pyc",
      text: "Идея: вынести карточку клиента в отдельный жизненный цикл на главном экране.",
    });
    const idea = await handleTelegramUpdate({
      update: update("@kroogy_bot что думаешь по этой идее?", 728807017, 4),
      store,
      env: env(),
      provider,
      botUserId: 1,
    });
    assert.equal(idea.providerCalls, 1);
    assert.equal(provider.calls, 1);
    assert.match(provider.seen, /жизненный цикл/);

    const ambiguous = new CaptureProvider();
    ambiguous.reply = "Ты спрашиваешь про текущие задачи команды или про то, что уже выложено на Preview?";
    const asked = await handleTelegramUpdate({
      update: update("@kroogy_bot а с этим что делать?", 728807017, 5),
      store,
      env: env(),
      provider: ambiguous,
      botUserId: 1,
    });
    assert.equal(asked.providerCalls, 1);
    assert.match(ambiguous.seen, /жизненный цикл/);
    assert.equal(ambiguous.reply.includes("Не удалось определить"), false);
    assert.equal(parseLocalCommand("@kroogy_bot а с этим что делать?", "kroogy_bot"), null);

    const replyBot = new CaptureProvider();
    const replied = await handleTelegramUpdate({
      update: update("а это точно так?", 728807017, 6, {
        reply_to_message: { message_id: 4, from: { id: 1, is_bot: true, username: "kroogy_bot" } },
      }),
      store,
      env: env(),
      provider: replyBot,
      botUserId: 1,
    });
    assert.equal(replied.providerCalls, 1);

    for (const command of ["/agent status", "/agent help", "/agent brief", "/agent brief refresh"]) {
      const quiet = new CaptureProvider();
      const result = await handleTelegramUpdate({
        update: update(command, 1957896162, 10 + command.length),
        store,
        env: env(),
        provider: quiet,
        botUserId: 1,
      });
      assert.equal(quiet.calls, 0, command);
      assert.equal(result.providerCalls, 0, command);
    }
    const approveQuiet = new CaptureProvider();
    await handleTelegramUpdate({
      update: update("/agent approve 00000000-0000-0000-0000-000000000000", 321922402, 40),
      store,
      env: env(),
      provider: approveQuiet,
      botUserId: 1,
    });
    assert.equal(approveQuiet.calls, 0);

    const stranger = await resolveMemberFromExternalIdentity(store, "999", "Evg_N_N");
    assert.equal(stranger.member, null);

    const done = await proposeTask(store, { title: "Онбординг" });
    await approveTask(store, done.id);
    await startTask(store, done.id);
    await completeTask(store, done.id);
    const loose = await proposeTask(store, { title: "Без исполнителя" });
    await approveTask(store, loose.id);
    const brief = formatProjectBrief({
      tasks: await store.listTasks(),
      members: await store.listActiveMembers(),
      connections: {
        telegram: true,
        supabase: true,
        openRouter: true,
        github: false,
        vercel: false,
        reporter: false,
      },
      now: new Date("2026-09-25T23:30:00Z"),
    });
    assert.match(brief, /Выполнено: 1/);
    assert.match(brief, /В работе: 1/);
    assert.match(brief, /Главный экран — в работе/);
    assert.match(brief, /• Без исполнителя — запланировано/);
    assert.equal(brief.includes("Сэм\n• Без исполнителя"), false);
    assert.equal(brief.includes("37"), false);
    assert.equal(taskBucket("completed"), "done");

    await store.upsertMemory({
      memory_type: "summary",
      category: null,
      subject: "Главный экран",
      content: "Главный экран ещё не начат",
      source_message_id: null,
      confidence: "low",
      status: "active",
      metadata: {},
    });
    const conv = [...store.conversations.values()][0]!;
    const ctx = await buildTeamAgentContext(store, {
      conversationId: conv.id,
      requestingMember: sam,
    });
    const packed = buildTeamAgentModelInput(ctx, {
      userText: "кто над чем работает?",
      triggerMessage: ctx.recentMessages[0] ?? {
        id: "t",
        conversation_id: conv.id,
        member_id: sam.id,
        external_message_id: null,
        reply_to_message_id: null,
        message_type: "text",
        body: "кто над чем работает?",
        metadata: {},
        occurred_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    }, 8000);
    assert.ok(packed.text.indexOf("# CONFIRMED TASK") > packed.text.indexOf("# MEMORY"));
    assert.match(packed.text, /Главный экран \[in_progress\]/);
    assert.match(packed.text, /ещё не начат/);
    assert.match(TEAM_AGENT_SYSTEM_PROMPT_V1, /не перебивают/);
    assert.equal(TEAM_AGENT_SYSTEM_PROMPT_V1.includes("руководитель проекта"), false);

    const junk = await createTopic(store, { title: "kroogy ответь одним словом", summary: "" });
    await archiveTopic(store, junk.id);
    const again = await resolveInvocationTopics(store, {
      id: "m",
      reply_to_message_id: null,
      body: "kroogy ответь одним словом пожалуйста сейчас",
    });
    assert.equal(again.createdTopicId, null);
    assert.equal((await store.listTopics()).filter((topic) => topic.slug === junk.slug && topic.status !== "archived").length, 0);

    const pinStore = new InMemoryTeamAgentStore();
    seedMembersFromTemplate(pinStore, undefined, {
      sam: { display_name: "Сэм", telegram_user_id: 728807017 },
    });
    const conversation = pinStore.findOrCreateConversation({
      source_type: "test",
      external_conversation_id: CHAT,
    });
    const calls: string[] = [];
    let missing = false;
    let unchanged = false;
    let sentIds = 500;
    const transport = (canPin: boolean): PinTransport => ({
      async send(text) {
        calls.push(`send:${text.slice(0, 12)}`);
        sentIds += 1;
        return { ok: true, messageId: sentIds };
      },
      async edit(messageId) {
        calls.push(`edit:${messageId}`);
        if (unchanged) return { ok: false, error: "Bad Request: message is not modified" };
        if (missing && messageId === 501) return { ok: false, error: "message to edit not found" };
        return { ok: true };
      },
      async pin(messageId) {
        calls.push(`pin:${messageId}`);
        return canPin ? { ok: true } : { ok: false, error: "not enough rights" };
      },
      async canPin() {
        return canPin;
      },
    });
    const first = await refreshPinnedProjectStatus({
      store: pinStore,
      conversationId: conversation.id,
      env: env(),
      now: new Date("2026-09-25T23:00:00Z"),
      transport: transport(true),
    });
    assert.equal(first.action, "created");
    assert.equal(first.pinned, true);
    calls.length = 0;
    const second = await refreshPinnedProjectStatus({
      store: pinStore,
      conversationId: conversation.id,
      env: env(),
      now: new Date("2026-09-25T23:10:00Z"),
      transport: transport(true),
    });
    assert.equal(second.action, "edited");
    assert.deepEqual(calls, ["edit:501"]);
    unchanged = true;
    calls.length = 0;
    const same = await refreshPinnedProjectStatus({
      store: pinStore,
      conversationId: conversation.id,
      env: env(),
      now: new Date("2026-09-25T23:10:00Z"),
      transport: transport(true),
    });
    assert.equal(same.action, "edited");
    assert.deepEqual(calls, ["edit:501"]);
    unchanged = false;
    missing = true;
    calls.length = 0;
    const recovered = await refreshPinnedProjectStatus({
      store: pinStore,
      conversationId: conversation.id,
      env: env(),
      transport: transport(true),
    });
    assert.equal(recovered.action, "created");
    assert.equal(calls.filter((call) => call.startsWith("send")).length, 1);
    assert.equal(calls.filter((call) => call.startsWith("pin")).length, 1);
    const saved = await pinStore.findMessageByExternal(conversation.id, "project-status");
    const placements = saved?.metadata.placements as { chat: { telegram_message_id: number } };
    assert.equal(placements.chat.telegram_message_id, 502);

    const denied = new InMemoryTeamAgentStore();
    const deniedChat = denied.findOrCreateConversation({ source_type: "test", external_conversation_id: "d" });
    const noPin: string[] = [];
    const deniedResult = await refreshPinnedProjectStatus({
      store: denied,
      conversationId: deniedChat.id,
      env: env(),
      transport: {
        async send() {
          noPin.push("send");
          return { ok: true, messageId: 7 };
        },
        async edit() {
          return { ok: true };
        },
        async pin() {
          noPin.push("pin");
          return { ok: false, error: "not enough rights" };
        },
        async canPin() {
          return false;
        },
      },
    });
    assert.equal(deniedResult.pinned, false);
    assert.match(deniedResult.note ?? "", /нет права pin/);
    assert.equal(noPin.includes("pin"), false);
    const still = formatProjectBrief({
      tasks: [],
      members: [],
      connections: { telegram: true, supabase: true, openRouter: false, github: false, vercel: false, reporter: false },
    });
    assert.match(still, /PROJECT BRIEF/);

    const beforeTasks = (await pinStore.listTasks()).length;
    const failed = await refreshPinnedProjectStatus({
      store: pinStore,
      conversationId: conversation.id,
      env: env(),
      transport: {
        async send() {
          return { ok: false, error: "send failed" };
        },
        async edit() {
          return { ok: false, error: "edit failed" };
        },
        async pin() {
          return { ok: true };
        },
        async canPin() {
          return true;
        },
      },
    });
    assert.equal(failed.action, "failed");
    assert.equal((await pinStore.listTasks()).length, beforeTasks);

    const threaded = normalizeTelegramUpdate(
      update("привет в теме", 728807017, 70, { message_thread_id: 42 }),
      { allowedChatId: CHAT, botUsername: "kroogy_bot", mentionTokens: ["@kroogy_bot"], botUserId: 1 },
    );
    assert.equal(threaded.ingest?.metadata.telegram_thread_id, 42);

    let threadSent: number | null = null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = JSON.parse(String(init?.body ?? "{}")) as { message_thread_id?: number };
      if (url.includes("/sendMessage")) threadSent = payload.message_thread_id ?? null;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 80, status: "creator" } }), { status: 200 });
    };
    const threadedStore = teamStore().store;
    await handleTelegramUpdate({
      update: update("@kroogy_bot что думаешь по этой идее?", 728807017, 71, { message_thread_id: 42 }),
      store: threadedStore,
      env: env(),
      provider: new CaptureProvider(),
      botUserId: 1,
    });
    assert.equal(threadSent, 42);
    assert.equal(nikitos.telegram_user_id, 1957896162);

    console.log("team-agent collaborative: ok");
  } finally {
    globalThis.fetch = original;
  }
}

void main();
