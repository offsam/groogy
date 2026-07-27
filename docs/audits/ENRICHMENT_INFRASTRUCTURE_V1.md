# ENRICHMENT INFRASTRUCTURE V1

**Date:** 2026-07-27
**Scope:** audit every script in `scripts/business-enrich/`, fix the website scraper's hours/address/phone extraction, add `completeness_score` storage + scoring functions, add a cross-layer `find_duplicates()` search. Infrastructure only — nothing was run against the live catalog at scale, no entity was published or merged.
**What was actually executed against the live DB:** one additive schema migration (`completeness_score` columns, see §3) and read-only `SELECT`s for testing. All enrichment/scraper/dedup runs in this doc were `--dry-run` or read-only CLI probes against a handful of real rows, explicitly to prove the fixes work — never `--apply`.

Companions: [ENRICHMENT_AUDIT_V1.md](./ENRICHMENT_AUDIT_V1.md), [ENRICHMENT_RULES_V1.md](./ENRICHMENT_RULES_V1.md)

---

## 1. Audit of every script in `scripts/business-enrich/`

Legend for **Runnable?**: all scripts here load Supabase credentials via `common.load_env()` → `.env.local` (present, has the needed keys) unless noted. "stdlib only" means no external Python package or API key is required beyond that.

### Website/social/rating enrichment (businesses)

