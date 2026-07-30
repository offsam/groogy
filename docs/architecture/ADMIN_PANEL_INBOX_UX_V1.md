# Admin Panel — Review Inbox UX & Performance Audit (V1)

Date: 2026-07-27  
Scope: Saved Views, bulk actions, assignment UI, priority, metrics, Inbox UX.

## 1. Saved Views implemented (system)

| View | Filters |
|---|---|
| All | — |
| High Confidence | `minConfidence ≥ 0.7` |
| Professionals | `entityType=professional` |
| Businesses | `entityType=business` |
| Marketplace | `entityType=marketplace` |
| Jobs | `entityType=job` |
| Events | `reviewType=event_verification` |
| Claims | `reviewType=ownership_claim` |
| Recommendations | `reviewType=recommendation` |
| Telegram | `source=telegram` |
| Facebook | `source=facebook` |
| Directories | `source=directories` |
| Needs Review | `in_review` / `needs_more_info` |
| Recently Imported | `maxAgeHours=48` |

**Custom views later:** `listInboxViews(custom)` merges system + user presets (same shape). No DB yet — store can be localStorage/API later.

## 2. Bulk Actions

| Action | Behavior |
|---|---|
| Approve | Existing handlers per review type |
| Reject | Existing handlers per review type |
| Archive | UI present — Coming Soon (no unified admin archive API) |
| Assign / Unassign | Client localStorage (`assignment.ts`) — architecture ready for DB |
| Change Status | Import Review only via `setImportReviewStatusAction` |

## 3. Priority Score (computed, no DB)

```
score (0–100) =
  AI Confidence × 40   (missing → 0.5 neutral)
+ Age up to 40         (14+ days → full)
+ Review Type up to 20 (claim 20 / import 15 / event 12 / recommendation 10)
```

Bands: high ≥70, medium ≥40, else low. Sorted desc in Inbox.

## 4. Metrics bar

- **Total** — loaded unfiltered count  
- **In Review** — `status === in_review`  
- **High Confidence** — AI ≥ 70%  
- **Assigned to Me** — localStorage assignments for current user  
- **Oldest Task** — age of oldest loaded item  

## 5. Performance Audit (10k / 50k)

### Current architecture

- Server aggregates **4 fetchers** with hard caps: Import Review ≤100, Events ≤100, Recommendations ≤400, Claims = all pending.
- Merge + filter + sort happen **in memory** on the server, then full filtered list is sent to the client.
- Client renders **every** visible row (no virtualization).
- Search / multi-select are client-side over the already-fetched list.

### At scale

| Scale | Expected behavior today | Verdict |
|---|---|---|
| ≤ ~700 (current caps) | Fine for daily use | OK |
| 10 000 tasks | Would OOM/time out or truncate silently at fetcher caps — **Inbox does not actually load 10k today** | Not ready |
| 50 000 tasks | Same — caps hide the problem; if caps raised without pagination, SSR payload + React list become unusable | Not ready |

### Recommendations (do **not** implement until needed)

1. **Server-side pagination / keyset** per source, then merge top-N by priority (or unified SQL view / RPC).  
2. **Raise / remove pageSize only with cursor pagination** — never ship unbounded `select *`.  
3. **Virtualize** the list (`@tanstack/react-virtual` or similar) once page size > ~200–500 rows.  
4. **Metrics** should be SQL aggregates (`count`, `min(created_at)`), not full-row scans.  
5. **Bulk actions** should batch RPC / parallel with concurrency limit (today: sequential per item).  
6. Optional: persist assignment + priority snapshots in DB when volume requires multi-device sync.

### Decision

No optimization shipped in this change — audit only. Current caps keep load safe for present volumes.

## 6. Remaining toward Admin Panel V2

1. Hard redirects from legacy review lists → Inbox/Workspace  
2. Admin Archive APIs (Pros / Jobs / Events) + bulk Archive  
3. Server-backed Assignment + custom Saved Views  
4. Inbox pagination / virtualization when queues exceed ~1k  
5. Remove dual legacy moderation UIs after redirect soak period  
