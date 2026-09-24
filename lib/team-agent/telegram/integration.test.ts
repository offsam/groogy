/**
 * Telegram Integration V1 — fixture tests (no real Telegram, no DB).
 * Run: npx tsx lib/team-agent/telegram/integration.test.ts
 */
import assert from "node:assert/strict";
import { InMemoryTeamAgentStore } from "../store";
import { seedMembersFromTemplate } from "../members";
import { handleTelegramUpdate } from "./handle-update";
import { normalizeTelegramUpdate } from "./normalize";
import { verifyTelegramWebhookSecret } from "./webhook-auth";
import { splitTelegramText } from "./bot-api";
import type { TelegramUpdate } from "./types";
import type { TeamAgentProvider } from "../agent-provider";
import type { AgentRespondResult, TeamAgentContext } from "../types";

const BOT = "kroogy_bot";
const CHAT = "-100555";
const OTHER = "-100999";

const baseConfig = {
  allowedChatId: CHAT,
  botUsername: BOT,
  mentionTokens: [`@${BOT}`],
  botUserId: 777,
};

function envForTests(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TEAM_AGENT_ENABLED: "1",
    TELEGRAM_BOT_USERNAME: BOT,
    TELEGRAM_ALLOWED_CHAT_ID: CHAT,
    TELEGRAM_BOT_TOKEN: "test-token-not-real",
    TEAM_AGENT_PROVIDER: "mock",
  };
}

function msgUpdate(opts: {
  text: string;
  updateId?: number;
  messageId?: number;
  chatId?: number;
  fromId?: number;
  username?: string;
  isBot?: boolean;
  entities?: TelegramUpdate["message"] extends infer M
    ? M extends { entities?: infer E }
      ? E
      : never
    : never;
  replyToBot?: boolean;
  edited?: boolean;
}): TelegramUpdate {
  const message = {
    message_id: opts.messageId ?? 1,
    date: 1_700_000_000,
    text: opts.text,
    from: {
      id: opts.fromId ?? 1001,
      username: opts.username ?? "sam",
      first_name: "Sam",
      is_bot: opts.isBot ?? false,
    },
    chat: {
      id: opts.chatId ?? Number(CHAT),
      type: "supergroup",
      title: "Kroogy Team",
    },
    entities: opts.entities,
    reply_to_message: opts.replyToBot
      ? {
          message_id: 50,
          from: { id: 777, is_bot: true, username: BOT, first_name: "Bot" },
        }
      : undefined,
  };
  if (opts.edited) {
    return { update_id: opts.updateId ?? 1, edited_message: message };
  }
  return { update_id: opts.updateId ?? 1, message };
}

function setupStore() {
  const store = new InMemoryTeamAgentStore();
  seedMembersFromTemplate(store, undefined, {
    sam: { telegram_user_id: 1001, telegram_username: "sam" },
    member_2: { telegram_user_id: 1002, telegram_username: "alex" },
    member_3: { telegram_user_id: 1003, telegram_username: "ivan" },
  });
  return store;
}

class CountingProvider implements TeamAgentProvider {
  calls = 0;
  fail = false;
  async respond(): Promise<AgentRespondResult> {
    this.calls += 1;
    if (this.fail) throw new Error("mock provider boom");
    return {
      replyText: "mock reply",
      proposedActions: [],
      needsHumanApproval: false,
    };
  }
}

// Stub sendMessage network — handleTelegramUpdate calls real fetch.
// Override fetch for telegram API in this process.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.telegram.org")) {
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return originalFetch(input, init);
}) as typeof fetch;