| Script | Purpose | Runnable? | DB writes | CLI |
|---|---|---|---|---|
| `enrich_published_businesses.py` | Orchestrator: website (JSON-LD+text)/Instagram/Nominatim geocode/Yelp search/price-line scrape for approved businesses. **Fixed this session — see §2.** | Yes, stdlib only | `businesses` (fill-empty), `business_offers` (insert if none exist) | `--dry-run` / `--apply`, `--limit`, `--slug` |
| `google_places.py` + `enrich_places_fill_empty.py` | Google Places (New) Text Search + Details → address/geo/rating/hours/phone/website for approved businesses. Well-built: name/phone/website scoring, franchise-ambiguity detection, quota-exceeded early stop. | Yes — `GOOGLE_MAPS_API_KEY` **is** set in `.env.local`. Gated by real API cost/quota, not a missing key — see §2.3. | `businesses` (fill-empty) | `--dry-run` / `--apply`, `--limit`, `--slug`, `--sleep` |
| `fill_yelp_ratings.py` | JSON-LD `AggregateRating` scrape from stored `yelp_url`. | Yes | `businesses.yelp_rating`/`yelp_reviews_count` (fill-empty; Yelp often serves DataDome challenges — documented failure mode in the file itself) | `--dry-run`(default)/`--apply`, `--limit`, `--sleep`, `--slug` |
| `scrape_booking_urls.py` | Crawls each business's own site for a booking-platform link. | Yes | `businesses.booking_url` — **not fill-empty**, overwrites when the found URL differs from stored | `--dry-run`/`--apply`(default dry-run), `--limit` |
| `geocode_all_addresses.py` | Nominatim geocode for any approved business/professional with a street address but null lat/lng. | Yes, public Nominatim, no key | `businesses`/`professionals` lat/lng/location_precision (fill-empty) | `--apply` (no explicit dry-run flag; omitting it is the report-only mode) |
| `fill_missing_addresses.py` | Address backfill: description text → website → Yelp/FB/IG/Telegram → Google Places → **Gemini Vision OCR on `image_url`** (flyer addresses). | Yes — `GOOGLE_MAPS_API_KEY` and `GOOGLE_API_KEY` (Gemini) both set | `businesses.address_line/city/region/state_code` (+lat/lng with `--geocode`) — fill-empty | `--apply`, `--geocode`, `--skip-places`, `--skip-ocr`, `--skip-social`, `--limit` |
| `backfill_city_zip.py` | Postal code / city cleanup from address text or geocode reverse-lookup. | Yes | `businesses.postal_code`/`city` (writes only when computed ≠ stored) | `--apply`, `--dry-run`(default), `--geocode` |
| `backfill_business_locations.py` | **One-off hardcoded seed** for a single franchise's 6 office addresses. Not general-purpose despite the filename. | Yes, but scoped to `slug=batch2-5-star-appliance-repair` only | `business_locations` + parent `businesses` row | `--dry-run`, `--apply` |
| `backfill_source_provenance.py` | Backfill `source_url`/`source_kind`, strip stray `t.me` links out of `website`. | **Different auth path** — uses `scripts/sb_sql.py` (Management API + macOS Keychain), not the REST client. **No CLI flags/dry-run gate — running it applies every UPDATE immediately.** | `businesses`/`listings` (direct overwrite) | none — always applies |
| `enrich_from_card_copy.py`, `enrich_from_import_sources.py` | Mine a business's own description/short_description or its original `import_review_items` payload for contact/location fields. | Yes | `businesses` (fill-empty) | `--apply`/`--dry-run`, `--limit`, `--offset` |
| `enrich_from_telegram_source.py` | Re-fetch original Telegram post + **Gemini vision OCR** on the flyer photo. | Needs `telethon` (system `python3` doesn't have it — use `scripts/telegram-collector/.venv/bin/python`) + a pre-authorized TG session | `businesses` (fill-empty) + storage image upload | `--dry-run`/`--apply`, `--limit`, `--offset` |
| `migrate_contacts_from_copy.py` | Extract contacts from free text, then redact that text out of the visible description. | Yes | `businesses` contacts (fill-empty); `description`/`short_description` **actively rewritten** (redacted) | `--apply`, `--status` |
| `russian_card_blurbs.py` | Ensure Russian-language `short_description`; defers non-Cyrillic cards. No LLM call — pure regex/keyword template. | Yes, stdlib only | `businesses.short_description` (**overwrite**), `status='deferred'` for non-Russian cards | `--apply`, `--dry-run`(default) |
| `catalog_cleanup.py` | Triage approved businesses into keep/professional/event/junk; geocode; convert/archive. | Yes | `businesses` (status/geo), `professionals`/`events` (insert) | `--triage`, `--geocode`, `--convert-professionals`, `--convert-events`, `--archive-junk`, `--dry-run`/`--apply`, `--limit` |
| `fix_source_hub_locations.py` | Corrects businesses geocoded outside their source Facebook-group metro. | Yes | `businesses` location fields — active overwrite | `--apply`/`--dry-run` |
| `restore_place_businesses.py` | Restore archived "real place" businesses to approved, merging contacts from linked professional dupes. | Yes | `businesses.status`→approved + fill-empty; `professionals.status`→archived | `--dry-run`(default)/`--apply`, `--geocode` |
| `move_home_services_to_professionals.py` | Reclassify home/mobile/unaddressed "businesses" into `professionals`. | Yes | `professionals` insert, `businesses.status`→archived | `--dry-run`(default)/`--apply`, `--limit`, `--slug` |
| `move_pros_to_lechu_transfers.py` | Move a hardcoded list of misclassified professionals into lechu/transfer listings. | Dry-run: yes. `--apply` shells out to `npx supabase db query --linked` — needs a linked Supabase CLI project | `listings` insert (via SQL), `professionals.status`→archived | `--apply`/`--dry-run` |
| `move_empty_to_pending.mjs` (Node) | Moves approved businesses with empty/junk copy back to `pending`. | Yes — Node + `@supabase/supabase-js` | `businesses.status`→pending | `--apply` (default dry-run) |

### Directory scrapers (external Yellow-Pages-style sites → local JSON, no DB writes)

| Script | Source | Runnable? | Writes |
|---|---|---|---|
| `scrape_svoi_us.py`, `scrape_echoru.py`, `scrape_to4ka.py`, `scrape_zerkalo_mn.py`, `scrape_ruspagesusa.py`, `scrape_our_texas.py`, `scrape_boston_russian_pages.py`, `scrape_russian_america_seattle.py`, `scrape_slavic_seattle.py` | svoi.us, EchoRU, to4ka.us, Zerkalo MN, ruspagesusa.com, Our Texas, Boston Russian Pages, russianseattle.com, slavicseattle.com | Yes, stdlib only | Local JSON only (`data/yellow_pages/*.json`) — **no DB writes** |
| `scrape_russian_orange_pages.py` | russianorangepages.com | Needs Playwright (present in `scripts/telegram-collector/.venv`; site has WAF blocking plain HTTP) | Local JSON only |
| `import_yellow_pages_cards.py` | Loads any of the above JSON into the review queue | Yes | `import_comment_recommendations` only (upsert), **not** `businesses`/`professionals` directly |
| `enrich_svoi_directory.py` | End-to-end enrich+publish for `svoi`/`orange_pages` pending cards — the **only** script in this group that can reach `businesses`/`professionals` and populate hours/geo from these sources | Yes, degrades gracefully without Google Places key | `import_comment_recommendations` (fill-empty) + with `--publish`: `businesses`/`professionals` insert or fill-empty merge |
| `run_svoi_enrich_all.sh` | Batch-loops `enrich_svoi_directory.py --directory-source svoi` until queue empty | Yes | Only ever drives the `svoi` source, per the script — `orange_pages` and the other 8 directories have no equivalent batch runner |

**Root cause confirmed for this group:** the 8 non-svoi/orange_pages directory scrapers only ever land in `import_comment_recommendations` — none of the scraped cards have an hours/geo field at all, and nothing in this file set carries them onward to `businesses`/`professionals`. This is a missing pipeline stage, not a bug in any one script.

### Professional enrichment / backfill

| Script | Purpose | Runnable? | Writes |
|---|---|---|---|
| `enrich_professional_avatars.py` | Fill `image_url` from Telegram author/profile photo. | `--dry-run`: yes. `--apply` needs the telegram-collector venv (telethon). | `professionals.image_url` (fill-empty) |
| `enrich_professional_locations.py` | Fill city/postal/address/state from card text + matched import rows. | Yes, stdlib | `professionals` location fields (fill-empty; never touches lat/lng) |
| `enrich_professionals_card_first.py` | Card text → own website → source_url (svoi/orange_pages/import) priority chain. | Yes | `professionals` (contacts fill-empty; **can overwrite** junk website/bogus city) |
| `enrich_professionals_from_orange_pages.py`, `enrich_professionals_from_svoi.py` | Directory-specific gap-fill from the linked source page. | Yes | `professionals` (mostly fill-empty; explicitly overwrites junk `website`/bogus `city="Orange"`; svoi variant overwrites thin descriptions) |
| `enrich_professionals_from_sources.py` | Fill from matched `import_review_items`/recommendation clusters + Telegram photo re-download + website/IG OG images. | Degrades gracefully without telethon | `professionals` (fill-empty, except CDN image rehosting) |
| `rebuild_professional_locations_from_groups.py` | Rebuild city/region from post text + source group fallback; **explicitly nulls lat/lng** when there's no street address ("no map pin without street"). | Yes | `professionals` location fields — overwrite when wrong |
| `backfill_professional_categories.py` | Regex/keyword `category_id` classifier. | Yes | `professionals.category_id` (fill-empty unless `--force`) |
| `backfill_community_mentions.py` | Link "recommended in comments" mentions to matching businesses. | Yes | `business_community_mentions` insert-if-not-exists |
| `summarize_professional_cards.py` | LLM `card_summary` (OpenRouter, `gpt-4.1-nano`→`gemini-2.5-flash-lite`→`nova-micro`), falls back to heuristic if key missing. | Yes, `OPENROUTER_API_KEY` present | `professionals.card_summary` (fill-empty unless `--force`) |

### Admin / audit / dedup

| Script | Purpose | Writes |
|---|---|---|
| `audit_fix_entity_names.py` | Rename weak/generic business names from description/website-inferred brand. | `businesses.name`/`slug` (directed rename by confidence tier) |
| `audit_professional_origin_counts.py` | Compute "recommended by others" vs "self-ad" mention counts. | `professionals.third_party_mention_count`/`self_ad_mention_count` (overwrite) |
| `classify_recommendation_buckets.py` | Classify `import_comment_recommendations.target_bucket`. | Only overwrites currently-`unclassified` rows unless `--force` |
| `find_business_duplicates.py` | **Detection-only**, exact-key matching (phone/street/website/Instagram). No fuzzy matching. | Writes a JSON report only — never touches the DB |
| `merge_approved_duplicates.py` | Merges a hardcoded `CONFIRMED_MERGES` list of business pairs. | `businesses` fill-empty patch + re-parent child rows + archive dropped row |
| `merge_professional_duplicates.py` | **Auto-clusters + merges** professional duplicates via union-find over exact phone/email/Instagram/name+city keys. No fuzzy matching either. | `professionals` patch (contacts fill-empty; description/headline/display_name **actively overwritten** with "best" pick), siblings archived |
| `migrate_contacts_from_copy.py`, `publish_recommendation_catalog.py` | See tables above / recommendation-queue publish. | See above |

**Full detail on both existing dedupe scripts' exact matching logic** (phone/email/Instagram normalization, `norm_name`, the "distinctive name" gate) is preserved in the background-agent transcript this audit was built from — the short version: **both are exact-key matching after normalization, neither has any fuzzy/edit-distance layer.** That gap is what `find_duplicates.py` (§4) adds.

---

## 2. Why `opening_hours` and `latitude`/`longitude` stay at 3.4% — root cause, not a guess

Traced by reading `web_enrichment.py` (the shared HTML-parsing module used by `enrich_published_businesses.py` and the facebook-collector pipeline) end to end, plus `google_places.py`/`enrich_places_fill_empty.py` in full.

### 2.1 — The free path (website scraping) had a real, fixable bug

`extract_website_profile()` in `scripts/facebook-collector/web_enrichment.py` extracted hours **only** from JSON-LD `openingHours`/`openingHoursSpecification` or a meta tag whose key happens to contain `"hour"`. A regex named `HOURS_HINT_RE`, clearly meant to catch hours mentioned in visible page text, **existed in the file but was never actually called anywhere** — confirmed by grepping its own module for usages before this session's edit. Since most small-business sites (Squarespace/Wix/plain HTML) render hours as plain text in a footer, not structured markup, this is directly why hours stayed empty even on sites that plainly show their hours to a human visitor.

Same root cause for `address`: JSON-LD-only, no fallback to a visible `<address>` tag or a plain street-address pattern in body text.

Compounding this: `extract_website_profile()` only ever fetched **one page** (whatever URL was passed in, typically the homepage) — hours/address are frequently on a dedicated `/contact` or `/hours` page instead.

Also found: the phone regex fallback was capped to `html[:8000]` (the first 8000 characters of raw HTML) — for a typical page that's still `<head>`/nav, so a footer phone number never got scanned.

### 2.2 — What was fixed (this session)

In `scripts/facebook-collector/web_enrichment.py`:
- `extract_hours_text(html)` — scans visible text for a labeled "Hours" section, or any line(s) pairing a day name with a time range, anywhere on the page. Actually uses `HOURS_HINT_RE` now.
- `_merge_day_time_lines()` — many sites render hours as a grid ("Mon" / "9:00 am – 5:00 pm" as separate `<div>`s); tag-stripping turns each into its own line, so day and time never landed in the same chunk for the parser. This recombines adjacent day-only + time-only lines before handing off to the existing structured parser.
- `extract_address_text(html, address_tag_text)` — new `<address>` tag capture in the HTML parser, plus a plain-text US street-address regex fallback (`ADDRESS_LINE_RE`). **Fixed one real bug while writing this**: the street-suffix alternation was initially `Dr|Drive` (etc.) — regex alternation matches the first alternative that fits, not the longest, so it matched `"Dr"` and stopped mid-word inside `"Drive"`. Reordered every abbreviation pair (Street before St, Avenue before Ave, ...) so the long form is tried first.
- Phone regex fallback now scans the full cleaned visible text instead of the first 8000 raw-HTML characters.
- `extract_website_profile_deep(url, max_pages=4)` — new multi-page orchestrator: tries the homepage, then `/contact`, `/contact-us`, `/hours`, `/about`, `/location`, etc. (`CONTACT_PATHS`), merging via the existing `merge_website_profiles()`, stopping early once hours+address+phone are all found.

In `scripts/business-enrich/enrich_published_businesses.py`: swapped the single-page `extract_website_profile()` call for `extract_website_profile_deep()` — a one-line wiring change that immediately benefits the existing pipeline.

New standalone dry-run CLI: `scripts/business-enrich/scrape_business_site.py --url <url>` — takes a raw URL, **no Supabase credentials or DB access of any kind**, prints extracted phone/address/hours (raw + structured-parsed via the existing `parse_hours_to_weekly`/`parse_address_parts` normalizers, reused rather than duplicated). Cannot write to the DB even in principle — it never imports `SupabaseRest`.

### 2.3 — The paid path (Google Places) is gated by cost/quota, not a missing key

Verified live (boolean check only, no secret values read or printed): `GOOGLE_MAPS_API_KEY` **is** set in `.env.local`. `google_places.py`/`enrich_places_fill_empty.py` are well-built (name/phone/website candidate scoring, franchise-ambiguity detection, `opening_hours` from Places Details) and would fill real hours/geo data. `enrich_places_fill_empty.py` explicitly **stops the whole batch** the moment it sees a `429`/quota-exceeded response, prints a hint to raise the quota or retry tomorrow, and defaults `--limit` to unbounded (all approved businesses) unless capped. This strongly suggests the reason live `opening_hours`/geo fill is only 3.4% is that this script has only ever been run in small batches or hit its daily quota — running it at full catalog scale (~2,000 businesses × up to 2 API calls each) is a real-money decision, which is exactly why this task didn't run it.

---

## 3. `completeness_score` — migration + scoring functions

**Applied to the live DB this session** (additive, nullable-safe, zero data risk):

```sql
-- supabase/migrations/20260727200000_completeness_score.sql
alter table public.businesses add column if not exists completeness_score integer not null default 0;
alter table public.professionals add column if not exists completeness_score integer not null default 0;
```

Verified live: both columns exist, default `0`, non-null.

**Scoring logic:** `scripts/business-enrich/completeness_score.py` — `calculate_completeness_score(entity_type, row)` dispatches to `calculate_business_completeness_score()` / `calculate_professional_completeness_score()`, each returning `{score, breakdown, max_possible}`.

Weights implemented exactly as specified for this task. Two things worth flagging rather than silently fixing:

1. **The Business weight table sums to 98, not the stated 100** (name 5 + category_id 5 + city 3 + postal_code 2 + address_line 5 + geo 3 + opening_hours 8 + description 8 + image_url 5 + phone 5 + website 5 + instagram_url 3 + telegram_url 2 + facebook_url 2 + whatsapp 2 + email 2 + booking_url 3 + google_rating 5 + google_reviews_count_gt_10 3 + yelp_rating 3 + offers≥3 5 + offers_with_price≥1 5 + promotions 3 + jobs 2 + source_url 2 + short_description 2 = 98). Reported as-is; not rescaled to force a 100 max.
2. **`facebook_url` and `whatsapp` are not columns on `businesses` today** — confirmed live via `information_schema.columns` (39 columns, neither present). Per the spec's own "если поле есть" (if the field exists) qualifier, these score `0` until/unless those columns are added — today's practically-reachable max is **96**, not 98.
3. **"Promotions"** has no dedicated table in this schema — scored via a proxy (`business_offers.is_featured = true`, count ≥ 1), documented in code as an assumption, not a verified product mapping.
4. **"Вакансии/jobs"** scored via `jobs` table rows where `business_id` matches, count ≥ 1 — this one has a clean, direct mapping (the `jobs.business_id` FK already exists).
5. **"Description (не заглушка)"** uses a heuristic (≥40 chars, ≥6 words, not in a small placeholder-string set) — this is a starting point, not a solved problem; there's no canonical "is this a stub" definition anywhere else in the codebase to defer to.

Professional weights (display_name 8 + category_not_other 10 + city 8 + postal_code 3 + any_contact 15 + phone 5 + website 5 + instagram 4 + telegram 4 + email 3 + headline 5 + description 8 + card_summary 5 + image_url 8 + opening_hours 5 + service_area_text 4) **do** sum to exactly 100 — no discrepancy there.

**Dry-run tested against real rows** (`--dry-run`, no `--apply`, confirmed no writes):

```
$ python3 scripts/business-enrich/completeness_score.py --dry-run --entity business --limit 3
- batch2-us-vacation: 33/98
- fbpack-treasure-rack-san-diego: 26/98
- fbpack-translatorpro: 38/98

$ python3 scripts/business-enrich/completeness_score.py --dry-run --entity professional --limit 3
- fb-post-4-katrin-svt-nail-services: 28/100
- consolidated-olga-osipova-fitness: 64/100
- batch2-sbshealth-los-angeles-step-by-step-la: 64/100
```

**Not done (would be the next step, not part of "prepare"):** a backfill run (`--apply`) to populate `completeness_score` across the existing catalog. That's a real write to ~2,800 + ~1,000 rows and was intentionally left for a separate, explicit run.

---

## 4. `find_duplicates()` — cross-layer search, read-only

`scripts/business-enrich/find_duplicates.py`. Searches three layers — `import_review_items`, `businesses`, `professionals` — for four signal types: normalized phone (last-10-digit exact match), Instagram handle (exact), website domain (exact host, junk hosts excluded), and **fuzzy name+city** (new — see below). Returns a flat list of `{layer, id, match_type, confidence, matched_value, candidate_name}`, most-confident first. **Never merges or writes anything.**

Reused rather than reinvented: `norm_phone`/`website_host`/`instagram_handle` follow the same approach as the existing `find_business_duplicates.py`; `norm_name` follows `merge_professional_duplicates.py`'s normalization. Confirmed by reading both scripts in full: **neither has any fuzzy/edit-distance matching today** — both are exact-key matching after normalization. The name+city fuzzy layer here (stdlib `difflib.SequenceMatcher`, threshold 0.85 default, matching this task's requested 85%) is new capability, not a port of existing code.

