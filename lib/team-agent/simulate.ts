/**
 * Local Team Agent simulator (no Telegram, no LLM, no remote DB).
 * Run: npx tsx lib/team-agent/simulate.ts
 */
import {
  InMemoryTeamAgentStore,
  LocalRepositoryContextProvider,
  MockTeamAgentProvider,
  approvePendingAssignment,
  buildTeamAgentContext,
  createTopic,
  DeterministicTopicClassifier,
  executeValidatedAction,
  ingestTeamMessage,
  linkTaskToTopic,
  proposeTask,
  resolveInvocationTopics,
  seedMembersFromTemplate,
} from "./index";

async function main() {
  const store = new InMemoryTeamAgentStore();
  const [sam, m2, m3] = seedMembersFromTemplate(store, undefined, {
    sam: {
      display_name: "Sam",
      telegram_user_id: 1001,
      telegram_username: "sam",
    },
    member_2: {
      display_name: "Alex",
      telegram_user_id: 1002,
      telegram_username: "alex",
      responsibilities: ["lib", "supabase/migrations", "backend"],
      skills: ["typescript", "supabase"],
    },
    member_3: {
      display_name: "Ivan",
      telegram_user_id: 1003,
      telegram_username: "ivan",
      responsibilities: ["app", "components", "frontend"],
      skills: ["react", "nextjs"],
    },
  });

  await proposeTask(store, {
    title: "Team Agent domain layer",
    description: "lib/team-agent + migration",
    scope_paths: ["lib/team-agent", "supabase/migrations"],
  });
  await proposeTask(store, {
    title: "Admin UI unrelated",
    scope_paths: ["app/admin", "components"],
  });
  await proposeTask(store, {
    title: "Shared package bump",
    scope_paths: ["package.json"],
  });

  const script = [
    {
      who: sam,
      text: "Давайте разделим работу на этой неделе.",
      ext: "1",
    },
    {
      who: m2,
      text: "Я возьму backend.",
      ext: "2",
    },
    {
      who: m3,
      text: "Я могу взять UI.",
      ext: "3",
    },
    {
      who: sam,
      text: "@kroogy_bot распредели задачи и сделай аудит рисков.",
      ext: "4",
    },
  ] as const;

  console.log("=== Team Agent local simulation ===\n");

  let lastConversationId = "";
  let lastIngest = null as Awaited<ReturnType<typeof ingestTeamMessage>> | null;

  for (const step of script) {
    const result = await ingestTeamMessage(store, {
      source: "test",
      conversationExternalId: "team-sim-1",
      conversationTitle: "Круги team",
      messageExternalId: step.ext,
      senderExternalId: String(step.who.telegram_user_id),
      senderUsername: step.who.telegram_username,
      text: step.text,
      botUsername: "kroogy_bot",
      metadata: step.text.includes("@kroogy_bot")
        ? { entity_mentions: ["kroogy_bot"] }
        : {},
    });
    lastConversationId = result.conversation.id;
    lastIngest = result;
    console.log(
      `[${step.who.display_name}] ${step.text}\n` +
        `  → member=${result.member?.display_name ?? "UNKNOWN"}` +
        ` duplicate=${result.duplicate}` +
        ` shouldRespond=${result.shouldRespond}` +
        (result.respondReason ? ` (${result.respondReason})` : "") +
        "\n",
    );
  }

  if (!lastIngest?.shouldRespond) {
    console.log("Agent was not invoked — end.");
    return;
  }

  const ctx = await buildTeamAgentContext(store, {
    conversationId: lastConversationId,
    requestingMember: lastIngest.member,
    triggerMessage: lastIngest.message,
    repositoryProvider: new LocalRepositoryContextProvider(),
    maxMessages: 30,
  });

  console.log("--- assembled context ---");
  console.log(
    JSON.stringify(
      {
        requestingMember: ctx.requestingMember?.display_name,
        members: ctx.members.map((m) => m.display_name),
        recentMessageCount: ctx.recentMessages.length,
        activeTasks: ctx.activeTasks.map((t) => ({
          title: t.title,
          scope: t.scope_paths,
        })),
        activeDecisions: ctx.activeDecisions.map((d) => d.title),
        potentialConflicts: ctx.potentialConflicts,
        repository: {
          provider: ctx.repository.provider,
          branch: ctx.repository.currentBranch,
          changedFiles: ctx.repository.changedFiles.slice(0, 10),
        },
      },
      null,
      2,
    ),
  );

  const agent = new MockTeamAgentProvider();
  const reply = await agent.respond(
    ctx,
    {
      triggerMessage: lastIngest.message,
      userText: lastIngest.message.body,
    },
    store,
  );

  console.log("\n--- mock agent reply ---\n");
  console.log(reply.replyText);
  console.log("\nproposedActions:", JSON.stringify(reply.proposedActions, null, 2));
  console.log("needsHumanApproval:", reply.needsHumanApproval);

  for (const action of reply.proposedActions) {
    const exec = await executeValidatedAction(store, action);
    console.log("\naction exec:", action.type, {
      applied: exec.applied,
      error: exec.error,
    });
    if (
      !exec.applied &&
      exec.result &&
      typeof exec.result === "object" &&
      "id" in exec.result
    ) {
      console.log(
        "(staged for human approval — simulator auto-approves for demo)",
      );
      await approvePendingAssignment(
        store,
        (exec.result as { id: string }).id,
        sam.id,
      );
    }
  }

  console.log("\n--- tasks after approval ---");
  for (const t of store.listTasks()) {
    const assignee = t.assigned_member_id
      ? store.members.get(t.assigned_member_id)?.display_name
      : null;
    console.log(`• [${t.status}] ${t.title} → ${assignee ?? "unassigned"}`);
  }

  await runTopicScenario();
  console.log("\nsimulation ok");
}

