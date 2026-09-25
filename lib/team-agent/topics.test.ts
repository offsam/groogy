/**
 * Topic / memory packet tests. No LLM, no remote DB.
 * Run: npx tsx lib/team-agent/topics.test.ts
 */
import assert from "node:assert/strict";
import { buildTeamAgentContext } from "./context";
import { confirmDecision, proposeDecision } from "./decisions";
import { ingestTeamMessage } from "./ingest";
import { recordMemory } from "./memory";
import { InMemoryTeamAgentStore } from "./store";
import { proposeTask } from "./tasks";
import { handleTelegramUpdate } from "./telegram/handle-update";
import type { TeamAgentProvider } from "./agent-provider";
import type { AgentRespondResult } from "./types";
import {
  archiveTopic,
  createTopic,
  linkDecisionToTopic,
  linkMemoryToTopic,
  linkMessageToTopics,
  linkTaskToTopic,
  mergeTopics,
  renameTopic,
  setTopicSummary,
} from "./topics";

function envForTests(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TEAM_AGENT_ENABLED: "1",
    TELEGRAM_BOT_USERNAME: "kroogy_bot",
    TELEGRAM_ALLOWED_CHAT_ID: "-100555",
    TELEGRAM_BOT_TOKEN: "test-token-not-real",
    TEAM_AGENT_PROVIDER: "mock",
  };
}

async function ingest(store: InMemoryTeamAgentStore, text: string, id: string) {
  return ingestTeamMessage(store, {
    source: "test",
    conversationExternalId: "topics",
    messageExternalId: id,
    senderExternalId: "1001",
    senderUsername: "sam",
    text,
  });
}

