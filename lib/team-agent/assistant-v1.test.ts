/**
 * Working-assistant scenarios. No live network and no paid model calls.
 */
import assert from "node:assert/strict";
import { validateAgentAction } from "./actions";
import { buildCapabilityRegistry } from "./capabilities";
import { buildTeamAgentContext } from "./context";
import { detectPathConflicts } from "./conflicts";
import { GitHubRepositoryContextProvider, unavailableRepository } from "./github-repository";
import { parseLocalCommand } from "./local-commands";
import { classifyBillingFailure, publicFailureText } from "./openai-provider";
import { TEAM_AGENT_SYSTEM_PROMPT_V1 } from "./prompts/team-agent-system-v1";
import { seedMembersFromTemplate } from "./members";
import { InMemoryTeamAgentStore } from "./store";
import { proposeDecision } from "./decisions";
import { proposeTask } from "./tasks";
import { createTopic } from "./topics";
import type { AgentRespondResult } from "./types";
import type { TeamAgentProvider } from "./agent-provider";
import { handleTelegramUpdate } from "./telegram/handle-update";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    TEAM_AGENT_ENABLED: "true",
    TEAM_AGENT_PROVIDER: "mock",
    TELEGRAM_BOT_USERNAME: "kroogy_bot",
    TELEGRAM_ALLOWED_CHAT_ID: "-5339548898",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
  };
}

function store() {
  const memory = new InMemoryTeamAgentStore();
  seedMembersFromTemplate(memory, undefined, {
    sam: {
      display_name: "Сэм",
      telegram_user_id: 728807017,
      telegram_username: "CEBEP51pyc",
      role_title: "партнёр, участник разработки",
    },
    member_2: {
      display_name: "Никитос",
      telegram_user_id: 1957896162,
      telegram_username: "hard_n1k",
      role_title: "партнёр, участник разработки",
    },
    member_3: {
      display_name: "Жека",
      telegram_user_id: 321922402,
      telegram_username: "Evg_N_N",
      role_title: "партнёр, участник разработки",
    },
  });
  return memory;
}

class ScriptedProvider implements TeamAgentProvider {
  calls = 0;
  constructor(private readonly result: AgentRespondResult | Error) {}
  async respond(): Promise<AgentRespondResult> {
    this.calls += 1;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function update(text: string, messageId: number, fromId = 728807017, username = "CEBEP51pyc") {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: 1_700_000_000,
      chat: { id: -5339548898, type: "group" as const, title: "Kroogy" },
      from: { id: fromId, is_bot: false, first_name: "Сэм", username },
      text,
      entities: text.includes("@kroogy_bot")
        ? [{ type: "mention" as const, offset: 0, length: 11 }]
        : text.startsWith("/agent")
          ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0]!.length }]
          : undefined,
    },
  };
}

