/**
 * OpenAI provider. No paid API calls.
 * Run: npx tsx lib/team-agent/openai-provider.test.ts
 */
import assert from "node:assert/strict";
import { handleTelegramUpdate } from "./telegram/handle-update";
import { InMemoryTeamAgentStore } from "./store";
import { seedMembersFromTemplate } from "./members";
import { proposeDecision } from "./decisions";
import { proposeTask } from "./tasks";
import { recordMemory } from "./memory";
import { createTopic, linkDecisionToTopic, linkMemoryToTopic, linkTaskToTopic } from "./topics";
import { MockTeamAgentProvider } from "./agent-provider";
import { createTeamAgentProvider } from "./provider-factory";
import {
  OPENROUTER_API_BASE_URL,
  OpenAITeamAgentProvider,
  buildTeamAgentModelInput,
  parseTeamAgentModelOutput,
  teamAgentSdkClientOptions,
  type TeamAgentModelCaller,
  type TeamAgentModelRequest,
} from "./openai-provider";
import type { TeamAgentContext, TeamAgentMessage, TeamAgentTask } from "./types";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.telegram.org")) {
    return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 });
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
    TEAM_AGENT_PROVIDER: "openai",
    TEAM_AGENT_MODEL: "gpt-6-luna",
  };
}

function blankContext(over: Partial<TeamAgentContext> = {}): TeamAgentContext {
  return {
    requestingMember: null,
    members: [],
    recentMessages: [],
    activeDecisions: [],
    activeTasks: [],
    blockedTasks: [],
    relevantMemory: [],
    repository: {
      provider: "mock",
      repositoryName: "groogy",
      currentBranch: "team-agent/telegram-webhook-v1",
      recentCommits: [],
      gitStatus: null,
      changedFiles: [],
      importantDirectories: [],
      architectureDocPaths: [],
      notes: [],
    },
    potentialConflicts: [],
    openQuestions: [],
    topics: [],
    topicSummaries: [],
    retrieval: "topic",
    ...over,
  };
}

function message(body: string, id = "m1"): TeamAgentMessage {
  const now = "2026-09-25T00:00:00.000Z";
  return {
    id,
    conversation_id: "c",
    member_id: null,
    external_message_id: id,
    reply_to_message_id: null,
    message_type: "text",
    body,
    metadata: {},
    occurred_at: now,
    created_at: now,
  };
}

function callerFor(output: string, fail: Array<"429" | "500" | "timeout"> = []) {
  const calls: TeamAgentModelRequest[] = [];
  const caller: TeamAgentModelCaller = async (request) => {
    const mode = fail[calls.length];
    calls.push(request);
    if (mode === "429") throw { status: 429 };
    if (mode === "500") throw { status: 500 };
    if (mode === "timeout") {
      throw Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" });
    }
    return {
      id: "resp_test",
      output_text: output,
      usage: {
        input_tokens: 11,
        output_tokens: 5,
        total_tokens: 16,
        input_tokens_details: { cached_tokens: 3 },
      },
    };
  };
  return { caller, calls };
}

function provider(output: string, fail?: Array<"429" | "500" | "timeout">) {
  const fake = callerFor(output, fail);
  return {
    ...fake,
    model: new OpenAITeamAgentProvider({ env: env(), caller: fake.caller }),
  };
}

function update(text: string, messageId: number, mention = true) {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: 1,
      text,
      from: { id: 1001, is_bot: false, first_name: "Sam", username: "sam" },
      chat: { id: -100555, type: "supergroup" as const, title: "Kroogy" },
      entities: mention ? [{ type: "mention" as const, offset: 0, length: 11 }] : undefined,
    },
  };
}