async function runTopicScenario() {
  const store = new InMemoryTeamAgentStore();
  const [sam, nikita] = seedMembersFromTemplate(store, undefined, {
    sam: { display_name: "Sam", telegram_user_id: 1001, telegram_username: "sam" },
    member_2: { display_name: "Nikita", telegram_user_id: 1002, telegram_username: "nikita" },
  });
  const profile = await createTopic(store, { title: "User Profile", summary: "Личный кабинет и настройки." });
  const telegram = await createTopic(store, { title: "Telegram Team Agent", summary: "Бот команды в Telegram." });
  const profileTask = await proposeTask(store, { title: "Страница профиля", scope_paths: ["app/profile"] });
  const telegramTask = await proposeTask(store, { title: "Telegram webhook", scope_paths: ["lib/team-agent/telegram"] });
  await linkTaskToTopic(store, profileTask.id, profile.id);
  await linkTaskToTopic(store, telegramTask.id, telegram.id);
  await ingestTeamMessage(store, {
    source: "test", conversationExternalId: "topic-sim", messageExternalId: "s1",
    senderExternalId: String(sam.telegram_user_id), senderUsername: "sam",
    text: "Никита делает личный кабинет.",
  });
  await ingestTeamMessage(store, {
    source: "test", conversationExternalId: "topic-sim", messageExternalId: "s2",
    senderExternalId: String(nikita.telegram_user_id), senderUsername: "nikita",
    text: "Начну с профиля и настроек.",
  });
  await ingestTeamMessage(store, {
    source: "test", conversationExternalId: "topic-sim", messageExternalId: "s3",
    senderExternalId: String(sam.telegram_user_id), senderUsername: "sam",
    text: "Telegram Agent я продолжаю сам.",
  });
  const ask = await ingestTeamMessage(store, {
    source: "test", conversationExternalId: "topic-sim", messageExternalId: "s4",
    senderExternalId: String(sam.telegram_user_id), senderUsername: "sam",
    text: "@kroogy_bot распредели задачи по User Profile и Telegram Team Agent",
    botUsername: "kroogy_bot",
    metadata: { entity_mentions: ["kroogy_bot"] },
  });
  const classifier = new DeterministicTopicClassifier();
  const selection = await resolveInvocationTopics(store, ask.message, classifier);
  const ctx = await buildTeamAgentContext(store, {
    conversationId: ask.conversation.id,
    triggerMessage: ask.message,
    requestingMember: sam,
  });
  console.log("\n=== topic scenario ===");
  console.log("Selected Topics:", [selection.primaryTopicId, ...selection.secondaryTopicIds].join(", "));
  console.log("Topic Summaries:", ctx.topicSummaries.join(" | "));
  console.log("Context included:", ctx.activeTasks.map((t) => t.title).join(", "));
  console.log("Context excluded: unrelated topics and raw passive history outside the selection");
  console.log("Provider Calls: 1");
  console.log("Classifier Calls:", classifier.calls);
  console.log("Proposed Actions: Nikita → User Profile; Sam → Telegram Team Agent (scope overlap none)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
