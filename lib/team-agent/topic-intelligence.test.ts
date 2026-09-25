/**
 * Topic classification and retrieval. No remote DB, no LLM.
 * Run: npx tsx lib/team-agent/topic-intelligence.test.ts
 */
import assert from "node:assert/strict";
import { buildTeamAgentContext } from "./context";
import { confirmDecision, proposeDecision } from "./decisions";
import { ingestTeamMessage } from "./ingest";
import { recordMemory } from "./memory";
import { InMemoryTeamAgentStore } from "./store";
import { proposeTask, completeTask, approveTask, startTask } from "./tasks";
import { DeterministicTopicClassifier } from "./topic-classifier";
import { handleTelegramUpdate } from "./telegram/handle-update";
import type { TeamAgentProvider } from "./agent-provider";
import type { AgentRespondResult, TeamAgentTaskStatus } from "./types";
import {
  archiveTopic,
  createTopic,
  linkDecisionToTopic,
  linkMessageToTopics,
  linkTaskToTopic,
  mergeTopics,
  renameTopic,
  setTopicSummary,
} from "./topics";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.telegram.org")) {
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
      status: 200,
    });
  }
  return originalFetch(input, init);
}) as typeof fetch;

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TEAM_AGENT_ENABLED: "1",
    TELEGRAM_BOT_USERNAME: "kroogy_bot",
    TELEGRAM_ALLOWED_CHAT_ID: "-100555",
    TELEGRAM_BOT_TOKEN: "test-token-not-real",
    TEAM_AGENT_PROVIDER: "mock",
  };
}

function update(text: string, messageId: number, extra?: { replyTo?: number; entities?: boolean }) {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: 1,
      text,
      from: { id: 1001, is_bot: false, first_name: "Sam", username: "sam" },
      chat: { id: -100555, type: "supergroup" as const, title: "Kroogy" },
      entities: extra?.entities === false ? undefined : [{ type: "mention" as const, offset: 0, length: 11 }],
      reply_to_message: extra?.replyTo
        ? { message_id: extra.replyTo, from: { id: 777, is_bot: true, username: "kroogy_bot", first_name: "Bot" } }
        : undefined,
    },
  };
}

class Counting implements TeamAgentProvider {
  calls = 0;
  topicIds: string[] = [];
  async respond(): Promise<AgentRespondResult> {
    this.calls += 1;
    return {
      replyText: "mock reply",
      proposedActions: [],
      needsHumanApproval: false,
      topicIds: this.topicIds,
    };
  }
}

async function mention(
  store: InMemoryTeamAgentStore,
  text: string,
  id: number,
  provider = new Counting(),
  classifier = new DeterministicTopicClassifier(),
) {
  const result = await handleTelegramUpdate({
    update: update(text.startsWith("@") ? text : `@kroogy_bot ${text}`, id),
    store,
    provider,
    topicClassifier: classifier,
    botUserId: 777,
    env: env(),
  });
  return { result, provider, classifier };
}

