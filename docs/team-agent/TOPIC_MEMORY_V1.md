# Topic / Memory Packets V1

Raw chat, topics, memory, decisions, and tasks are different layers.

| Layer | Where it lives | What it is |
|---|---|---|
| Raw chat | `team_agent_messages` | Immutable log of what people and the bot said |
| Topic | `team_agent_topics` | Named packet used to retrieve a slice of the project |
| Memory | `team_agent_memory` | Notes: idea, fact, constraint, question, preference, summary |
| Decision | `team_agent_decisions` | Authoritative only when `status=confirmed` |
| Task | `team_agent_tasks` | Authoritative work item |

A topic does not replace the other tables. It links to them.

## When a topic is created

Only during an explicit invocation (`@kroogy_bot`, `/agent`, or a reply to the bot), and only when no existing topic is close enough.

A new topic must have a short, stable title. One invocation creates at most one topic.

These do not create a topic: «тест», «привет», «что нового», «ответь», «проверка бота».

## Passive chat

An ordinary group message is stored and nothing else happens.

- no model call
- no topic classification
- no reply
- no summary update

## Selection

The local classifier runs inside the same invocation as the single provider call. It is not a second model request.

It prefers an existing topic by title, slug, and shared words. «Telegram bot» should attach to «Telegram Team Agent» instead of opening a new packet.

One message can have a primary topic and up to two secondary topics (three total).

## Retrieval

A specific question loads that topic's summary, confirmed decisions, active tasks, linked memory, and recent linked messages. Unrelated and archived topics stay out.

«Дай статус проекта» loads at most five active summaries and does not send the whole raw history.

A global constraint (`category=constraint` and `metadata.scope=global` or `metadata.critical=true`) can appear even when it is linked to another topic.

An archived topic is loaded only when the question names it.

## Summary

`team_agent_topics.summary` is a short cache. Confirmed decisions and task statuses stay in their own tables. A summary update must not confirm a proposal or change a task status.

Metadata records `summary_updated_at`, `summary_source`, and `summary_version`.

## Rename, archive, merge

- Rename changes the title. The id and slug stay, so links stay.
- Archive sets `status=archived`. Default retrieval skips it.
- Merge moves message, task, decision, and memory links onto the target, archives the source, and does not delete raw messages.

## Cost

Passive message: 0 model calls. Explicit invocation: 1 provider call. Candidate list defaults to 20 (`TEAM_AGENT_MAX_TOPIC_CANDIDATES`). Selection defaults to 3 (`TEAM_AGENT_MAX_SELECTED_TOPICS`). Overview defaults to 5 (`TEAM_AGENT_MAX_OVERVIEW_TOPICS`).

No embeddings, vector database, or extra framework.
