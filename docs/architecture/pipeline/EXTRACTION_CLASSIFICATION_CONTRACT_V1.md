# EXTRACTION & CLASSIFICATION CONTRACT V1

The executable contract for pipeline stages **P2 EXTRACT** and **P3 CLASSIFY**
(CARD_PROCESSING_ARCHITECTURE_V1): every pattern, format, threshold and stop-list an
agent needs to perform extraction/classification **without reading the code** — and
to verify the code hasn't drifted from this document.

**Drift protection:** CI runs `scripts/import-review/test_extraction_contract.py`,
which imports the live constants from the source modules and asserts each appears in
this file verbatim. If you change a pattern in code, this doc must change in the same
PR — the build fails otherwise. The code remains the runtime source of truth; this
document is its pinned, human-readable mirror.

Procedure documents this contract plugs into:
`NULL_CLASSIFICATION_ALGORITHM_V1.md` (the decision tree),
`ENRICHMENT_RULES_V1.md` (what may be written), `QUALITY_CARD_RULES_V1.md` /
DB gate (what blocks publish).

---

## 1. Field formats on `import_review_items` (write contract)

| Field | Type | Canonical format | Notes |
|---|---|---|---|
| `phone` | text[] | E.164, `+1XXXXXXXXXX` | via `normalize_phone` (§2.2); max 3 per row from extraction |
| `whatsapp` | text[] | E.164 | copied from phone when text mentions WhatsApp |
| `email` | text[] | lowercase | max 3 |
| `website` | text[] | `https://host/path`, no query string, no trailing slash | social/chat hosts are NOT websites (§2.4); junk/platform hosts rejected (§5) |
| `instagram` | text[] | **bare handle**, no `@`, no URL | `[A-Za-z0-9._]{2,30}`; path words `reel/p/stories/explore/accounts` are not handles |
| `telegram_username` | text | bare handle, no `@` | `[A-Za-z0-9_]{4,32}`, not all-digits |
| `price` | numeric | plain number + `currency` (default USD) | ambiguous forms (e.g. `$18.000`) are NOT auto-written |
| `city` | text | title-case place name | county-level fallback goes to region fields, not city |
| `entity_type` + `target_collection` | enums | always set **as a pair** | never one without the other (F4) |
| `review_notes` control tags | text | exact literals from the tag registry (§6) | |

## 2. Extraction patterns (verbatim from `scripts/telegram-collector/contacts.py`)

### 2.1 Phone

```python
PHONE_RE = re.compile(
    r"(?:\+?\d[\d\-\s().]{8,}\d)",
)
```

Before matching, URL spans are masked so UUID/path digits are not read as phones:

```python
URL_SPAN_RE = re.compile(
    r"https?://[^\s<>\"']+|www\.[^\s<>\"']+",
    re.IGNORECASE,
)
```

### 2.2 Phone normalization (E.164)

```python
def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 10:
        return None
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    if digits.startswith("7") and len(digits) == 11:
        return "+" + digits
    if raw.strip().startswith("+"):
        return "+" + digits
    return "+" + digits if len(digits) >= 10 else None
```

### 2.3 Email

```python
EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
)
```

### 2.4 Instagram (three recognizers, in order)

```python
INSTAGRAM_URL_RE = re.compile(
    r"(?:instagram\.com/|instagr\.am/)([A-Za-z0-9._]{2,30})",
    re.IGNORECASE,
)
INSTAGRAM_LABELED_RE = re.compile(
    r"(?:instagram|инста(?:грам)?)\s*[:：]\s*@?([A-Za-z0-9._]{2,30})\b",
    re.IGNORECASE,
)
INSTAGRAM_HANDLE_RE = re.compile(
    r"(?:^|[\s(,])@([A-Za-z0-9._]{3,30})(?=[\s,).!]|$)",
)
```

### 2.5 Website

```python
WEBSITE_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>\"']+",
    re.IGNORECASE,
)
BARE_WEBSITE_RE = re.compile(
    r"(?<![A-Za-z0-9@/])("
    r"(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+"
    r"(?:com|net|org|io|co|app|coach|at|me|link|cc)"
    r"/[^\s<>\"']+"
    r")",
    re.IGNORECASE,
)
```

A URL on `instagram.com`, `facebook.com`, `fb.com`, `t.me`, `telegram.me`, `wa.me`
is never a `website` value — it routes to its own field or is dropped.

