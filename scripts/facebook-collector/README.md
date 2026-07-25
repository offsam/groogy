# Facebook Groups collector (PoC)

Pull 20–50 posts from **one** Facebook group via Apify, normalize, analyze with the existing Telegram pipeline analyzers, and stage rows in `import_review_items` for **manual** review.

```text
Facebook → Apify dataset → adapter → normalize → analyze → dedupe → import_review_items
```

No cron. No autopublish to `businesses` / `listings`. No multi-group crawl.

## 1. Create an Apify token

1. Sign in at [Apify Console](https://console.apify.com/).
2. Settings → Integrations → API tokens → Create token.
3. Copy the token once (treat it like a password).

## 2. Where to put the token

Add to **local** `.env.local` (gitignored). Never commit real values.

```text
APIFY_TOKEN=
APIFY_ACTOR_ID=
FACEBOOK_GROUP_URL=
FACEBOOK_DATASET_ID=
```

Placeholders are also listed in `.env.example`.

## 3. Choose an Actor

Pick any Facebook **group posts** Actor on Apify Store. Set:

```text
APIFY_ACTOR_ID=username~actor-name
```

or pass `--actor-id` on the CLI.

Edit `config.example.json` → `actor_input_template` so field names match that Actor (`startUrls` vs `groupUrls`, limit keys, etc.). The core pipeline never imports Actor-specific fields — only the adapter does.

## 4. Facebook group URL

```text
FACEBOOK_GROUP_URL=https://www.facebook.com/groups/YOUR_GROUP_ID/
```

or `--group-url "…"`.

Public groups: cookies often optional. Closed groups: account must be a member; cookies via Apify secrets / `FACEBOOK_COOKIES_JSON` only.

## 5. Dataset ID (Mode A)

If you already ran an Actor in the Console:

1. Open the run → Dataset → copy Dataset ID.
2. Set `FACEBOOK_DATASET_ID=` or pass `--dataset-id`.

## 6. Dry-run (default)

Does **not** write to Supabase.

```bash
# Offline plumbing (no Apify token)
python3 scripts/facebook-collector/run_facebook_collector.py --fixture --limit 20

# Existing Apify dataset
python3 scripts/facebook-collector/run_facebook_collector.py \
  --dataset-id "$FACEBOOK_DATASET_ID" \
  --limit 20

# Start Actor for one group
python3 scripts/facebook-collector/run_facebook_collector.py \
  --actor-id "$APIFY_ACTOR_ID" \
  --group-url "$FACEBOOK_GROUP_URL" \
  --limit 20
```

Omit `--apply` ⇒ dry-run. Optional explicit `--dry-run` is fine.

## 7. Apply (review queue only)

```bash
python3 scripts/facebook-collector/run_facebook_collector.py \
  --dataset-id "$FACEBOOK_DATASET_ID" \
  --limit 20 \
  --apply
```

Inserts `review_status=pending` into `import_review_items` with `source=facebook`.  
Re-running the same dataset skips existing `source_fingerprint` (unique constraint).

## 8. Where to see results

- Local JSON: `scripts/facebook-collector/data/poc/` (or `--output PATH`)
- Admin UI: `/admin/import-review` (filter/source facebook when available)
- CLI prints a stats JSON report (counts, media notes, redacted sample)

## 9. Switch Actor without touching the pipeline

1. Change `APIFY_ACTOR_ID` / `--actor-id`.
2. Adjust `actor_input_template` in config.
3. If the dataset schema differs a lot, add `adapters/your_actor.py` and register it in `adapters/__init__.py`.
4. Keep using `generic_apify_group` when field aliases already match.

## 10. Cookies: add / replace / remove

- **Preferred:** Apify Actor secret / input UI (not in this repo).
- **Local only:** `FACEBOOK_COOKIES_JSON='[...]'` in `.env.local` (never commit).
- **Remove:** delete the env var and clear Apify secrets; rotate the Facebook account password if a token leaked.
- Collector code never writes cookies to DB, fixtures, or stdout.

## Modules

| File | Role |
|---|---|
| `fetch_apify_dataset.py` | Dataset fetch + Actor run client |
| `normalize_facebook.py` | URLs, SHA-256 fingerprint, logical post |
| `models.py` | Normalized post / media types |
| `adapters/` | Actor-specific row parsing |
| `map_review.py` | → `import_review_items` columns |
| `validate.py` | PoC stats + media CDN notes |
| `run_facebook_collector.py` | CLI |

## Safety

- No cookies/tokens in git
- Service role only in server scripts (`.env.local`)
- No cron / multi-group / Playwright login in this PoC
- Facebook CDN media URLs are stored as ephemeral references only — not permanent card photos
