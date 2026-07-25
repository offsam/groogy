# Facebook Groups collector (PoC)

Goal: prove one group → review queue path **without** coupling КРУГИ to a specific Apify Actor.

## Pipeline

```text
Apify dataset (or fixture / seed JSON)
→ FacebookActorAdapter (swappable)
→ CanonicalFacebookPost
→ logical post
→ existing analyzer (rule_based | llm)
→ entity dedupe
→ import_review_items (pending, manual review)
```

No cron. No autopublish. Actor format stays behind an adapter.

## What we keep

- post text
- published_at
- source_url / facebook_post_id
- group id/name/url
- attachments (image/video/link URLs)
- contacts extracted from the ad text (via analyzer)

## What we do not store

- author profiles / member lists
- comment threads
- reaction breakdowns (dropped in adapter slim_raw)

## Incremental sync

Owned by КРУГИ via `source_fingerprint` + unique index on `import_review_items`:

`facebook:{group_id}:{facebook_post_id}`

Do **not** rely on any Actor `incrementalMode` flag.

## Run

```bash
# Offline fixture (no Apify, no LLM)
python3 scripts/facebook-collector/run_poc.py --fixture --analyzer rule_based --dry-run

# Historical seed texts (~40 posts from the same FB group)
python3 scripts/facebook-collector/run_poc.py \
  --input scripts/business-seed/data/facebook_entities_posts_1_41.json \
  --adapter seed_entities --limit 50 --analyzer rule_based --dry-run

# Real Apify dataset export (after you pick a stable Actor)
python3 scripts/facebook-collector/run_poc.py \
  --input /path/to/dataset.json \
  --adapter generic_apify_group \
  --analyzer llm --dry-run

# Optional: insert pending rows only (still no public publish)
python3 scripts/facebook-collector/run_poc.py --fixture --analyzer rule_based --apply
```

## Adapters

| Name | When |
|---|---|
| `generic_apify_group` | Common Apify field aliases (`postId`/`postUrl`/`text`/…) |
| `seed_entities` | Local `facebook_entities_*.json` with `original_text` |

Add a new module under `adapters/` for a specific Actor instead of branching core code.

## Next after PoC

1. Run one real public (or cookie-backed closed) group, 50–100 posts.
2. Validate field coverage (id, url, date, text, media).
3. Only then schedule pulls + production wiring.