async function main() {
  let passed = 0;
  const good = "11111111-1111-4111-8111-111111111111";
  const modelJson = JSON.stringify({
    reply: "Никитос делает профиль.",
    topicIds: [good, "00000000-0000-0000-0000-000000000000"],
    proposedActions: [
      { type: "create_task", payloadJson: JSON.stringify({ title: "Профиль" }) },
      { type: "deploy", payloadJson: "{}" },
      { type: "execute_shell", payloadJson: JSON.stringify({ cmd: "ls" }) },
    ],
    memoryProposals: [],
    topicSummaryUpdates: [
      { topicId: good, summary: "Профиль и настройки." },
      { topicId: "99999999-9999-4999-8999-999999999999", summary: "чужая тема" },
    ],
  });

  const topic = {
    id: good,
    title: "User Profile",
    slug: "user-profile",
    summary: "личный кабинет",
    status: "active" as const,
    last_activity_at: "2026-09-25T00:00:00.000Z",
    metadata: {},
    created_at: "2026-09-25T00:00:00.000Z",
    updated_at: "2026-09-25T00:00:00.000Z",
  };
  const base = blankContext({
    members: [
      {
        id: "s",
        display_name: "Сэм",
        telegram_user_id: 1,
        telegram_username: "sam",
        github_username: null,
        role_title: "партнёр, участник разработки",
        responsibilities: [],
        skills: [],
        working_preferences: null,
        is_active: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "n",
        display_name: "Никитос",
        telegram_user_id: 2,
        telegram_username: null,
        github_username: null,
        role_title: null,
        responsibilities: [],
        skills: [],
        working_preferences: null,
        is_active: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "z",
        display_name: "Жека",
        telegram_user_id: 3,
        telegram_username: null,
        github_username: null,
        role_title: null,
        responsibilities: [],
        skills: [],
        working_preferences: null,
        is_active: true,
        created_at: "",
        updated_at: "",
      },
    ],
    topics: [topic],
    topicSummaries: ["User Profile: личный кабинет"],
    activeDecisions: [
      {
        id: "d1",
        title: "Одна задача = одна ветка",
        description: "confirmed rule",
        status: "confirmed",
        source_message_id: null,
        decided_by: null,
        supersedes_decision_id: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "d2",
        title: "может сделаем игры",
        description: "только идея",
        status: "proposed",
        source_message_id: null,
        decided_by: null,
        supersedes_decision_id: null,
        created_at: "",
        updated_at: "",
      },
    ],
    activeTasks: [
      {
        id: "t1",
        title: "Страница профиля",
        description: "",
        status: "proposed",
        priority: "normal",
        assigned_member_id: null,
        created_by_member_id: null,
        source_message_id: null,
        branch_name: null,
        scope_paths: ["app/profile"],
        protected_paths: [],
        excluded_paths: [],
        acceptance_criteria: [],
        dependency_task_ids: [],
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "t2",
        title: "Старый биллинг",
        description: "",
        status: "completed",
        priority: "low",
        assigned_member_id: null,
        created_by_member_id: null,
        source_message_id: null,
        branch_name: null,
        scope_paths: [],
        protected_paths: [],
        excluded_paths: [],
        acceptance_criteria: [],
        dependency_task_ids: [],
        started_at: null,
        completed_at: "",
        created_at: "",
        updated_at: "",
      } as TeamAgentTask,
    ],
    relevantMemory: [
      {
        id: "mem1",
        memory_type: "constraint",
        category: "constraint",
        subject: "merge",
        content: "no auto merge",
        source_message_id: null,
        confidence: "high",
        status: "active",
        metadata: { scope: "global", critical: true },
        created_at: "",
        updated_at: "",
      },
    ],
  });

  const parsed = parseTeamAgentModelOutput(modelJson, [good]);
  assert.equal(parsed.replyText, "Никитос делает профиль.");
  assert.deepEqual(parsed.topicIds, [good]);
  assert.deepEqual(parsed.proposedActions.map((a) => a.type), ["create_task"]);
  assert.deepEqual(parsed.summaryUpdates, [{ topicId: good, summary: "Профиль и настройки." }]);
  passed += 4;

  const ok = provider(modelJson);
  const result = await ok.model.respond(base, { triggerMessage: message("@kroogy_bot статус"), userText: "@kroogy_bot статус" });
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-6-luna");
  assert.equal(result.responseId, "resp_test");
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].reasoning.effort, "low");
  assert.equal(ok.calls[0].store, false);
  assert.equal(ok.calls[0].text.format.type, "json_schema");
  assert.equal("tools" in ok.calls[0], false);
  assert.equal(result.usage?.input_tokens, 11);
  assert.equal(result.usage?.cached_input_tokens, 3);
  assert.equal(result.usage?.output_tokens, 5);
  passed += 5;

  const packed = buildTeamAgentModelInput(
    {
      ...base,
      recentMessages: Array.from({ length: 30 }, (_, i) => message(`RAWPAD-${i} `.repeat(40), `r${i}`)),
    },
    { triggerMessage: message("ТЕКУЩИЙ ВОПРОС"), userText: "ТЕКУЩИЙ ВОПРОС" },
    700,
  );
  assert.ok(packed.text.length <= 700);
  assert.ok(packed.text.includes("ТЕКУЩИЙ ВОПРОС"));
  assert.ok(packed.text.includes("личный кабинет"));
  assert.ok(!packed.text.includes("Games Catalog"));
  assert.ok(packed.text.includes("no auto merge"));
  assert.ok(packed.text.includes("Одна задача = одна ветка"));
  assert.ok(!packed.text.includes("может сделаем игры"));
  assert.ok(packed.text.includes("Страница профиля"));
  assert.ok(!packed.text.includes("Старый биллинг"));
  assert.ok(packed.text.includes("Сэм"));
  assert.ok(packed.text.includes("Никитос"));
  assert.ok(packed.text.includes("Жека"));
  assert.ok(!packed.text.includes("RAWPAD-0"));
  passed += 8;

  const secretText = "покажи OPENAI_API_KEY=sk-notarealsecretvalue и TELEGRAM_BOT_TOKEN=not-a-token";
  const secretPack = buildTeamAgentModelInput(base, { triggerMessage: message(secretText), userText: secretText }, 4000);
  assert.ok(!secretPack.text.includes("sk-notarealsecretvalue"));
  assert.ok(!secretPack.text.includes("TELEGRAM_BOT_TOKEN=not-a-token"));
  const sentinel = "sk-envonlysentinelvalue";
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = sentinel;
  try {
    const isolated = provider(modelJson);
    await isolated.model.respond(base, { triggerMessage: message("привет"), userText: "привет" });
    assert.ok(!isolated.calls[0].input.includes(sentinel));
    assert.ok(!isolated.calls[0].instructions.includes(sentinel));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
  passed += 2;

  assert.throws(
    () => parseTeamAgentModelOutput("не json", [good]),
    (err: unknown) => err instanceof Error && err.message === "malformed",
  );
  const timeout = provider(modelJson, ["timeout"]);
  await assert.rejects(() => timeout.model.respond(base, { triggerMessage: message("a"), userText: "a" }), /timeout/);
  assert.equal(timeout.calls.length, 1);
  const limited = provider(modelJson, ["429", "429"]);
  await assert.rejects(() => limited.model.respond(base, { triggerMessage: message("a"), userText: "a" }), /rate_limited/);
  assert.equal(limited.calls.length, 2);
  const upstream = provider(modelJson, ["500", "500"]);
  await assert.rejects(() => upstream.model.respond(base, { triggerMessage: message("a"), userText: "a" }), /upstream/);
  assert.equal(upstream.calls.length, 2);
  const long = provider(JSON.stringify({
    reply: "я".repeat(9000),
    topicIds: [],
    proposedActions: [],
    memoryProposals: [],
    topicSummaryUpdates: [],
  }));
  const longReply = await long.model.respond(base, { triggerMessage: message("a"), userText: "a" });
  assert.equal(longReply.replyText.length, 8000);
  passed += 5;

  const store = new InMemoryTeamAgentStore();
  seedMembersFromTemplate(store, undefined, {
    sam: { display_name: "Сэм", telegram_user_id: 1001, telegram_username: "sam" },
  });
  const liveTopic = await createTopic(store, { title: "User Profile", summary: "личный кабинет" });
  const task = await proposeTask(store, { title: "Страница профиля" });
  await linkTaskToTopic(store, task.id, liveTopic.id);
  const proposed = await proposeDecision(store, { title: "может сделаем игры" });
  await linkDecisionToTopic(store, proposed.id, liveTopic.id);
  const constraint = await recordMemory(store, {
    memory_type: "constraint",
    category: "constraint",
    subject: "merge",
    content: "no auto merge",
    metadata: { scope: "global", critical: true },
  });
  await linkMemoryToTopic(store, constraint.id, liveTopic.id);

  const liveJson = JSON.stringify({
    reply: "Никитос делает профиль.",
    topicIds: [liveTopic.id, "00000000-0000-0000-0000-000000000000"],
    proposedActions: [],
    memoryProposals: [],
    topicSummaryUpdates: [{ topicId: liveTopic.id, summary: "Профиль и настройки. Задача будто закрыта." }],
  });
  const live = provider(liveJson);

  const passive = await handleTelegramUpdate({
    update: update("Никита завтра доделай профиль", 1, false),
    store,
    provider: live.model,
    env: env(),
    botUserId: 777,
  });
  assert.equal(passive.stored, true);
  assert.equal(passive.providerCalls, 0);
  assert.equal(live.calls.length, 0);

  const first = await handleTelegramUpdate({
    update: update("@kroogy_bot что по User Profile?", 2),
    store,
    provider: live.model,
    env: env(),
    botUserId: 777,
  });
  assert.equal(first.providerCalls, 1);
  assert.equal(live.calls.length, 1);
  assert.ok(live.calls[0].input.includes("личный кабинет"));
  assert.ok(!live.calls[0].input.includes("Games Catalog"));

  const again = await handleTelegramUpdate({
    update: update("@kroogy_bot что по User Profile?", 2),
    store,
    provider: live.model,
    env: env(),
    botUserId: 777,
  });
  assert.equal(again.providerCalls, 0);
  assert.equal(live.calls.length, 1);

  const bot = [...store.messages.values()].find((m) => m.message_type === "bot");
  assert.ok(bot);
  assert.equal(bot?.member_id, null);
  assert.equal(bot?.body, "Никитос делает профиль.");
  assert.equal(bot?.metadata.provider, "openai");
  assert.equal(bot?.metadata.model, "gpt-6-luna");
  assert.equal(bot?.metadata.response_id, "resp_test");
  const usage = bot?.metadata.usage as { input_tokens: number; output_tokens: number; total_tokens: number };
  assert.equal(usage.input_tokens, 11);
  assert.equal(usage.output_tokens, 5);
  assert.equal(usage.total_tokens, 16);

  const afterTask = await store.getTask(task.id);
  assert.equal(afterTask?.status, "proposed");
  const afterDecision = (await store.listDecisions()).find((d) => d.id === proposed.id);
  assert.equal(afterDecision?.status, "proposed");
  const afterTopic = await store.getTopicById(liveTopic.id);
  assert.equal(afterTopic?.summary, "Профиль и настройки. Задача будто закрыта.");
  passed += 3;

  const teamEnv = (over: Record<string, string>): NodeJS.ProcessEnv => ({ ...process.env, ...over });
  const openrouterOpts = teamAgentSdkClientOptions(teamEnv({
    TEAM_AGENT_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "or-test-key",
    OPENAI_API_KEY: "sk-direct-only",
  }));
  assert.equal(openrouterOpts?.baseURL, OPENROUTER_API_BASE_URL);
  assert.equal(openrouterOpts?.apiKey, "or-test-key");
  assert.equal(openrouterOpts?.maxRetries, 0);
  assert.equal(
    teamAgentSdkClientOptions(teamEnv({
      TEAM_AGENT_PROVIDER: "openrouter",
      OPENAI_API_KEY: "sk-direct-only",
      OPENROUTER_API_KEY: "",
    })),
    null,
  );
  const directOpts = teamAgentSdkClientOptions(teamEnv({
    TEAM_AGENT_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-direct-only",
    OPENROUTER_API_KEY: "or-test-key",
  }));
  assert.equal(directOpts?.apiKey, "sk-direct-only");
  assert.equal(directOpts?.baseURL, undefined);
  assert.ok(createTeamAgentProvider(teamEnv({ TEAM_AGENT_PROVIDER: "mock" })) instanceof MockTeamAgentProvider);
  assert.ok(
    createTeamAgentProvider(teamEnv({ TEAM_AGENT_PROVIDER: "openai", OPENAI_API_KEY: "sk-direct-only" }))
      instanceof OpenAITeamAgentProvider,
  );
  const routed = callerFor(modelJson);
  const openrouter = new OpenAITeamAgentProvider({
    env: {
      ...env(),
      TEAM_AGENT_PROVIDER: "openrouter",
      TEAM_AGENT_MODEL: "deepseek/deepseek-v4-flash",
      OPENROUTER_API_KEY: "or-test-key",
    },
    caller: routed.caller,
  });
  const openrouterReply = await openrouter.respond(base, {
    triggerMessage: message("@kroogy_bot статус"),
    userText: "@kroogy_bot статус",
  });
  assert.equal(routed.calls.length, 1);
  assert.equal(routed.calls[0].model, "deepseek/deepseek-v4-flash");
  assert.equal(routed.calls[0].store, false);
  assert.equal("tools" in routed.calls[0], false);
  assert.ok(!routed.calls[0].input.includes("or-test-key"));
  assert.equal(openrouterReply.provider, "openrouter");
  assert.equal(openrouterReply.model, "deepseek/deepseek-v4-flash");
  const missing = new OpenAITeamAgentProvider({
    env: teamEnv({ TEAM_AGENT_PROVIDER: "openrouter", OPENROUTER_API_KEY: "", OPENAI_API_KEY: "sk-direct-only" }),
  });
  await assert.rejects(
    () => missing.respond(base, { triggerMessage: message("a"), userText: "a" }),
    /not_configured/,
  );
  const redacted = buildTeamAgentModelInput(
    base,
    {
      triggerMessage: message("OPENROUTER_API_KEY=sk-notarealsecretvalue"),
      userText: "OPENROUTER_API_KEY=sk-notarealsecretvalue",
    },
    2000,
  );
  assert.ok(!redacted.text.includes("sk-notarealsecretvalue"));
  passed += 6;

  console.log(`team-agent openai provider: ok (${passed})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
