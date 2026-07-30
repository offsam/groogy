# Admin Panel — Review Workspace Capability & Legacy Audit (V1)

Date: 2026-07-27  
Scope: make `/admin/review/[taskId]` the primary moderator workplace without IA/DB changes.

## 1. Actions fully moved into Workspace

| Action | Where | Backend used |
|---|---|---|
| Approve / Reject Import Review | Workspace actions | `approveImportReviewItemAction`, `setImportReviewStatusAction` |
| Approve / Reject Ownership Claim | Workspace actions | `adminReviewBusinessClaimAction` |
| Approve / Reject Recommendation | Workspace actions | `approveCommentRecommendationAction`, `rejectCommentRecommendationAction` |
| Approve / Reject Event Verification | Workspace actions | `approveEventRecommendationAction`, `rejectCommentRecommendationAction` |
| Edit Import Review | `/admin/review/[taskId]/edit` | embeds `ImportReviewDetailPanel` (same save/approve logic) |
| Edit Recommendation / Event | `/admin/review/[taskId]/edit` | `saveCommentRecommendationFieldsAction` |
| Edit Claim → Business | `/admin/review/[taskId]/edit` | embeds `AdminBusinessForm` |
| Merge Import (duplicate) | Workspace Merge panel | `setImportReviewStatusAction(status: duplicate)` |
| Merge Claim businesses | Workspace Merge panel | `mergeBusinessesAction` |
| Archive business (from claim) | Workspace Archive | `adminSetBusinessStatusAction(archived)` |
| Open Original | Workspace | source / public / legacy URL |

## 2. Legacy dependencies removed / reduced

- **Edit no longer requires** opening `/admin/import-review/[id]` chrome for moderation edit — Workspace `/edit` embeds the same panel.
- **Event Approve/Reject** no longer blocked / broken in Workspace.
- Legacy pages remain as **compatibility layer** (banners + optional “Legacy page” link), not the primary path for Approve/Reject/Edit.

Still optional for operators:

- `/admin/import-review` list (history / filters)
- `/admin/recommendations` list
- `/admin/claims` list
- `/admin/events` verification list (display)
- Catalog admin tools with bulk merge UI (`/admin/businesses`)

## 3. Workspace capability table

Statuses: **Working** | **Partial** | **Coming Soon**

| Entity Type | View | Approve | Reject | Edit | Merge | Archive | Open Original |
|---|---|---|---|---|---|---|---|
| Business (import / claim) | Working | Working | Working | Working | Partial¹ | Partial² | Working |
| Professional (import / rec) | Working | Working | Working | Working³ | Coming Soon | Coming Soon | Working |
| Marketplace / Service | Working | Working | Working | Working³ | Coming Soon | Coming Soon | Working |
| Job (via import_review) | Working | Working | Working | Working³ | Coming Soon | Coming Soon | Working |
| Event (verification) | Working | Working | Working | Working | Coming Soon | Coming Soon | Working |
| Recommendation (pro/biz/svc) | Working | Working | Working | Working | Coming Soon | Coming Soon | Working |

¹ Import → mark duplicate; Claim → business merge when keep/drop IDs provided.  
² Archive wired for **business** on ownership claim only. Pros / Jobs / Events: no admin archive API → Coming Soon UI.  
³ Import uses full detail editor; recommendations use field editor until published.

## 4. Hard Redirect candidates (next release)

Safe **after** one release of Workspace as default:

| Legacy URL | Redirect to | Condition |
|---|---|---|
| `/admin/import-review/[id]` | `/admin/review/import_review:{id}` | Edit also at `…/edit` |
| `/admin/recommendations` (item deep links, if any) | Inbox `?view=recommendations` or Workspace | List can stay longer |
| `/admin/claims` item → Workspace | `/admin/review/ownership_claim:{id}` | When claim deep-link exists |
| `/admin/events` verification-only entry | Inbox `?view=events` | Keep `/admin/catalog/events` for catalog |

**Do not hard-redirect yet:** `/admin/businesses` (bulk merge/archive), `/admin/telegram-groups`, `/admin/directories` (imports history UI).

## 5. Remaining until full legacy UI retirement

1. Admin **Archive** for Professionals / Jobs / Events (no dedicated admin actions today).
2. **Merge** for Professionals / Recommendations (no backend).
3. Richer recommendation editor (contacts, category) beyond display_name/city/notes.
4. Inbox/list UX parity so operators never need legacy list filters.
5. Hard redirects + delete unused legacy page components.
6. Soft-migration banners → remove after redirects.

## 6. Constraints respected

- No IA architecture change  
- No DB / migration changes  
- Existing URLs kept  
- No duplicated publish business logic (reuses import-review / recommendation / business admin actions)