### 2.6 Telegram

```python
TELEGRAM_URL_RE = re.compile(
    r"(?:t\.me/|telegram\.me/|tg://resolve\?domain=)([A-Za-z0-9_]{4,32})",
```

### 2.7 Name extraction guards (`scripts/telegram-collector/names.py`)

Greetings and ad-phrases must never become entity names:

```python
GREETING_BLOCKLIST = re.compile(
    r"^\s*(?:"
    r"всем\s+привет|привет|добрый\s+день|доброе\s+утро|добрый\s+вечер|"
    r"здравствуйте|девочки|девушкам|коллеги|hello|hi\b|hey\b|"
    r"предлагаю\s+услуги|ищу\s+клиентов|открыта\s+запись|нужна\s+модель"
    r")\b",
    re.I,
)
```

plus the exact-string set `BANNED_NAME_EXACT` (same file) — short greetings/ad phrases
("всем привет", "добрый день", "предлагаю услуги", …).

## 3. Classification patterns

These are the regexes the decision tree in `NULL_CLASSIFICATION_ALGORITHM_V1.md` §3
refers to by name. Source: `scripts/import-review/entity_routing.py` (lechu/transfer),
`scripts/facebook-collector/facebook_decision_policy.py` (the rest).

```python
LECHU_RE = re.compile(
    r"\bлечу\b|#лечу\b|\bлетим\b|\bлетит\b|\bпопутчик(?:и|ов)?\b|"
    r"возьму\s+(?:посыл|документ|чемодан|вещи)|"
    r"заберу\s+и\s+привезу|"
    r"переда(?:м|ть)\s+(?:посыл|документ|вещи)|"
    r"если\s+нужно\s+передать|"
    r"передать\s+(?:посыл|документ)|"
    r"flying\s+to|take\s+packages?\b",
    re.I,
```

```python
TRANSFER_RE = re.compile(
    r"(?:денежн\w*\s+)?перевод(?:ы|ов)?\s+(?:в|из|на)\s+(?:росси|сша|украин|европ|карт)|"
    r"money\s+transfer|wire\s+transfer|remittance|swift\b|"
    r"крипто\s*(?:в|→|->|to)\s*фиат|фиат\s*(?:в|→|->|to)\s*крипто|"
    r"обмен\s+валют|"
    # «Поменяю свои рубли на ваши доллары» / «меняю доллары»
    r"(?:по)?меняю\s+.{0,48}(?:руб|доллар|\$|usd|eur)|"
    r"куплю\s+руб|продам\s+руб|куплю\s+доллар|продам\s+доллар|"
    r"рубл\w*.{0,28}(?:доллар|usd|\$)|(?:доллар|usd|\$)\w*.{0,28}рубл|"
    r"переведу\s+(?:деньги|доллар|руб)|"
    r"оплачу\s+(?:вашу|ваш[уые]?).{0,40}рубл|"
    r"комисси[яи]\s*\d+\s*%\s*(?:за\s+)?перевод|"
    # Offer to sell/buy crypto — not bare «нужен USDT»
    r"(?:обмен|меняю|продам|куплю)\s+.{0,24}(?:usdt|юсдт|btc|eth)\b",
    re.I,
```

```python
REAL_ESTATE_OFFER_RE = re.compile(
    r"(сда[её]тся|сдаю|сдаем)\s+.{0,40}(комнат|квартир|дом|студи|bedroom|condo|house)|"
    r"(комната|квартира|студия).{0,40}(сда[её]тся|\$\s?\d|/мес)",
    re.I,
```

```python
JOB_HIRE_RE = re.compile(
    r"(требуется|ищем\s+(?:сотрудника|работника|provider|owner-?operator)|"
    r"вакансия|hiring|на\s+чек|приглашает\s+owner)",
    re.I,
```

```python
MARKETPLACE_RE = re.compile(
    r"(прода[юе]м?\s+|for\s+sale|selling)|"
    r"\b(принтер|printer|коляск|high\s+chair|chicco|pixma|гаражн)\b",
    re.I,
```

```python
EVENT_RE = re.compile(
    r"(мероприят|концерт|встреча|пикник|speed\s+dating|singles|"
    r"анонсов|вечеринка|вылазк)",
    re.I,
```

