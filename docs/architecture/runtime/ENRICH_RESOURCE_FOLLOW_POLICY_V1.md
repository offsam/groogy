# Enrich resource follow policy V1

**Normative.** Rules for which URLs the published-entity enrich BFS may
enqueue after mining a page. Implementation SoT:
[`scripts/business-enrich/enrich_follow_policy.py`](../../../scripts/business-enrich/enrich_follow_policy.py).
Drift tests: `scripts/business-enrich/test_enrich_follow_policy.py` (CI).

Companion: paste-enrich name fill-empty on live cards —
`lib/admin/paste-enrich-contract.test.ts`.

---

## 1. Hard rules

1. **Own website never chases related_websites.**  
   When `kind == "website"` and the page is **not** a booking-SaaS host,
   outbound HTML links (`related_websites`) must **not** enter the BFS queue.
   Following them is what flooded enrich with WordPress XFN / IndieWeb chrome
   (`gmpg.org/xfn/11`, `tantek.com`, `photomatt.net`, Creative Commons, GitHub…).

2. **Social profile pages never chase related_websites.**  
   `instagram` / `facebook` / `tiktok` / `yelp` → related list is always empty.
   Bio `website` may still enqueue (explicit identity link).

3. **related_websites only from discovery surfaces.**  
   Allowed page kinds: `source`, directory hosts, booking-platform hosts
   (including `kind=website` on GlossGenius / Dikidi / Booksy tenant pages).
   Purpose: find *this* card’s marketing site (e.g. Framer from GlossGenius).

 4. **CMS / IndieWeb chrome is never identity.**  
   `CMS_CHROME_HOST_PARTS` (examples: `gmpg.org`, `creativecommons.org`,
   `wordpress.org`, `github.com`, `indieweb.org`, `gravatar.com`, `wp.com`,
   `webmention.io`, …) + chrome paths (`/xfn`, `/license`, webmention,
   indieauth, feeds) → `is_cms_chrome_url` / `is_junk_url` → never enqueue,
   never adopt as `website`.

5. **Fill-empty only** for every field written from a mined resource
   (existing enrich convention).

---

## 2. Paste-enrich name (live cards)

Admin «Вставить текст» on **business** and **professional** must run
`parsePasteEnrichTextWithName` (same as import queue). Name is fill-empty:
written only when the card name / `display_name` is empty. Google Maps paste
must yield the first headline as company name (contract test).

## 2b. Person title → brand from copy (published enrich)

Telegram/FB often publish under the **sender's name** while the ad text names
the store (`📍 European Delights`, «вже в European Delights»). After resource
crawl, `finalizePublishedEnrich` must replace a person-like title with the
inferred brand when the brand appears in the card copy.

- TS SoT: `lib/import-review/display-name.ts` + `lib/admin/published-finalize-enrich.ts`
- Python mirror (audit/cleanup): `scripts/business-enrich/audit_fix_entity_names.py`
- Contracts: `display-name-contract.test.ts`, `test_person_brand_name.py`

## 2c. Google rating from Maps paste

«Вставить текст» extracts `4.7` + `(100)` / `100 Reviews` into
`google_rating` / `google_reviews_count` (businesses, fill-empty).

Other businesses often got ratings from **Google Places** CLI
(`enrich_places_fill_empty.py`) or admin presence RPC — not from paste.
Paste is the path when the admin copies a Maps card.

---

## 3. Professional category spheres

Public / admin professional category pickers use only
`PROFESSIONAL_CATEGORY_SLUGS` — never business leaves like `restaurants`.
Food sphere slug `home_food` display name is **«Готовим»**.

---

## 4. Where lists live

| Concern | Module |
|---|---|
| Follow gate + CMS chrome | `enrich_follow_policy.py` |
| BFS queue + mine | `enrich_resource_queue.py` |
| HTML related extract | `web_enrichment.py` (`_related_external_websites`) |
| Paste name | `lib/admin/paste-enrich-name.ts` + `paste-enrich-actions.ts` |
| Pro category allowlist | `lib/professional/categories.ts` + `getProfessionalCategories` |