async function run() {
  // 1. normal allowed-group message
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const r = await handleTelegramUpdate({
      update: msgUpdate({ text: "Женя, завтра надо посмотреть страницу профиля" }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(r.stored, true);
    assert.equal(r.shouldRespond, false);
    assert.equal(r.providerCalls, 0);
    assert.equal(provider.calls, 0);
    assert.equal(store.listRecentMessages(
      [...store.conversations.values()][0].id,
      10,
    ).length, 1);
  }

  // 2. @kroogy_bot mention (entities)
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const text = "@kroogy_bot какие задачи сейчас обсуждаем?";
    const r = await handleTelegramUpdate({
      update: msgUpdate({
        text,
        entities: [{ type: "mention", offset: 0, length: "@kroogy_bot".length }],
      }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(r.status, "replied");
    assert.equal(r.shouldRespond, true);
    assert.equal(provider.calls, 1);
  }

  // 3. /agent command entity
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const r = await handleTelegramUpdate({
      update: msgUpdate({
        text: "/agent статус",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(r.shouldRespond, true);
    assert.equal(provider.calls, 1);
  }

  // 4. unauthorized chat
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const r = await handleTelegramUpdate({
      update: msgUpdate({
        text: "@kroogy_bot hello",
        chatId: Number(OTHER),
        entities: [{ type: "mention", offset: 0, length: 11 }],
      }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(r.status, "ignored");
    assert.equal(r.stored, false);
    assert.equal(provider.calls, 0);
  }

  // 5. duplicate message id
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const u = msgUpdate({ text: "ping once", messageId: 42 });
    await handleTelegramUpdate({
      update: u,
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    await handleTelegramUpdate({
      update: { ...u, update_id: 2 },
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    const conv = [...store.conversations.values()][0];
    assert.equal(store.listRecentMessages(conv.id, 50).length, 1);
  }

  // 6. bot's own message ignored
  {
    const n = normalizeTelegramUpdate(
      msgUpdate({ text: "I am bot", isBot: true, fromId: 777, username: BOT }),
      baseConfig,
    );
    assert.equal(n.ignored, true);
  }

  // 7. unknown member — no privileged actions applied
  {
    const store = setupStore();
    const provider: TeamAgentProvider = {
      async respond(ctx: TeamAgentContext): Promise<AgentRespondResult> {
        assert.equal(ctx.requestingMember, null);
        return {
          replyText: "hi unknown",
          proposedActions: [
            {
              type: "propose_assignment_batch",
              payload: { assignments: [{ taskId: "x", memberId: "y" }] },
            },
          ],
          needsHumanApproval: true,
        };
      },
    };
    const before = store.listApprovals().length;
    await handleTelegramUpdate({
      update: msgUpdate({
        text: "@kroogy_bot hi",
        fromId: 9999,
        username: "stranger",
        entities: [{ type: "mention", offset: 0, length: 11 }],
      }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(store.listApprovals().length, before);
  }

  // 8. reply to bot
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const r = await handleTelegramUpdate({
      update: msgUpdate({ text: "уточни пожалуйста", replyToBot: true }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(r.shouldRespond, true);
    assert.equal(provider.calls, 1);
  }

  // 9. edited_message updates in place
  {
    const store = setupStore();
    const provider = new CountingProvider();
    await handleTelegramUpdate({
      update: msgUpdate({ text: "first", messageId: 70 }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    await handleTelegramUpdate({
      update: msgUpdate({ text: "second edit", messageId: 70, edited: true }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    const conv = [...store.conversations.values()][0];
    const msgs = store.listRecentMessages(conv.id, 10);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].body, "second edit");
    assert.equal(msgs[0].message_type, "edited");
  }

  // 10–11. webhook secret
  {
    assert.equal(
      verifyTelegramWebhookSecret({ expected: "abc", provided: "wrong" }).ok,
      false,
    );
    assert.equal(
      verifyTelegramWebhookSecret({ expected: null, provided: "x" }).ok,
      false,
    );
    assert.equal(
      verifyTelegramWebhookSecret({ expected: "secret", provided: "secret" }).ok,
      true,
    );
  }

  // 12–13. malformed / unsupported
  {
    const n = normalizeTelegramUpdate({ update_id: 1 }, baseConfig);
    assert.equal(n.ignored, true);
    assert.equal(n.ignoreReason, "unsupported_update");
  }

  // 14. sendMessage failure controlled
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const prev = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, description: "fail" }), {
        status: 200,
      })) as typeof fetch;
    const r = await handleTelegramUpdate({
      update: msgUpdate({
        text: "@kroogy_bot ping",
        entities: [{ type: "mention", offset: 0, length: 11 }],
      }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(r.status, "provider_error");
    globalThis.fetch = prev;
  }

  // 15. Mock Agent failure controlled
  {
    const store = setupStore();
    const provider = new CountingProvider();
    provider.fail = true;
    const r = await handleTelegramUpdate({
      update: msgUpdate({
        text: "@kroogy_bot ping",
        messageId: 88,
        entities: [{ type: "mention", offset: 0, length: 11 }],
      }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(r.status, "provider_error");
    assert.ok((r.providerCalls ?? 0) >= 1);
  }

  // 16. duplicate webhook after reply → no second provider call
  {
    const store = setupStore();
    const provider = new CountingProvider();
    const u = msgUpdate({
      text: "@kroogy_bot once",
      messageId: 91,
      entities: [{ type: "mention", offset: 0, length: 11 }],
    });
    await handleTelegramUpdate({
      update: u,
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(provider.calls, 1);
    await handleTelegramUpdate({
      update: { ...u, update_id: 100 },
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(provider.calls, 1);
  }

  // 17. ordinary conversation does NOT call provider
  {
    const store = setupStore();
    const provider = new CountingProvider();
    await handleTelegramUpdate({
      update: msgUpdate({ text: "просто болтаем про профиль" }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(provider.calls, 0);
  }

  // loose words must not trigger
  {
    const store = setupStore();
    const provider = new CountingProvider();
    await handleTelegramUpdate({
      update: msgUpdate({ text: "агент бот Kroogy AI помоги" }),
      store,
      provider,
      botUserId: 777,
      env: envForTests(),
    });
    assert.equal(provider.calls, 0);
  }

  assert.deepEqual(splitTelegramText("short"), ["short"]);
  assert.ok(splitTelegramText("x".repeat(5000)).length > 1);

  console.log("telegram integration: ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
