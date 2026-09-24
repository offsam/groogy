# GitHub Integration V1 (contract)

**Status:** contract only — no GitHub App / webhooks in Foundation V1.

Goal: connect `PLAN → TASK → ASSIGNEE → BRANCH → COMMITS → RESULT` without auto-merge.

---

## Future flow

```text
Task approved
  → branch_name assigned (human or suggested)
  → developer works
  → push
  → GitHub webhook/event
  → match branch/commit to team_agent_tasks / team_agent_git_activity
  → analyze changed paths
  → compare with declared scope_paths
  → check CI results
  → detect conflict / scope deviation
  → report into Telegram
  → human decides merge
```

**Agent must never merge PRs automatically.**

---

## Events to record (`team_agent_git_activity.event_type`)

- `branch_created`
- `commit_pushed`
- `pr_opened`
- `pr_updated`
- `merged` (observation only — not performed by agent)

---

## Least-privilege GitHub permissions (future)

Prefer a GitHub App or fine-scoped token:

| Permission | Access | Why |
|---|---|---|
| Contents | Read | Inspect commits / trees |
| Pull requests | Read | PR metadata / files |
| Checks / Actions | Read | CI status |
| Metadata | Read | Default |
| Contents / PR write | **None** for V1 agent | Prevents push/merge |
| Administration | **None** | — |

No `delete_branch`, `force_push`, or workflow dispatch from Team Agent V1 actions (already forbidden in allowlist).

---

## Conflict with declared scope

If pushed paths fall outside `scope_paths` (or hit another active task’s scope):

1. Record git activity row with metadata.
2. Notify Telegram.
3. Leave task in `review` / `blocked` as policy decides — human resolves.

---

## Next step after Telegram

1. Implement webhook → `team_agent_git_activity` writer.
2. Implement `GitHubRepositoryContextProvider` for remote metadata when local git is unavailable (e.g. Vercel).
3. Keep merge as a human action in GitHub UI.
