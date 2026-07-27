# DB TYPES RITUAL V1

`types/database.ts` is **hand-maintained** (custom exported type names are imported
across the app), so it silently drifts from the live schema (roadmap P-21,
STABILIZATION §7.4). Full regeneration would break imports — the ritual is a
**parity check**, not a replacement.

## The ritual — run after EVERY migration that touches tables/RPCs

1. Generate fresh types to a scratch file (never over `types/database.ts`):
   - Supabase MCP: `generate_typescript_types` → save output to scratch, or
   - CLI: `npx supabase gen types typescript --project-id zmsbosigfmnmyavuhlyb > /tmp/db-types-generated.ts`
2. Diff *content*, not text: for every table/RPC your migration touched, confirm the
   generated file and `types/database.ts` agree on:
   - new/changed **columns** (name, nullability, type);
   - new **RPCs** (`Functions` section — args + return type);
   - new **enum values**.
3. Port only the missing pieces into `types/database.ts`, keeping the existing custom
   type names and style (see how `import_review_publish_gate_check` was added next to
   its sibling RPCs).
4. `npx tsc --noEmit` must stay clean.

## Why not automate the replacement

The hand file exports domain aliases (`ImportReviewStatus`, …) that generated output
does not produce; swapping files breaks every import. Automating a *drift report*
(generated vs hand, missing-members only) is a good future S-task; until then this
ritual is the contract. The migration PR is not complete without step 2–4 when the
migration changed schema surface used by TS.
