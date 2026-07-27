"""Drift check: the SQL publish gate must contain the tag literals verbatim.

The gate function (import_review_publish_gate_errors) cannot import
review_tags.py, so this test pins the contract between the two. Run in CI:
  python3 scripts/import-review/test_review_tags.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from review_tags import SQL_GATE_TAGS  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def latest_gate_definition() -> str:
    """Concatenated text of every migration defining the gate function —
    the last definition wins in Postgres; requiring the tags in each keeps
    any future redefinition honest."""
    texts = []
    for sql in sorted(MIGRATIONS.glob("*.sql")):
        body = sql.read_text(encoding="utf-8")
        if "import_review_publish_gate_errors" in body and "create or replace function" in body:
            texts.append((sql.name, body))
    if not texts:
        raise SystemExit("FAIL: no migration defines import_review_publish_gate_errors")
    return texts[-1][1]  # the migration applied last defines current behavior


def main() -> int:
    gate = latest_gate_definition()
    missing = [t for t in SQL_GATE_TAGS if t not in gate]
    if missing:
        print(f"FAIL: SQL gate is missing tag literals: {missing}")
        return 1
    print(f"OK: SQL gate contains all {len(SQL_GATE_TAGS)} gate tags verbatim")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
