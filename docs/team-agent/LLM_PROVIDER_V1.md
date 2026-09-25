# LLM Provider V1

Team Agent talks to a model only on an explicit invocation. Ordinary chat is stored and does not call OpenAI.

## Providers

`TeamAgentProvider.respond()` is the only model entry. `createTeamAgentProvider()` reads `TEAM_AGENT_PROVIDER`.

| Value | Behavior |
|---|---|
| `mock` | Local reply. Default for tests. |
| `openai` | OpenAI Responses API, model `TEAM_AGENT_MODEL` (default `gpt-6-luna`). |

Mock stays in the repo. There is no LangChain, Agents SDK, or Assistant API.

## One request

The deterministic topic classifier runs locally and picks candidates. That is not an OpenAI call.

One invocation then sends one Responses request: the user text, members, selected topics and summaries, confirmed decisions, active tasks, memory, global constraints, a short repository snapshot, and recent linked messages. Reasoning effort is `low`. `store` is false. No web search, file search, shell, MCP, or code interpreter.

The model returns one JSON object: reply, topic ids, proposed actions, memory proposals, summary proposals. Application code validates it.

## Limits

`TEAM_AGENT_MAX_CONTEXT_CHARS` defaults to 40000. Oldest linked messages drop first, then extra memory, then extra topic lines. The user request, global constraints, confirmed decisions, and active tasks stay.

`TEAM_AGENT_MAX_OUTPUT_TOKENS` defaults to 1200.

## Topics

Topic ids from the model are kept only when they were in the context sent to the model. A summary update rewrites `team_agent_topics.summary` and summary metadata. It does not confirm a decision or change a task status.

## Actions

Allowed proposals go through `validateAgentAction()`. `deploy`, `execute_shell`, merge, and the other forbidden types are dropped. Assignment is staged as an approval, not applied. A suggested branch name is text only.

## Usage

The bot message (`message_type=bot`, no member) stores `provider`, `model`, `response_id`, and usage: input tokens, cached input tokens, output tokens, total tokens. Reasoning text is not stored.

## Errors and retries

A bad key, timeout, malformed JSON, or empty reply does not retry. 429 and 5xx get one extra HTTP try, then stop. The SDK retry is off (`maxRetries: 0`). A second Telegram delivery of an already answered update does not call the model again.

The chat reply on failure is: «Не удалось получить ответ AI. Попробуйте ещё раз.» The log code does not include the API key.

## Secrets

`OPENAI_API_KEY` is server-only. It is not a `NEXT_PUBLIC_` variable and it is not placed in the model input. Assignments of known secret names and `sk-…` tokens in chat text are redacted before the request.

## Switch the model

Set `TEAM_AGENT_MODEL` and `TEAM_AGENT_PROVIDER=openai` on the Preview environment. Production is unchanged until a separate approval.
