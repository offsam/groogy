# LLM Provider V1

Team Agent talks to a model only on an explicit invocation. Ordinary chat is stored and does not call OpenAI.

## Providers

`TeamAgentProvider.respond()` is the only model entry. `createTeamAgentProvider()` reads `TEAM_AGENT_PROVIDER`.

| Value | Behavior |
|---|---|
| `mock` | Local reply. Default for tests. No API key. |
| `openai` | Direct OpenAI Responses API. Key: `OPENAI_API_KEY`. Default model `gpt-6-luna`. |
| `openrouter` | Same request through `https://openrouter.ai/api/v1`. Key: `OPENROUTER_API_KEY`. Default model `deepseek/deepseek-v4-flash`. |

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

## OpenRouter

OpenRouter uses the same official OpenAI SDK and the same Responses request. The client sets `baseURL` to `https://openrouter.ai/api/v1` and reads `OPENROUTER_API_KEY`. It does not read `OPENAI_API_KEY`.

OpenRouter's Responses API is stateless. `store: true` and `previous_response_id` return HTTP 400. This provider sends `store: false` and does not send `previous_response_id`. There is no model fallback list.

`deepseek/deepseek-v4-flash` is the default only when `TEAM_AGENT_MODEL` is empty and the provider is `openrouter`. The catalog lists structured outputs, `response_format`, and `reasoning_effort`, so the request still uses JSON schema and reasoning effort `low`. Set `TEAM_AGENT_MODEL` to another slug to switch. Prices stay out of application code.

## Switch the model

Set `TEAM_AGENT_MODEL`. For Preview, use `TEAM_AGENT_PROVIDER=openrouter` or `openai`. Production is unchanged until a separate approval.
