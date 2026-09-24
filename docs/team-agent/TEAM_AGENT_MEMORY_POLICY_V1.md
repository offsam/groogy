# Team Agent Memory Policy V1

**Principle:** `CHAT HISTORY ≠ MEMORY ≠ DECISION ≠ TASK`

---

## What is stored permanently (controlled)

| Layer | Table / concept | When it becomes durable truth |
|---|---|---|
| Message history | `team_agent_messages` | On ingest (factual log of what was said) |
| Memory | `team_agent_memory` | Only when explicitly recorded / confirmed; `status=active` |
| Decision | `team_agent_decisions` | Only when `status=confirmed` |
| Task | `team_agent_tasks` | From `proposeTask` onward; assignment may need approval |

---

## Message history

- Raw team conversation (Telegram / manual / test).
- Used for recent context windows (bounded, default ≤ 30 messages).
- **Not** automatically promoted to memory.
- Unknown senders are kept with `member_id = null`.

---

## Confirmed decision

- Structured team agreement (`title` + `description`).
- Lifecycle: `proposed` → `confirmed` | `rejected`; later `superseded` | `cancelled`.
- **Only `confirmed`** enters authoritative agent context.
- LLM-extracted `PotentialDecision` always starts as `proposed`.
- Changing a decision: create a new row with `supersedes_decision_id`; do **not** delete the old one.

---

## Team member fact

- Lives primarily on `team_agent_members` (responsibilities, skills, identities).
- Optional `team_agent_memory` with `memory_type=team_fact` for durable notes (e.g. “Alex owns migrations this sprint”).
- Identity updates: prefer updating the member row (telegram_user_id is stable; username may change).

---

## How facts update

1. Prefer supersede / invalidate over silent overwrite of meaning.
2. Memory: set old `status=superseded|invalid`, insert new active row.
3. Decisions: supersede chain.
4. Tasks: validated status transitions only.

---

## What the agent must NOT turn into memory

- Jokes, greetings, off-topic chat
- Temporary status (“зайду через 5 минут”)
- Speculative ideas without confirmation
- Secrets, tokens, phone numbers, private credentials
- Full raw dumps of repository files
- Every message in the group

---

## How to remove erroneous memory

1. Set `status=invalid` (preferred audit trail), or
2. Supersede with corrected content.
3. Do not rewrite history of `team_agent_messages` to “fix” memory — correct the memory layer.

---

## Avoiding “everything becomes memory”

- Default ingest = message only.
- Context builder reads **bounded** recent messages + **active** memory + **confirmed** decisions + **active** tasks.
- Agent actions that write memory go through allowlisted `record_memory` (and can be gated by approval for sensitive types).

---

## Categories (`memory_type`)

- `project_fact` — stable project truths (e.g. “Team Agent is internal-only”)
- `team_fact` — people / ownership facts
- `decision` — pointer/summary linked to a confirmed decision (optional)
- `constraint` — hard technical limits
- `preference` — working preferences
- `summary` — compact discussion summaries (explicit only)