**Dry-run tested against real data** (read-only, no `--apply` flag exists on this script — it never writes):

```
$ python3 scripts/business-enrich/find_duplicates.py --business-id b833d0fe-afe9-4c00-ab39-ca112b18c971
```
Entity: `surprise_me.balloons` (Instagram `@surprise_me.balloons`, website `surprisemeballoonbar.com`). Found 2 real matches:
- `import_review_items` row `d8be43c7-...` — same Instagram handle, confidence 0.95
- `professionals` row `8cc0559d-...` (`"Surprise Me Balloon Bar"`) — same Instagram handle, confidence 0.95

Neither was planted for the test — both are genuine signal in the live catalog (this business may be double-listed as both a `business` and a `professional`, and has an open queue item that's likely the same entity). A third, already-known duplicate business row for the same domain (`surprise-meballoons-150639`) was correctly **not** returned because it's already `status=archived` — the fetch filters exclude archived rows by design, matching the existing scripts' convention.

Fuzzy layer unit-verified in isolation:
```
norm_name("Ocean Nails Spa") vs norm_name("Ocean Nail Spa")  -> ratio 0.966  (above 0.85 threshold — matches)
norm_name("Ocean Nails Spa") vs norm_name("Salon Beauty LA") -> ratio 0.333  (below threshold — correctly no match)
```

---

## 5. How to run each new/changed piece

All read-only or `--dry-run` by default — nothing here writes unless you explicitly pass `--apply`.

```bash
# Probe a single business website for hours/address/phone — no DB access at all
python3 scripts/business-enrich/scrape_business_site.py --url https://example.com

# Full enrichment pipeline (website+Instagram+geocode+Yelp+offers), now with the
# multi-page hours/address fix — dry-run shows the patch it WOULD write
python3 scripts/business-enrich/enrich_published_businesses.py --dry-run --limit 5
python3 scripts/business-enrich/enrich_published_businesses.py --dry-run --slug <slug>

# Completeness score — dry-run prints scores, --apply writes completeness_score
python3 scripts/business-enrich/completeness_score.py --dry-run --entity business --limit 20
python3 scripts/business-enrich/completeness_score.py --dry-run --entity professional --limit 20
python3 scripts/business-enrich/completeness_score.py --apply --entity business   # writes — not run this session

# Duplicate search — always read-only, no --apply flag exists
python3 scripts/business-enrich/find_duplicates.py --business-id <uuid>
python3 scripts/business-enrich/find_duplicates.py --professional-id <uuid>
python3 scripts/business-enrich/find_duplicates.py --import-review-id <uuid>
python3 scripts/business-enrich/find_duplicates.py --phone "+1 949 555 1212" --name "Ocean Nails" --city "Irvine"
```

For every pre-existing script in §1, the `--dry-run`/`--apply` flags shown in that table are what to use — none of them were changed except `enrich_published_businesses.py` (deep-fetch wiring) and the underlying `web_enrichment.py` module it shares with the facebook-collector pipeline (which also benefits from the hours/address fix, since it imports the same `extract_website_profile()`).

---

## 6. What's ready to run vs. what's still needed

**Ready to run today (infrastructure complete, not yet executed at scale):**
- The fixed website scraper (`enrich_published_businesses.py` + `scrape_business_site.py`) — proven against 5 real live business sites this session (2 genuine new fills: a phone and a full structured weekly-hours patch for a business that had neither).
- `completeness_score` columns + scoring functions — proven against real rows; a backfill run (`--apply`, no `--limit`) would populate the whole catalog in one pass.
- `find_duplicates()` — proven against real rows; could be wired into the admin import-review UI or run as a batch report over the whole NULL-entity-type backlog from `DATA_CLEANUP_PLAN_V1.md`.

**Still needed (not done — decisions or scope beyond "prepare"):**
1. **A cost/quota decision on `enrich_places_fill_empty.py`** — this is the one existing script that can fill `opening_hours`+geo at real scale via Google Places, but running it against ~2,000 businesses is a paid-API-budget decision, not an infrastructure gap.
2. **A backfill batch run** for `completeness_score` (`--apply`, all rows) and for the fixed scraper (`enrich_published_businesses.py --apply`, all approved businesses with a website) — both intentionally left un-run per this task's "prepare, don't run enrichment" constraint.
3. **Some hours formats still won't parse** even with the fix — e.g. `ezgotravel.com`'s "Mon - Fri : 10:30-5" (no leading zero, no AM/PM, colon before the range) was found as raw text but the existing `parse_hours_to_weekly()` normalizer didn't structure it. The extraction fix widens what gets *found*; the structured-parsing normalizer itself has known format gaps that weren't in scope to rebuild here.
4. **Per-field provenance columns** — `ENRICHMENT_RULES_V1.md` already flagged this as missing; still missing. `completeness_score` and the fixed scraper both produce a `sources`/breakdown dict in memory, but nothing persists "which source filled this field" at the DB level yet.
5. **The other 8 directory scrapers** (echoru, to4ka, zerkalo_mn, ruspagesusa, our_texas, boston_pages, russian_america_seattle, slavic_seattle) have no publish-to-`businesses` path at all today, let alone an hours/geo path — only `svoi`/`orange_pages` do, via `enrich_svoi_directory.py`. Building that out is a bigger scope item than this task.
6. **`find_duplicates()` and `completeness_score` are standalone today** — neither is wired into the admin UI, the import-review approval gate, or a scheduled job. That wiring is a product decision (where in the flow should a duplicate warning or a low-completeness flag actually surface?), left open per the "prepare, don't publish/decide" scope of this task.
