# Telegram Adapter V1

**Bot:** `@kroogy_bot` (display: Kroogi.ai)  
**Status:** Bot API adapter + webhook + Supabase production store + local bootstrap helpers.  
Telegram is the **interface** to Team Agent, not a product channel.

**Separate from** the product Telethon/MTProto collector (`scripts/telegram-collector/`). Do not mix them.

---

## A. BotFather / group

- Bot username: `kroogy_bot`
- Privacy mode: **DISABLED** (required for passive group ingestion)
- Bot added to the private team group
- Passive ingestion ≠ automatic AI: ordinary messages are stored only; LLM/provider runs only on explicit invocation

---

## B. Required env (`.env.local` / Vercel — never commit values)

```text
TEAM_AGENT_ENABLED=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=kroogy_bot
TELEGRAM_ALLOWED_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
TEAM_AGENT_PUBLIC_BASE_URL=https://your-public-host
TEAM_AGENT_PROVIDER=mock
```

Also needed for production store: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only).

---

## C. How to identify chat ID

1. Add `@kroogy_bot` to the team group and send any message.
2. Run:

```bash
npm run team-agent:telegram:bootstrap
```

3. Copy `chat_id=…` into `TELEGRAM_ALLOWED_CHAT_ID`.

---

## D. How to identify member Telegram IDs

Same bootstrap output shows sender usernames when updates exist. Or after poller/webhook ingest, inspect stored `metadata.senderExternalId` / member rows.

Fill `team_agent_members.telegram_user_id` (stable) + optional username — **do not hardcode IDs in source**.

Template: `lib/team-agent/members.ts` (`TEAM_MEMBER_BOOTSTRAP_TEMPLATE`).

---

## E. Allowed chat

Only `TELEGRAM_ALLOWED_CHAT_ID` is processed. All other chats: ignore, no ingest, no reply.

---

## F–H. Webhook register / secret / status

```bash
# after public HTTPS deploy + migration applied
npm run team-agent:telegram:setup
npm run team-agent:telegram:status
```

- Route: `POST /api/webhooks/team-agent-telegram`
- Telegram header: `X-Telegram-Bot-Api-Secret-Token` must match `TELEGRAM_WEBHOOK_SECRET`
- Missing/wrong secret → `401` (no details)
- `setWebhook` always sends `secret_token`

---

## I. Expected behavior

| Input | Stored | Provider | Telegram reply |
|---|---|---|---|
| Ordinary group message | yes (allowed chat) | **0 calls** | no |
| `@kroogy_bot …` (entity mention) | yes | 1 | yes (Mock) |
| `/agent …` (bot_command) | yes | 1 | yes |
| Reply to bot message | yes | 1 | yes |
| Other group | no | 0 | no |
| Bot’s own message | no | 0 | no |

Bare words «бот», «агент», «Kroogy», «AI» do **not** invoke.

---

## J. Troubleshooting

| Symptom | Check |
|---|---|
| No messages | Privacy enabled? Bot in group? |
| Wrong chat | Re-run bootstrap; fix `TELEGRAM_ALLOWED_CHAT_ID` |
| Webhook silent | `team-agent:telegram:status`; URL https; secret match |
| Vercel URL changed | Re-run `team-agent:telegram:setup` |
| 500 on webhook | Migration applied? service_role env? |
| Retries | Idempotent on `(conversation, external_message_id)`; `agent_replied` blocks duplicate AI |

---

## K. Security

- Token / webhook secret / service_role: server-only
- No client Supabase for `team_agent_*`
- Chat allowlist
- Forbidden actions unchanged (no shell/sql/merge/deploy from chat)
- Unknown members: no privileged action execution

---

## L. Disable quickly

1. `TEAM_AGENT_ENABLED=false`
2. Optionally `npm run team-agent:telegram:status` then delete webhook via Bot API / controlled `telegramDeleteWebhook` in a script when needed

---

## Storage

| Path | Store |
|---|---|
| Unit tests / `simulate` / local `poll` bootstrap | `InMemoryTeamAgentStore` |
| Production webhook | `SupabaseTeamAgentStore` (service_role) |

Migration: `supabase/migrations/20260917160000_team_agent_foundation_v1.sql` — **do not apply remote without owner approval**.

---

## Edited messages

Same Telegram `message_id` → update existing row body + `message_type=edited` + `metadata.previous_body` (no duplicate rows).

---

## Code map

- Normalize: `lib/team-agent/telegram/normalize.ts`
- Handler: `lib/team-agent/telegram/handle-update.ts`
- Bot API: `lib/team-agent/telegram/bot-api.ts`
- Webhook: `app/api/webhooks/team-agent-telegram/route.ts`
- Supabase store: `lib/team-agent/supabase-store.ts`
- Tests: `telegram/integration.test.ts`, `normalize.test.ts`
