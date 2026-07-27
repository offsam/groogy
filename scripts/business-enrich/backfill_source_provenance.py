#!/usr/bin/env python3
"""Backfill businesses/listings source_url + source_kind from import_review_items.

Also:
- move t.me post links out of website / telegram_url into source_url
- strip duplicate «источник: …» footers from descriptions
- mark remaining entities without external source as source_kind=platform
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from sb_sql import sql  # noqa: E402


def run(label: str, query: str):
    print(f"\n=== {label} ===")
    try:
        result = sql(query)
        print(json.dumps(result, ensure_ascii=False, indent=2)[:4000])
        return result
    except Exception as e:
        print(f"ERROR: {e}")
        raise


def main() -> None:
    run(
        "backfill businesses from import_review_items",
        """
with latest as (
  select distinct on (published_entity_id)
    published_entity_id as id,
    nullif(btrim(source_url), '') as source_url,
    lower(split_part(source, ':', 1)) as source_kind
  from public.import_review_items
  where published_entity_type = 'business'
    and published_entity_id is not null
    and nullif(btrim(source_url), '') is not null
  order by published_entity_id,
    approved_at desc nulls last,
    published_at desc nulls last,
    created_at desc
)
update public.businesses b
set
  source_url = l.source_url,
  source_kind = case
    when l.source_kind in ('telegram', 'facebook') then l.source_kind
    else 'telegram'
  end,
  updated_at = now()
from latest l
where b.id = l.id
  and (
    b.source_url is distinct from l.source_url
    or b.source_kind is distinct from case
      when l.source_kind in ('telegram', 'facebook') then l.source_kind
      else 'telegram'
    end
  )
returning b.id
""",
    )

    run(
        "backfill listings from import_review_items",
        """
with latest as (
  select distinct on (published_entity_id)
    published_entity_id as id,
    nullif(btrim(source_url), '') as source_url,
    lower(split_part(source, ':', 1)) as source_kind
  from public.import_review_items
  where published_entity_type = 'listing'
    and published_entity_id is not null
    and nullif(btrim(source_url), '') is not null
  order by published_entity_id,
    approved_at desc nulls last,
    published_at desc nulls last,
    created_at desc
)
update public.listings l
set
  source_url = s.source_url,
  source_kind = case
    when s.source_kind in ('telegram', 'facebook') then s.source_kind
    else 'telegram'
  end,
  updated_at = now()
from latest s
where l.id = s.id
  and (
    l.source_url is distinct from s.source_url
    or l.source_kind is distinct from case
      when s.source_kind in ('telegram', 'facebook') then s.source_kind
      else 'telegram'
    end
  )
returning l.id
""",
    )

    run(
        "move t.me website posts into source_url",
        """
update public.businesses
set
  source_url = coalesce(nullif(btrim(source_url), ''), nullif(btrim(website), '')),
  source_kind = coalesce(nullif(btrim(source_kind), ''), 'telegram'),
  website = null,
  updated_at = now()
where website is not null
  and website ~* '(^|://)(t\\.me|telegram\\.me)/'
  and (
    source_url is null
    or btrim(source_url) = ''
    or lower(btrim(source_url)) = lower(btrim(website))
  )
returning id, source_url
""",
    )

    run(
        "move telegram_url posts (t.me/c/) into source_url",
        """
update public.businesses
set
  source_url = coalesce(nullif(btrim(source_url), ''), nullif(btrim(telegram_url), '')),
  source_kind = coalesce(nullif(btrim(source_kind), ''), 'telegram'),
  telegram_url = null,
  updated_at = now()
where telegram_url is not null
  and telegram_url ~* 't\\.me/c/'
returning id, source_url
""",
    )

    run(
        "strip источник footer from business descriptions",
        """
update public.businesses
set
  description = regexp_replace(
    description,
    E'(?m)^\\\\s*источник:\\\\s*\\\\S+\\\\s*$',
    '',
    'gi'
  ),
  updated_at = now()
where description ~* 'источник:\\s*https?://'
returning id
""",
    )

    run(
        "strip источник footer from listing descriptions",
        """
update public.listings
set
  description = regexp_replace(
    description,
    E'(?m)^\\\\s*источник:\\\\s*\\\\S+\\\\s*$',
    '',
    'gi'
  ),
  updated_at = now()
where description ~* 'источник:\\s*https?://'
returning id
""",
    )

    run(
        "mark platform businesses without external source",
        """
update public.businesses b
set
  source_kind = 'platform',
  source_url = null,
  updated_at = now()
where (b.source_url is null or btrim(b.source_url) = '')
  and coalesce(b.source_kind, '') is distinct from 'platform'
  and not exists (
    select 1
    from public.import_review_items i
    where i.published_entity_type = 'business'
      and i.published_entity_id = b.id
      and nullif(btrim(i.source_url), '') is not null
  )
returning b.id
""",
    )

    run(
        "mark platform listings without external source",
        """
update public.listings l
set
  source_kind = 'platform',
  source_url = null,
  updated_at = now()
where (l.source_url is null or btrim(l.source_url) = '')
  and coalesce(l.source_kind, '') is distinct from 'platform'
  and not exists (
    select 1
    from public.import_review_items i
    where i.published_entity_type = 'listing'
      and i.published_entity_id = l.id
      and nullif(btrim(i.source_url), '') is not null
  )
returning l.id
""",
    )

    run(
        "report",
        """
select
  (select count(*) from businesses) as businesses_total,
  (select count(*) from businesses where source_kind = 'telegram' and nullif(btrim(source_url),'') is not null) as biz_tg_source,
  (select count(*) from businesses where source_kind = 'facebook' and nullif(btrim(source_url),'') is not null) as biz_fb_source,
  (select count(*) from businesses where source_kind = 'platform') as biz_platform,
  (select count(*) from businesses where website ~* 't\\.me/|telegram\\.me/') as biz_website_still_tme,
  (select count(*) from businesses where telegram_url ~* 't\\.me/c/') as biz_tg_url_still_post,
  (select count(*) from listings) as listings_total,
  (select count(*) from listings where source_kind = 'telegram' and nullif(btrim(source_url),'') is not null) as list_tg_source,
  (select count(*) from listings where source_kind = 'facebook' and nullif(btrim(source_url),'') is not null) as list_fb_source,
  (select count(*) from listings where source_kind = 'platform') as list_platform
""",
    )


if __name__ == "__main__":
    main()