```python
BUSINESS_SIGNAL_RE = re.compile(
    r"\b(inc|llc|corp|company|компани[яи]|студия|салон|агентство|"
    r"insurance|страхован)\b",
    re.I,
```

```python
SPECIALIST_SIGNAL_RE = re.compile(
    r"(барбер|стрижк|психолог|репетитор|преподаватель|мастер|"
    r"консультирован|няня|тренер|фотограф|лицензированн)",
    re.I,
```

Category-text hard routes (Gate 0; from `scripts/import-review/category_map.py`):
`events` → event; and the real-estate set:

```python
    "real_estate": "real_estate",
    "real_estate_services": "real_estate",
    "realtor": "real_estate",
    "mortgage": "real_estate",
    "property_management": "real_estate",
```

## 4. Numeric thresholds (`scripts/import-review/common.py`)

```python
HIGH_CONFIDENCE_MIN = 0.85
COMPLETE_CARD_CONFIDENCE_MIN = 0.5
COMPLETE_CARD_DESCRIPTION_MIN = 60
MARKETPLACE_MAX_AGE_DAYS = 45
RENTAL_MAX_AGE_DAYS = 60
JOB_EVENT_MAX_AGE_DAYS = 30
```

The `*_MAX_AGE_DAYS` values are the staleness windows the Gate-3 disposition rule
(NULL_CLASSIFICATION §5.1) tells you to reuse. Fuzzy-name duplicate threshold:
`0.85` (`find_duplicates.py`, `difflib.SequenceMatcher`).

## 5. Host stop-lists

A recommended third-party site must never donate its own contacts to a card.

`JUNK_HOST_PARTS` (`scripts/business-enrich/enrich_published_businesses.py`) — hosts
that are never a business's own website: etsy.com, turo.com, girlscouts.org,
digitalcookie., maps.apple, maps.app.goo.gl, goo.gl/, instagram.com, facebook.com,
fb.com, t.me/, wa.me/, linktr.ee, eventbrite.com, vagaro.com/upgradepilates/deals,
mercedesbenz, showingnew.com, threadssequins, youtube.com, youtu.be, tiktok.com,
mama-print.ru, alter.tax, dreem-world.ai, openai.com, book.squareup.com,
legalshieldassociate.com, skinovationcleaning.com.

`PLATFORM_HOSTS` (`scripts/business-enrich/run_enrichment_pipeline.py`) — platforms
whose contact pages describe the platform, not the card's business (website-fetch is
skipped entirely): vistaprint.com, wix.com, squarespace.com, godaddy.com, weebly.com,
canva.com, amazon.com, ebay.com, walmart.com, google.com, yelp.com, zillow.com,
craigslist.org, avito.ru, wildberries.ru, ozon.ru.

## 6. Review-notes tag registry

Canonical source: `scripts/import-review/review_tags.py` (TS mirror
`lib/import-review/review-tags.ts`; SQL-gate literals pinned by
`test_review_tags.py`):

| Tag | Written by | Checked by |
|---|---|---|
| `[needs_manual_type]` | classifier (Gate-3 park) | admin triage |
| `[proposed:<type>:medium]` | classifier (MEDIUM proposal) | human reviewer |
| `[human_confirmed]` | admin manually | DB publish gate (specialist `other`) |
| `[event_date_confirmed]` | admin manually | DB publish gate (events) |

## 7. Local data formats

- Directory dumps `scripts/business-enrich/data/yellow_pages/*_latest.json`:
  top-level object with `cards` (list); card keys include `display_name`, `phones[]`,
  `emails[]`, `instagram`, `address`, `city`, `region`, `cover_image_url`,
  `description`, `category_guess`, `entity_type_guess`, `directory_source`.
- Collector batches `scripts/telegram-collector/data/full/batches/*`: merged logical
  posts with `extracted_entity` (entity/category/contacts/evidence) — replayable
  artifacts, never a SoT.

## 8. Rules that override everything above

1. Fill-empty only; never overwrite a non-empty field.
2. Never invent tier-A values (contacts, money, addresses, identity) — extract
   verbatim or leave empty (`ENRICHMENT_RULES_V1` §A).
3. Never default an unclassifiable row to `business`
   (`NULL_CLASSIFICATION_ALGORITHM_V1` §5.3).
4. `entity_type`/`target_collection` are written as a pair or not at all.
5. Ambiguous prices are parked for humans, not normalized by guess.