async function run() {
  // 1. passive message stored, no topic classification
  {
    const store = new InMemoryTeamAgentStore();
    await createTopic(store, { title: "Payments" });
    const provider: TeamAgentProvider & { calls: number } = {
      calls: 0,
      async respond(): Promise<AgentRespondResult> {
        this.calls += 1;
        return { replyText: "no", proposedActions: [], needsHumanApproval: false };
      },
    };
    const result = await handleTelegramUpdate({
      update: {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "Payments потом обсудим",
          from: { id: 1001, is_bot: false, first_name: "Sam", username: "sam" },
          chat: { id: -100555, type: "group", title: "Kroogy" },
        },
      },
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(provider.calls, 0);
    assert.equal(result.stored, true);
    const msg = [...store.messages.values()].find((m) => m.body.includes("Payments"));
    assert.ok(msg);
    assert.deepEqual(await store.listTopicIdsForSubject({ messageId: msg.id }), []);
    assert.equal(store.messages.size, 1);
  }

  // 2–3. one topic and several topics
  {
    const store = new InMemoryTeamAgentStore();
    const a = await createTopic(store, { title: "User Profile" });
    const b = await createTopic(store, { title: "Games" });
    const one = await ingest(store, "про профиль", "m1");
    await linkMessageToTopics(store, one.message.id, [a.id]);
    assert.deepEqual(await store.listTopicIdsForSubject({ messageId: one.message.id }), [a.id]);

    const many = await ingest(store, "профиль и игры", "m2");
    await linkMessageToTopics(store, many.message.id, [a.id, b.id]);
    const ids = await store.listTopicIdsForSubject({ messageId: many.message.id });
    assert.equal(ids.length, 2);
    assert.ok(ids.includes(a.id) && ids.includes(b.id));
  }

  // 4–9. context retrieval
  {
    const store = new InMemoryTeamAgentStore();
    const git = await createTopic(store, {
      title: "Git/GitHub workflow",
      summary: "Ветки и ревью.",
    });
    await setTopicSummary(store, git.id, "Одна задача — одна ветка. Auto merge запрещён.");
    const games = await createTopic(store, { title: "Games", summary: "Игровой контур." });
    const archived = await createTopic(store, { title: "Old Payments", summary: "Устаревшее." });
    await archiveTopic(store, archived.id);

    const decision = await proposeDecision(store, { title: "Одна задача = одна feature branch" });
    await confirmDecision(store, decision.id);
    await linkDecisionToTopic(store, decision.id, git.id);
    const otherDecision = await proposeDecision(store, { title: "Игры отдельно" });
    await confirmDecision(store, otherDecision.id);
    await linkDecisionToTopic(store, otherDecision.id, games.id);

    const task = await proposeTask(store, { title: "Добавить GitHub webhook" });
    await linkTaskToTopic(store, task.id, git.id);
    const gameTask = await proposeTask(store, { title: "Сделать матч" });
    await linkTaskToTopic(store, gameTask.id, games.id);
    const oldTask = await proposeTask(store, { title: "Старый биллинг" });
    await linkTaskToTopic(store, oldTask.id, archived.id);

    const constraint = await recordMemory(store, {
      memory_type: "constraint",
      category: "constraint",
      subject: "no auto merge",
      content: "Не делать auto merge",
      metadata: { critical: true, scope: "global" },
    });
    await linkMemoryToTopic(store, constraint.id, games.id);

    const msg = await ingest(store, "как ведём ветки?", "git-1");
    await linkMessageToTopics(store, msg.message.id, [git.id]);
    const ctx = await buildTeamAgentContext(store, {
      conversationId: msg.conversation.id,
      triggerMessage: msg.message,
    });
    assert.equal(ctx.retrieval, "topic");
    assert.ok(ctx.topicSummaries.some((s) => s.includes("Одна задача")));
    assert.ok(ctx.activeTasks.some((t) => t.id === task.id));
    assert.ok(!ctx.activeTasks.some((t) => t.id === gameTask.id));
    assert.ok(!ctx.activeTasks.some((t) => t.id === oldTask.id));
    assert.ok(ctx.activeDecisions.some((d) => d.id === decision.id));
    assert.ok(!ctx.activeDecisions.some((d) => d.id === otherDecision.id));
    assert.ok(ctx.relevantMemory.some((m) => m.id === constraint.id));
    assert.ok(!ctx.topics.some((t) => t.id === archived.id));
    assert.ok(ctx.recentMessages.some((m) => m.id === msg.message.id));
  }

  // 10. rename keeps links
  {
    const store = new InMemoryTeamAgentStore();
    const topic = await createTopic(store, { title: "Telegram бот" });
    const msg = await ingest(store, "бот", "rename-1");
    await linkMessageToTopics(store, msg.message.id, [topic.id]);
    const renamed = await renameTopic(store, topic.id, "Telegram Team Agent");
    assert.equal(renamed.id, topic.id);
    assert.deepEqual(await store.listTopicIdsForSubject({ messageId: msg.message.id }), [topic.id]);
    assert.equal((await store.listTopics()).find((t) => t.id === topic.id)?.title, "Telegram Team Agent");
  }

  // 11–12. merge keeps links and raw messages; archive does not delete chat
  {
    const store = new InMemoryTeamAgentStore();
    const source = await createTopic(store, { title: "Kroogy bot" });
    const target = await createTopic(store, { title: "Telegram Team Agent" });
    const a = await ingest(store, "первое", "merge-1");
    const b = await ingest(store, "второе", "merge-2");
    await linkMessageToTopics(store, a.message.id, [source.id]);
    await linkMessageToTopics(store, b.message.id, [source.id]);
    const task = await proposeTask(store, { title: "Webhook" });
    await linkTaskToTopic(store, task.id, source.id);
    const decision = await proposeDecision(store, { title: "Слушать группу" });
    await confirmDecision(store, decision.id);
    await linkDecisionToTopic(store, decision.id, source.id);
    const before = store.messages.size;
    const merged = await mergeTopics(store, source.id, target.id);
    assert.equal(store.messages.size, before);
    assert.equal(merged.source.status, "archived");
    assert.deepEqual(await store.listTopicIdsForSubject({ messageId: a.message.id }), [target.id]);
    assert.deepEqual(await store.listTopicIdsForSubject({ taskId: task.id }), [target.id]);
    assert.deepEqual(await store.listTopicIdsForSubject({ decisionId: decision.id }), [target.id]);
    await archiveTopic(store, target.id);
    assert.equal(store.messages.size, before);
    assert.equal([...store.messages.values()].every((m) => m.body.length > 0), true);
  }

  console.log("team-agent topics: ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
