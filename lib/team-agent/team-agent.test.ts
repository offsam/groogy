/**
 * Team Agent Foundation V1 — deterministic checks (no DB).
 * Run: npx tsx lib/team-agent/team-agent.test.ts
 */
import assert from "node:assert/strict";
import {
  InMemoryTeamAgentStore,
  MockRepositoryContextProvider,
  MockTeamAgentProvider,
  approvePendingAssignment,
  approveTask,
  assignTask,
  buildTeamAgentContext,
  canTransitionTask,
  completeTask,
  confirmDecision,
  detectPathConflicts,
  executeValidatedAction,
  ingestTeamMessage,
  isActiveTaskStatus,
  listAuthoritativeDecisions,
  proposeDecision,
  proposeTask,
  recordPotentialDecision,
  seedMembersFromTemplate,
  shouldAgentRespond,
  startTask,
  supersedeDecision,
  validateAgentAction,
} from "./index";

function setupTeam() {
  const store = new InMemoryTeamAgentStore();
  const [sam, m2, m3] = seedMembersFromTemplate(store, undefined, {
    sam: { telegram_user_id: 1001, telegram_username: "sam_dev" },
    member_2: {
      telegram_user_id: 1002,
      telegram_username: "backend_dev",
      responsibilities: ["lib", "supabase/migrations", "backend"],
    },
    member_3: {
      telegram_user_id: 1003,
      telegram_username: "frontend_dev",
      responsibilities: ["app", "components", "frontend"],
    },
  });
  return { store, sam, m2, m3 };
}

