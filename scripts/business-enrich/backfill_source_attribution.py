#!/usr/bin/env python3
"""Repair provenance on cards that claim КРУГИ while carrying an external link.

Directory imports were published with source_kind='platform' on top of a real
svoi.us / yellow-pages URL, so the profile showed «Источник: КРУГИ» and hid the
link. This reclassifies those rows from the URL, mirroring resolve_source_kind
(scripts/import-review/source_kind.py) and resolveSourceKind in
lib/business/presence.ts.

Rows with no source_url are left alone — those are genuinely ours.

Usage:
  python3 scripts/business-enrich/backfill_source_attribution.py --dry-run
  python3 scripts/business-enrich/backfill_source_attribution.py --apply
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from sb_sql import sql  # noqa: E402

OUT_DIR = ROOT / "docs" / "audits" / "data"

# Kept identical to the TS / Python classifiers. Anything external that does not
# match stays NULL: unknown but not ours, and the UI labels it by hostname.
CLASSIFY = """
    case
      when source_url ~* 'facebook\\.com|fb\\.com' then 'facebook'
      when source_url ~* 't\\.me/|telegram\\.me' then 'telegram'
      when source_url ~* 'svoi\\.us|orange.?pages|yellow.?pages|to4ka|echoru|zerkalo'
        then 'directory'
      else null
    end
"""

# Events keep provenance in source_channel; businesses / listings in source_kind.
KIND_COLUMN = {
    "businesses": "source_kind",
    "listings": "source_kind",
    "events": "source_channel",
}


def misattributed(table: str) -> str:
    col = KIND_COLUMN[table]
    return (
        f"coalesce({col}, '') = 'platform' "
        "and nullif(btrim(source_url), '') is not null"
    )


def preview(table: str) -> dict:
    rows = sql(
        f"""
select {CLASSIFY} as new_kind, count(*) as n
from public.{table}
where {misattributed(table)}
group by 1 order by n desc;
"""
    )
    samples = sql(
        f"""
select id::text, {CLASSIFY} as new_kind, left(source_url, 90) as source_url
from public.{table}
where {misattributed(table)}
limit 5;
"""
    )
    return {
        "table": table,
        "total": sum(int(r["n"]) for r in rows),
        "by_new_kind": {str(r["new_kind"]): int(r["n"]) for r in rows},
        "samples": samples,
    }


def distribution(table: str) -> list[dict]:
    col = KIND_COLUMN[table]
    return sql(
        f"""
select coalesce({col}, '(null)') as kind,
  case when nullif(btrim(source_url), '') is null then 'no_url' else 'has_url' end as url,
  count(*) as n
from public.{table}
group by 1, 2 order by n desc;
"""
    )


def apply_fix(table: str) -> int:
    col = KIND_COLUMN[table]
    rows = sql(
        f"""
update public.{table}
set {col} = {CLASSIFY}, updated_at = now()
where {misattributed(table)}
returning id;
"""
    )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply = args.apply and not args.dry_run

    tables = ["businesses", "listings", "events"]
    report: dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry_run",
        "before": {t: distribution(t) for t in tables},
        "planned": {t: preview(t) for t in tables},
    }

    for t in tables:
        p = report["planned"][t]
        print(f"{t}: {p['total']} misattributed → {p['by_new_kind']}")

    if apply:
        report["updated"] = {t: apply_fix(t) for t in tables}
        report["after"] = {t: distribution(t) for t in tables}
        for t in tables:
            print(f"{t}: updated {report['updated'][t]}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    kind = "apply" if apply else "dry"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in (f"source_attribution_{kind}_{stamp}.json", f"source_attribution_{kind}_latest.json"):
        (OUT_DIR / name).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(f"report → docs/audits/data/source_attribution_{kind}_latest.json")


if __name__ == "__main__":
    main()