async function main() {
  let passed = 0;
  assert.ok(TEAM_AGENT_SYSTEM_PROMPT_V1.includes("партнёр, участник разработки"));
  assert.equal(TEAM_AGENT_SYSTEM_PROMPT_V1.includes("руководитель проекта"), false);
  passed += 1;

  const caps = buildCapabilityRegistry({
    telegramConfigured: true,
    persistenceConfigured: true,
    topicMemory: true,
    github: "not_configured",
    ai: "available",
    providerLabel: "openrouter",
    model: "deepseek/deepseek-v4-flash",
  });
  assert.equal(caps.find((cap) => cap.id === "github_link")?.status, "not_configured");
  assert.equal(caps.find((cap) => cap.id === "merge")?.status, "not_implemented");
  assert.equal(caps.some((cap) => cap.status === "available" && cap.id === "merge"), false);
  passed += 1;

  const help = await handleTelegramUpdate({
    update: update("@kroogy_bot что ты умеешь?", 1),
    store: store(),
    env: env(),
    botUserId: 1,
  });
  assert.equal(help.providerCalls, 0);
  assert.match(String(help.reason), /help/);
  passed += 1;

  const memory = store();
  const provider = new ScriptedProvider({
    replyText: "ок",
    proposedActions: [],
    needsHumanApproval: false,
    provider: "mock",
    usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
  });
  const passive = await handleTelegramUpdate({
    update: update("обычное сообщение", 2),
    store: memory,
    provider,
    env: env(),
    botUserId: 1,
  });
  assert.equal(passive.providerCalls, 0);
  assert.equal(provider.calls, 0);
  const active = await handleTelegramUpdate({
    update: update("@kroogy_bot привет", 3),
    store: memory,
    provider,
    env: env(),
    botUserId: 1,
  });
  assert.equal(active.providerCalls, 1);
  const saved = [...memory.messages.values()].find((row) => row.external_message_id === "agent:3");
  assert.equal(saved?.metadata.usage && (saved.metadata.usage as { total_tokens: number }).total_tokens, 4);
  passed += 2;

  const ctxStore = store();
  const topic = await createTopic(ctxStore, { title: "Личный кабинет", summary: "Профиль и настройки." });
  const convo = await ctxStore.findOrCreateConversation({
    source_type: "telegram",
    external_conversation_id: "-5339548898",
    title: "Kroogy",
  });
  const linked = await ctxStore.insertMessage({
    conversation_id: convo.id,
    member_id: null,
    external_message_id: "m-linked",
    reply_to_message_id: null,
    message_type: "text",
    body: "Обсудили настройки профиля.",
    occurred_at: "2026-09-25T10:00:00.000Z",
    metadata: {},
  });
  await ctxStore.linkSubjectToTopic({ topicId: topic.id, messageId: linked.id });
  const loose = await ctxStore.insertMessage({
    conversation_id: convo.id,
    member_id: null,
    external_message_id: "m-loose",
    reply_to_message_id: null,
    message_type: "text",
    body: "Никита, давай в личном кабинете сделаем профиль и настройки.",
    occurred_at: "2026-09-25T10:05:00.000Z",
    metadata: {},
  });
  const ask = await ctxStore.insertMessage({
    conversation_id: convo.id,
    member_id: null,
    external_message_id: "m-ask",
    reply_to_message_id: loose.id,
    message_type: "text",
    body: "@kroogy_bot что мы обсуждали по личному кабинету?",
    occurred_at: "2026-09-25T10:06:00.000Z",
    metadata: {},
  });
  const context = await buildTeamAgentContext(ctxStore, {
    conversationId: convo.id,
    triggerMessage: ask,
  });
  assert.ok(context.recentMessages.some((message) => message.id === linked.id));
  assert.ok(context.recentMessages.some((message) => message.id === loose.id));
  const decision = await proposeDecision(ctxStore, { title: "Идея кабинета", description: "пока идея" });
  assert.equal(decision.status, "proposed");
  passed += 3;

  const taskProvider = new ScriptedProvider({
    replyText: "Предлагаю разделить работу.",
    proposedActions: [{ type: "create_task", payload: { title: "Личный кабинет", description: "профиль и настройки" } }],
    needsHumanApproval: false,
  });
  const taskStore = store();
  const taskRun = await handleTelegramUpdate({
    update: update("@kroogy_bot распредели работу", 5),
    store: taskStore,
    provider: taskProvider,
    env: env(),
    botUserId: 1,
  });
  assert.equal(taskRun.providerCalls, 1);
  assert.equal((await taskStore.listTasks()).length, 0);
  const created = await proposeTask(taskStore, { title: "Личный кабинет", description: "профиль и настройки" });
  assert.equal(created.status, "proposed");
  passed += 1;

  const approval = await taskStore.insertApproval({
    approval_type: "task_assignment",
    status: "pending",
    payload: { taskId: created!.id, memberId: (await taskStore.listActiveMembers())[1]!.id },
    proposed_by_member_id: null,
    decided_by_member_id: null,
    source_message_id: null,
  });
  const denied = await handleTelegramUpdate({
    update: update(`/agent approve ${approval.id}`, 6, 999, "stranger"),
    store: taskStore,
    env: env(),
    botUserId: 1,
  });
  assert.equal(denied.providerCalls, 0);
  assert.equal((await taskStore.getApproval(approval.id))?.status, "pending");
  const allowed = await handleTelegramUpdate({
    update: update(`/agent approve ${approval.id}`, 7),
    store: taskStore,
    env: env(),
    botUserId: 1,
  });
  assert.equal(allowed.providerCalls, 0);
  assert.equal((await taskStore.getApproval(approval.id))?.status, "approved");
  passed += 2;

  const github = new GitHubRepositoryContextProvider({
    token: "ghp_testtoken",
    repo: "offsam/groogy",
    fetchImpl: async (url) => {
      const path = String(url);
      const json = path.endsWith("/groogy")
        ? { default_branch: "main" }
        : path.includes("/branches")
          ? [{ name: "main" }, { name: "team-agent/telegram-webhook-v1" }]
          : path.includes("/commits?")
            ? [{ sha: "abc", commit: { message: "feat", committer: { date: "2026-09-25T00:00:00.000Z" } } }]
            : path.includes("/pulls?")
              ? [{ number: 7, title: "Profile", head: { ref: "feature/profile", sha: "abc" } }]
              : path.includes("/files")
                ? [{ filename: "package.json" }]
                : { state: "success" };
      return { ok: true, status: 200, json: async () => json };
    },
  });
  const repo = await github.getContext();
  assert.ok(repo.github?.branches.includes("team-agent/telegram-webhook-v1"));
  assert.ok(repo.changedFiles.includes("package.json"));
  const conflict = detectPathConflicts(["package.json"], repo.changedFiles);
  assert.equal(conflict.severity, "high");
  const missing = unavailableRepository("GitHub: не подключён.");
  assert.equal(missing.recentCommits.length, 0);
  assert.equal(missing.notes.some((note) => note.includes("deadbeef")), false);
  passed += 3;

  assert.equal(classifyBillingFailure(402, "insufficient credits"), "billing_credits");
  assert.equal(classifyBillingFailure(402, "key limit exceeded"), "billing_key_limit");
  assert.equal(classifyBillingFailure(402, "upstream rejected"), "billing_unknown");
  assert.match(publicFailureText("billing_credits"), /пополнить баланс/);
  assert.equal(classifyBillingFailure(500, "insufficient credits"), null);
  passed += 1;

  assert.equal(validateAgentAction({ type: "merge", payload: {} }).ok, false);
  assert.equal(parseLocalCommand("/agent approve not-an-id", "kroogy_bot")?.kind, "approve_invalid");
  passed += 1;

  console.log(`team-agent assistant: ok (${passed})`);
  globalThis.fetch = originalFetch;
}

main().catch((err) => {
  globalThis.fetch = originalFetch;
  console.error(err);
  process.exit(1);
});
