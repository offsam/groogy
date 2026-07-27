# NAVIGATION_RULES.md

Rules for maintaining the AI Navigation Layer (`docs/navigation/`).

These rules apply to humans and AI agents. They govern **navigation docs only**.

---

## Core principles

1. **Navigation never invents architecture.** It only points to existing docs and code.
2. **Navigation never replaces Source of Truth.** Entry-points are pointers, not specs.
3. **If no Source of Truth exists, say so** (`Unknown` / stop) — do not invent one.
4. **Prefer links over prose.** Keep pages scannable.
5. **Distinguish design freeze vs live runtime** when both exist.

---

## Required updates

| Change in the project | Required navigation update |
|---|---|
| New major subsystem | Add to [`PROJECT_INDEX.md`](./PROJECT_INDEX.md) + relevant domain INDEX + entry-point if runtime |
| New architectural document | Link from `PROJECT_INDEX.md` and/or domain INDEX; declare SoT if it is one |
| New runtime subsystem | Add row to [`runtime/INDEX.md`](./runtime/INDEX.md) + entry-point doc with SoT |
| New entity type (documented) | Update [`entities/INDEX.md`](./entities/INDEX.md) |
| New API route group | Update [`api/INDEX.md`](./api/INDEX.md) |
| New admin area | Update [`admin/INDEX.md`](./admin/INDEX.md) |
| New collector / AI pipeline | Update [`ai/INDEX.md`](./ai/INDEX.md) |
| Deprecated implementation | Mark under **Deprecated paths** on the entry-point; keep link to replacement |
| Removed / moved doc | Fix or remove navigation links in the same change |
| Architectural contradiction resolved | Update freeze/lifecycle links only as those docs change — nav stays pointers |

---

## Source of Truth rules

1. Every runtime entry-point **must** declare a Source of Truth section.
2. Prefer:
   - Live behavior → [`PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md)
   - Design intent → [`ARCHITECTURE_FREEZE_V1.md`](../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md) or the freeze’s canonical entity doc
3. Historical / proposal docs must be labeled (example: `docs/database-schema.md`).
4. Audits are **supporting facts**, not product law, unless freeze says otherwise.

---

## Link hygiene

1. Every markdown link in `docs/navigation/` must resolve to an existing path.
2. Do not use wildcard paths as href targets; link the directory or a concrete file.
3. After editing navigation, re-check orphans under `docs/**/*.md` (exclude `docs/navigation/` itself from orphan “content” lists, but keep nav pages linked from `PROJECT_INDEX` / `AI_AGENT_START_HERE`).
4. Important project docs under `docs/architecture/`, `docs/audits/`, and collector `README.md` files must be reachable from [`PROJECT_INDEX.md`](./PROJECT_INDEX.md).

---

## What navigation must not do

- Modify application code, SQL, RPC, API, or migrations as part of a “navigation” task
- Rewrite architecture documents in place of linking them
- Duplicate long explanations from SoT docs
- Rename or move code/files to make links prettier
- Create fake ADRs or fake SoT documents

---

## Validation checklist (before merge)

- [ ] `AI_AGENT_START_HERE.md` still first entry
- [ ] `PROJECT_INDEX.md` lists the subsystem
- [ ] Entry-point has Purpose + Source of Truth + Primary code location
- [ ] Links resolve
- [ ] Deprecated paths marked if applicable
- [ ] Coverage report refreshed when adding/removing major subsystems ([`NAVIGATION_COVERAGE_REPORT.md`](./NAVIGATION_COVERAGE_REPORT.md))
- [ ] Dependency edges updated if relationships change ([`DEPENDENCY_MAP.md`](./DEPENDENCY_MAP.md))