async function run() {
  // 1. member matching
  {
    const { store, sam } = setupTeam();
    const r = await ingestTeamMessage(store, {
      source: "test",
      conversationExternalId: "c1",
      messageExternalId: "m1",
      senderExternalId: "1001",
      senderUsername: "sam_dev",
      text: "hello",
    });
    assert.equal(r.member?.id, sam.id);
    assert.equal(r.unknownSender, false);
  }

  // 2. unknown member
  {
    const { store } = setupTeam();
    const r = await ingestTeamMessage(store, {
      source: "test",
      conversationExternalId: "c1",
      messageExternalId: "m2",
      senderExternalId: "9999",
      senderUsername: "stranger",
      text: "hi",
    });
    assert.equal(r.member, null);
    assert.equal(r.unknownSender, true);
  }

  // 3. duplicate external message
  {
    const { store } = setupTeam();
    const a = await ingestTeamMessage(store, {
      source: "test",
      conversationExternalId: "c1",
      messageExternalId: "dup-1",
      senderExternalId: "1001",
      senderUsername: "sam_dev",
      text: "once",
    });
    const b = await ingestTeamMessage(store, {
      source: "test",
      conversationExternalId: "c1",
      messageExternalId: "dup-1",
      senderExternalId: "1001",
      senderUsername: "sam_dev",
      text: "once again",
    });
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(a.message.id, b.message.id);
    assert.equal(store.listRecentMessages(a.conversation.id, 50).length, 1);
  }

  // 4. normal message → no response
  {
    const policy = shouldAgentRespond(
      { text: "Давайте разделим работу" },
      { mentionTokens: [], explicitCommands: ["/agent"], botUsername: "kroogy_bot" },
    );
    assert.equal(policy.respond, false);
    assert.equal(policy.listen, true);
  }

  // 5. mention → response requested
  {
    const policy = shouldAgentRespond(
      {
        text: "@kroogy_bot распредели задачи",
        botUsername: "kroogy_bot",
        metadata: { entity_mentions: ["kroogy_bot"] },
      },
      { mentionTokens: ["@kroogy_bot"], explicitCommands: ["/agent"], botUsername: "kroogy_bot" },
    );
    assert.equal(policy.respond, true);
    assert.equal(policy.reason, "mention");
  }

  // 6. task status validation
  {
    assert.equal(canTransitionTask("proposed", "approved"), true);
    assert.equal(canTransitionTask("completed", "in_progress"), false);
    const { store } = setupTeam();
    const t = await proposeTask(store, { title: "X", scope_paths: ["lib/x"] });
    await approveTask(store, t.id);
    await startTask(store, t.id);
    await completeTask(store, t.id);
    await assert.rejects(async () => startTask(store, t.id));
  }

  // 7. decision superseding
  {
    const { store } = setupTeam();
    const d1 = await proposeDecision(store, { title: "No production LLM for reviews" });
    await confirmDecision(store, d1.id);
    const { next } = await supersedeDecision(store, d1.id, {
      title: "Limited LLM for search only",
      autoConfirm: true,
    });
    assert.equal((await store.getDecision(d1.id))?.status, "superseded");
    assert.equal(next.status, "confirmed");
    const auth = await listAuthoritativeDecisions(store);
    assert.equal(auth.length, 1);
    assert.equal(auth[0].id, next.id);
  }

  // 8–10 conflicts
  {
    assert.equal(
      detectPathConflicts(["lib/reviews/actions.ts"], ["lib/reviews/actions.ts"]).severity,
      "high",
    );
    assert.equal(
      detectPathConflicts(["lib/reviews/**"], ["app/business/**"]).severity,
      "none",
    );
    assert.equal(detectPathConflicts(["package.json"], ["package.json"]).severity, "high");
  }

  // 11–12 actions
  {
    assert.equal(validateAgentAction({ type: "create_task", payload: { title: "Add" } }).ok, true);
    assert.equal(validateAgentAction({ type: "merge", payload: {} }).ok, false);
  }

  // 13. unconfirmed decision excluded
  {
    const { store, sam } = setupTeam();
    await recordPotentialDecision(store, {
      title: "Maybe use vector DB",
      description: "LLM guess",
      sourceMessageIds: [],
    });
    await confirmDecision(
      store,
      (await proposeDecision(store, { title: "Keep structured memory only" })).id,
    );
    const conv = store.findOrCreateConversation({
      source_type: "test",
      external_conversation_id: "ctx",
    });
    const ctx = await buildTeamAgentContext(store, {
      conversationId: conv.id,
      requestingMember: sam,
      repositoryProvider: new MockRepositoryContextProvider(),
    });
    assert.equal(ctx.activeDecisions.length, 1);
    assert.equal(ctx.activeDecisions[0].title, "Keep structured memory only");
  }

  // 14. completed/cancelled excluded
  {
    const { store, m2 } = setupTeam();
    const a = await proposeTask(store, { title: "A", scope_paths: ["lib/a"] });
    await approveTask(store, a.id);
    await assignTask(store, a.id, m2.id);
    await startTask(store, a.id);
    await completeTask(store, a.id);
    const b = await proposeTask(store, { title: "B", scope_paths: ["lib/b"] });
    await approveTask(store, b.id);
    await assignTask(store, b.id, m2.id);
    const cancelled = await proposeTask(store, { title: "C", scope_paths: ["lib/c"] });
    store.upsertTask({ ...cancelled, status: "cancelled" });
    assert.equal(isActiveTaskStatus("completed"), false);
    const ctx = await buildTeamAgentContext(store, {
      conversationId: store.findOrCreateConversation({
        source_type: "test",
        external_conversation_id: "w",
      }).id,
    });
    assert.ok(!ctx.activeTasks.some((t) => t.id === a.id));
    assert.ok(ctx.activeTasks.some((t) => t.id === b.id));
  }

  // 15. context bounds history
  {
    const { store } = setupTeam();
    const conv = store.findOrCreateConversation({
      source_type: "test",
      external_conversation_id: "hist",
    });
    for (let i = 0; i < 80; i++) {
      await ingestTeamMessage(store, {
        source: "test",
        conversationExternalId: "hist",
        messageExternalId: `h-${i}`,
        senderExternalId: "1001",
        senderUsername: "sam_dev",
        text: `msg ${i}`,
      });
    }
    const ctx = await buildTeamAgentContext(store, {
      conversationId: conv.id,
      maxMessages: 30,
    });
    assert.equal(ctx.recentMessages.length, 30);
  }

  // approval + mock agent
  {
    const { store, sam, m2, m3 } = setupTeam();
    await proposeTask(store, {
      title: "Backend foundation",
      scope_paths: ["lib/team-agent", "supabase/migrations"],
    });
    await proposeTask(store, {
      title: "UI polish",
      scope_paths: ["app/admin", "components"],
    });
    const r = await ingestTeamMessage(store, {
      source: "test",
      conversationExternalId: "sim",
      messageExternalId: "ask",
      senderExternalId: "1001",
      senderUsername: "sam_dev",
      text: "@kroogy_bot распредели задачи",
      botUsername: "kroogy_bot",
      metadata: { entity_mentions: ["kroogy_bot"] },
    });
    assert.equal(r.shouldRespond, true);
    const ctx = await buildTeamAgentContext(store, {
      conversationId: r.conversation.id,
      requestingMember: sam,
    });
    const agent = new MockTeamAgentProvider();
    const reply = await agent.respond(
      ctx,
      { triggerMessage: r.message, userText: r.message.body },
      store,
    );
    assert.ok(reply.needsHumanApproval);
    const exec = await executeValidatedAction(store, reply.proposedActions[0]);
    assert.equal(exec.applied, false);
    await approvePendingAssignment(store, (exec.result as { id: string }).id, sam.id);
    assert.ok(m2 && m3);
  }

  console.log("team-agent foundation: ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
