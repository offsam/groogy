#!/usr/bin/env python3
"""Guard against cards claiming КРУГИ while they came from somewhere else.

A card may only be attributed to the platform when it has no external
source_url. Anything else means an import path fell back to 'platform' again —
see docs/audits/SOURCE_ATTRIBUTION_AUDIT_V1.md.

Exits 1 when violations are found, so it can run in CI or before a release.

Usage:
  python3 scripts/business-enrich/audit_source_attribution.py
  python3 scripts/business-enrich/audit_source_attribution.py --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from sb_sql import sql  # noqa: E402

CHECKS: list[tuple[str, str, str]] = [
    (
        "businesses_platform_with_url",
        "Бизнесы с source_kind='platform' и внешней ссылкой",
        """
select id::text, name, source_kind, left(source_url, 90) as source_url
from public.businesses
where coalesce(source_kind, '') = 'platform'
  and nullif(btrim(source_url), '') is not null
""",
    ),
    (
        "listings_platform_with_url",
        "Объявления с source_kind='platform' и внешней ссылкой",
        """
select id::text, left(title, 60) as title, source_kind, left(source_url, 90) as source_url
from public.listings
where coalesce(source_kind, '') = 'platform'
  and nullif(btrim(source_url), '') is not null
""",
    ),
    (
        "professionals_platform_with_url",
        "Специалисты с source_type USER/ADMIN и внешней ссылкой",
        """
select id::text, display_name, source_type, left(source_url, 90) as source_url
from public.professionals
where upper(coalesce(source_type, '')) in ('USER', 'ADMIN')
  and nullif(btrim(source_url), '') is not null
""",
    ),
    (
        "jobs_platform_with_url",
        "Вакансии с source_type USER/ADMIN и внешней ссылкой",
        """
select id::text, title, source_type, left(source_url, 90) as source_url
from public.jobs
where upper(coalesce(source_type, '')) in ('USER', 'ADMIN')
  and nullif(btrim(source_url), '') is not null
""",
    ),
    (
        "events_platform_with_url",
        "События с source_channel='platform' и внешней ссылкой",
        """
select id::text, left(title, 60) as title, source_channel, left(source_url, 90) as source_url
from public.events
where coalesce(source_channel, '') = 'platform'
  and nullif(btrim(source_url), '') is not null
""",
    ),
]

DISTRIBUTION = """
select 'businesses' as entity, coalesce(source_kind, '(null)') as kind,
  case when nullif(btrim(source_url), '') is null then 'no_url' else 'has_url' end as url,
  count(*) as n
from public.businesses where status = 'approved' group by 1, 2, 3
union all
select 'listings', coalesce(source_kind, '(null)'),
  case when nullif(btrim(source_url), '') is null then 'no_url' else 'has_url' end,
  count(*)
from public.listings where status = 'active' group by 1, 2, 3
union all
select 'professionals', upper(coalesce(source_type, '(null)')),
  case when nullif(btrim(source_url), '') is null then 'no_url' else 'has_url' end,
  count(*)
from public.professionals where status = 'approved' group by 1, 2, 3
union all
select 'events', coalesce(source_channel, '(null)'),
  case when nullif(btrim(source_url), '') is null then 'no_url' else 'has_url' end,
  count(*)
from public.events group by 1, 2, 3
order by 1, 4 desc;
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    violations: dict[str, list] = {}
    for key, label, query in CHECKS:
        rows = sql(query)
        if rows:
            violations[key] = rows
        if not args.json:
            mark = "FAIL" if rows else "ok  "
            print(f"{mark} {label}: {len(rows)}")
            for row in rows[:5]:
                print(f"       {row}")

    if args.json:
        print(
            json.dumps(
                {"violations": violations, "distribution": sql(DISTRIBUTION)},
                ensure_ascii=False,
                indent=2,
            )
        )
    elif not violations:
        print("\nАтрибуция источников чистая.")

    sys.exit(1 if violations else 0)


if __name__ == "__main__":
    main()