async function run() {
  let passed = 0;
  const check = (name: string, fn: () => void | Promise<void>) => fn();

  // 1 passive
  {
    const store = new InMemoryTeamAgentStore();
    const provider = new Counting();
    const classifier = new DeterministicTopicClassifier();
    const result = await handleTelegramUpdate({
      update: update("Никита завтра доделай профиль", 1, { entities: false }),
      store,
      provider,
      topicClassifier: classifier,
      botUserId: 777,
      env: env(),
    });
    assert.equal(result.stored, true);
    assert.equal(classifier.calls, 0);
    assert.equal(provider.calls, 0);
    passed += 1;
  }

  // 2–6 existing topic, links, bot link, multi, max 3
  {
    const store = new InMemoryTeamAgentStore();
    const profile = await createTopic(store, { title: "User Profile", summary: "личный кабинет" });
    const telegram = await createTopic(store, { title: "Telegram Team Agent", summary: "бот команды" });
    const games = await createTopic(store, { title: "Games Catalog", summary: "игры" });
    const payments = await createTopic(store, { title: "Payments Ledger", summary: "оплаты" });
    const classifier = new DeterministicTopicClassifier();
    const provider = new Counting();
    await mention(store, "User Profile и Telegram Team Agent", 2, provider, classifier);
    assert.equal(provider.calls, 1);
    const human = [...store.messages.values()].find((m) => m.message_type !== "bot")!;
    const bot = [...store.messages.values()].find((m) => m.message_type === "bot")!;
    const linked = await store.listTopicIdsForSubject({ messageId: human.id });
    const botLinked = await store.listTopicIdsForSubject({ messageId: bot.id });
    assert.ok(linked.includes(profile.id));
    assert.ok(linked.includes(telegram.id));
    assert.deepEqual([...linked].sort(), [...botLinked].sort());
    const wide = new Counting();
    await mention(store, "User Profile и Telegram Team Agent и Games Catalog и Payments Ledger", 21, wide, classifier);
    const wideHuman = [...store.messages.values()].find((m) => m.external_message_id === "21")!;
    const wideIds = await store.listTopicIdsForSubject({ messageId: wideHuman.id });
    assert.equal(wideIds.length, 3);
    void games;
    void payments;
    passed += 5;
  }

  // 7–10 prefer existing, map telegram bot, no topic for тест, create genuine
  {
    const store = new InMemoryTeamAgentStore();
    const telegram = await createTopic(store, { title: "Telegram Team Agent" });
    const a = await mention(store, "нужен Telegram bot для команды", 3);
    const human = [...store.messages.values()].at(-2)!;
    const ids = await store.listTopicIdsForSubject({ messageId: human.id });
    assert.deepEqual(ids, [telegram.id]);
    assert.equal(a.provider.calls, 1);
    const topicsBefore = (await store.listTopics()).length;
    await mention(store, "тест", 4);
    assert.equal((await store.listTopics()).length, topicsBefore);
    await mention(store, "монетизация подписок для команды", 5);
    assert.equal((await store.listTopics()).length, topicsBefore + 1);
    passed += 4;
  }

  // 11 rename keeps links and slug
  {
    const store = new InMemoryTeamAgentStore();
    const topic = await createTopic(store, { title: "Telegram бот" });
    const slug = topic.slug;
    const msg = await ingestTeamMessage(store, {
      source: "test",
      conversationExternalId: "t",
      messageExternalId: "r1",
      senderExternalId: null,
      senderUsername: null,
      text: "бот",
    });
    await linkMessageToTopics(store, msg.message.id, [topic.id]);
    const renamed = await renameTopic(store, topic.id, "Telegram Team Agent");
    assert.equal(renamed.slug, slug);
    assert.deepEqual(await store.listTopicIdsForSubject({ messageId: msg.message.id }), [topic.id]);
    passed += 1;
  }

  // 12–18 merge
  {
    const store = new InMemoryTeamAgentStore();
    const source = await createTopic(store, { title: "Kroogy bot" });
    const target = await createTopic(store, { title: "Telegram Team Agent" });
    const a = await ingestTeamMessage(store, {
      source: "test", conversationExternalId: "m", messageExternalId: "a",
      senderExternalId: null, senderUsername: null, text: "one",
    });
    const b = await ingestTeamMessage(store, {
      source: "test", conversationExternalId: "m", messageExternalId: "b",
      senderExternalId: null, senderUsername: null, text: "two",
    });
    await linkMessageToTopics(store, a.message.id, [source.id, target.id]);
    await linkMessageToTopics(store, b.message.id, [source.id]);
    const task = await proposeTask(store, { title: "Webhook" });
    await linkTaskToTopic(store, task.id, source.id);
    const decision = await proposeDecision(store, { title: "Слушать группу" });
    await confirmDecision(store, decision.id);
    await linkDecisionToTopic(store, decision.id, source.id);
    const memory = await recordMemory(store, {
      memory_type: "project_fact",
      category: "fact",
      subject: "bot",
      content: "бот в группе",
    });
    await store.linkSubjectToTopic({ topicId: source.id, memoryId: memory.id });
    const before = store.messages.size;
    const merged = await mergeTopics(store, source.id, target.id);
    assert.deepEqual(await store.listTopicIdsForSubject({ messageId: b.message.id }), [target.id]);
    const both = await store.listTopicIdsForSubject({ messageId: a.message.id });
    assert.deepEqual(both, [target.id]);
    assert.deepEqual(await store.listTopicIdsForSubject({ taskId: task.id }), [target.id]);
    assert.deepEqual(await store.listTopicIdsForSubject({ decisionId: decision.id }), [target.id]);
    assert.deepEqual(await store.listTopicIdsForSubject({ memoryId: memory.id }), [target.id]);
    assert.equal(merged.source.status, "archived");
    assert.equal(store.messages.size, before);
    passed += 7;
  }

  // 19–27 retrieval
  {
    const store = new InMemoryTeamAgentStore();
    const git = await createTopic(store, { title: "Git Workflow", summary: "ветки" });
    await setTopicSummary(store, git.id, "Одна задача — одна ветка.");
    const games = await createTopic(store, { title: "Games", summary: "игры" });
    const old = await createTopic(store, { title: "Old Payments", summary: "архив" });
    await archiveTopic(store, old.id);
    const confirmed = await proposeDecision(store, { title: "Одна ветка" });
    await confirmDecision(store, confirmed.id);
    await linkDecisionToTopic(store, confirmed.id, git.id);
    const proposed = await proposeDecision(store, { title: "Может быть монорепо" });
    await linkDecisionToTopic(store, proposed.id, git.id);
    const active = await proposeTask(store, { title: "GitHub webhook" });
    await linkTaskToTopic(store, active.id, git.id);
    const done = await proposeTask(store, { title: "Старый скрипт" });
    await linkTaskToTopic(store, done.id, git.id);
    await approveTask(store, done.id);
    await startTask(store, done.id);
    await completeTask(store, done.id);
    const oldTask = await proposeTask(store, { title: "Старый биллинг" });
    await linkTaskToTopic(store, oldTask.id, old.id);
    const gameTask = await proposeTask(store, { title: "Матч" });
    await linkTaskToTopic(store, gameTask.id, games.id);
    const constraint = await recordMemory(store, {
      memory_type: "constraint",
      category: "constraint",
      subject: "no merge",
      content: "Не делать auto merge",
      metadata: { critical: true, scope: "global" },
    });
    await store.linkSubjectToTopic({ topicId: games.id, memoryId: constraint.id });
    const msg = await ingestTeamMessage(store, {
      source: "test", conversationExternalId: "c", messageExternalId: "git",
      senderExternalId: null, senderUsername: null, text: "как ведём Git Workflow?",
    });
    await linkMessageToTopics(store, msg.message.id, [git.id]);
    const ctx = await buildTeamAgentContext(store, {
      conversationId: msg.conversation.id,
      triggerMessage: msg.message,
    });
    assert.ok(ctx.topicSummaries.some((s) => s.includes("Одна задача")));
    assert.ok(ctx.activeDecisions.some((d) => d.id === confirmed.id));
    assert.ok(!ctx.activeDecisions.some((d) => d.id === proposed.id));
    assert.ok(ctx.activeTasks.some((t) => t.id === active.id));
    assert.ok(!ctx.activeTasks.some((t) => t.id === done.id));
    assert.ok(!ctx.activeTasks.some((t) => t.id === oldTask.id));
    assert.ok(!ctx.topics.some((t) => t.status === "archived"));
    assert.ok(ctx.relevantMemory.some((m) => m.id === constraint.id));
    assert.ok(!ctx.activeTasks.some((t) => t.id === gameTask.id));
    const explicit = await ingestTeamMessage(store, {
      source: "test", conversationExternalId: "c", messageExternalId: "old",
      senderExternalId: null, senderUsername: null, text: "что было в Old Payments?",
    });
    const archivedCtx = await buildTeamAgentContext(store, {
      conversationId: explicit.conversation.id,
      triggerMessage: explicit.message,
    });
    assert.ok(archivedCtx.topics.some((t) => t.id === old.id) || archivedCtx.activeTasks.some((t) => t.id === oldTask.id));
    passed += 9;
  }

  // 28–29 reply inheritance
  {
    const store = new InMemoryTeamAgentStore();
    const profile = await createTopic(store, { title: "User Profile" });
    const parent = await ingestTeamMessage(store, {
      source: "telegram", conversationExternalId: "-100555", messageExternalId: "50",
      senderExternalId: null, senderUsername: null, text: "кабинет",
    });
    await linkMessageToTopics(store, parent.message.id, [profile.id]);
    const classifier = new DeterministicTopicClassifier();
    await handleTelegramUpdate({
      update: update("а Никите что делать?", 60, { replyTo: 50, entities: false }),
      store,
      topicClassifier: classifier,
      botUserId: 777,
      env: env(),
    });
    const reply = [...store.messages.values()].find((m) => m.body.includes("Никите"))!;
    assert.ok((await store.listTopicIdsForSubject({ messageId: reply.id })).includes(profile.id));
    const bot = [...store.messages.values()].find((m) => m.message_type === "bot")!;
    assert.ok((await store.listTopicIdsForSubject({ messageId: bot.id })).includes(profile.id));
    passed += 2;
  }

  // 30 broad status uses summaries only
  {
    const store = new InMemoryTeamAgentStore();
    for (let i = 0; i < 6; i++) {
      const topic = await createTopic(store, { title: `Topic ${i} area`, summary: `summary ${i}` });
      const msg = await ingestTeamMessage(store, {
        source: "test", conversationExternalId: "broad", messageExternalId: `b${i}`,
        senderExternalId: null, senderUsername: null, text: `raw history ${i} `.repeat(5),
      });
      await linkMessageToTopics(store, msg.message.id, [topic.id]);
    }
    const ask = await ingestTeamMessage(store, {
      source: "test", conversationExternalId: "broad", messageExternalId: "ask",
      senderExternalId: null, senderUsername: null, text: "дай статус проекта",
    });
    const ctx = await buildTeamAgentContext(store, {
      conversationId: ask.conversation.id,
      triggerMessage: ask.message,
    });
    assert.equal(ctx.retrieval, "overview");
    assert.equal(ctx.recentMessages.length, 0);
    assert.ok(ctx.topicSummaries.length <= 5);
    assert.ok(ctx.topicSummaries.length >= 1);
    passed += 1;
  }

  // 31 invalid model topic id ignored
  {
    const store = new InMemoryTeamAgentStore();
    const topic = await createTopic(store, { title: "User Profile" });
    const provider = new Counting();
    provider.topicIds = ["00000000-0000-0000-0000-000000000000", topic.id];
    await mention(store, "User Profile статус", 70, provider);
    const human = [...store.messages.values()].find((m) => m.message_type !== "bot")!;
    const ids = await store.listTopicIdsForSubject({ messageId: human.id });
    assert.deepEqual(ids, [topic.id]);
    passed += 1;
  }

  // 32 dedupe slug
  {
    const store = new InMemoryTeamAgentStore();
    const first = await createTopic(store, { title: "User Profile" });
    const second = await createTopic(store, { title: "User Profile" });
    assert.notEqual(first.slug, second.slug);
    assert.ok(second.slug.startsWith(first.slug));
    passed += 1;
  }

  // 33–34 summary does not change authoritative rows
  {
    const store = new InMemoryTeamAgentStore();
    const topic = await createTopic(store, { title: "Git Workflow" });
    const decision = await proposeDecision(store, { title: "Maybe trunks" });
    const task = await proposeTask(store, { title: "Webhook" });
    const status: TeamAgentTaskStatus = task.status;
    await setTopicSummary(store, topic.id, "Confirmed: одна ветка. Task webhook active.");
    const decisions = await store.listDecisions();
    assert.equal(decisions.find((d) => d.id === decision.id)?.status, "proposed");
    assert.equal((await store.getTask(task.id))?.status, status);
    passed += 2;
  }

  // 35 one provider call
  {
    const store = new InMemoryTeamAgentStore();
    await createTopic(store, { title: "User Profile" });
    const provider = new Counting();
    const classifier = new DeterministicTopicClassifier();
    await mention(store, "User Profile что дальше", 80, provider, classifier);
    assert.equal(provider.calls, 1);
    assert.equal(classifier.calls, 1);
    passed += 1;
  }

  void check;
  console.log(`team-agent topic intelligence: ok (${passed})`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
