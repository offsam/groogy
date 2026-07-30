#!/usr/bin/env python3
"""Canonical P3 entity section router — single source of truth.

Absorbs (does not rewrite) existing classifiers:
  - scripts/telegram-collector/reviewer.py  (LECHU / TRANSFER / infer_*)
  - scripts/facebook-collector/facebook_decision_policy.py  (MARKETPLACE / JOB / EVENT / signals)
  - scripts/import-review/classify_null_queue.py  (NULL backlog tree)
  - docs/audits/NULL_CLASSIFICATION_ALGORITHM_V1.md §3

Returns an atomic (entity_type, target_collection) pair, or None +
[needs_manual_type] when no rule fires. Never defaults to private_specialist
or business.

TS mirror: lib/import-review/entity-routing.ts — keep both in sync.
SoT: docs/architecture/pipeline/ENTITY_SECTION_ROUTING_V1.md
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from review_tags import TAG_NEEDS_MANUAL_TYPE  # noqa: E402

# ---------------------------------------------------------------------------
# Canonical pair map (ENTITY_TYPE_MAPPING_V1 + import enum)
# ---------------------------------------------------------------------------

ENTITY_TO_COLLECTION: dict[str, str] = {
    "business": "businesses",
    "organization": "organizations",
    "private_specialist": "private_specialists",
    "marketplace_listing": "marketplace",
    "job": "jobs",
    "real_estate": "real_estate",
    "event": "events",
    "lechu_listing": "lechu",
    "transfer_listing": "transfers",
}

COLLECTION_TO_ENTITY: dict[str, str] = {
    "businesses": "business",
    "organizations": "organization",
    "services": "business",  # transitional — stay as business
    "private_specialists": "private_specialist",
    "marketplace": "marketplace_listing",
    "jobs": "job",
    "real_estate": "real_estate",
    "events": "event",
    "lechu": "lechu_listing",
    "transfers": "transfer_listing",
}

VALID_PAIRS: set[tuple[str, str]] = {
    ("business", "businesses"),
    ("business", "services"),
    ("business", "organizations"),
    ("organization", "organizations"),
    ("organization", "businesses"),
    ("private_specialist", "private_specialists"),
    ("marketplace_listing", "marketplace"),
    ("job", "jobs"),
    ("real_estate", "real_estate"),
    ("event", "events"),
    ("lechu_listing", "lechu"),
    ("transfer_listing", "transfers"),
}

REAL_ESTATE_CATEGORIES = {
    "real_estate_services",
    "realtor",
    "mortgage",
    "property_management",
}

# ---------------------------------------------------------------------------
# Regexes — absorbed from reviewer + facebook_decision_policy
# ---------------------------------------------------------------------------

LECHU_RE = re.compile(
    r"(?:^|\n|#)\s*лечу\b|#лечу\b|летим\b|летит\b|"
    r"возьму\s+(?:посыл|документ|чемодан|вещи)|"
    r"заберу\s+и\s+привезу|"
    r"передам\s+(?:посыл|документ)|"
    r"flying\s+to|take\s+packages?\b",
    re.I,
)
TRANSFER_RE = re.compile(
    r"(?:денежн\w*\s+)?перевод(?:ы|ов)?\s+(?:в|из|на)\s+(?:росси|сша|украин|европ|карт)|"
    r"money\s+transfer|wire\s+transfer|remittance|swift\b|"
    r"крипто\s*(?:в|→|->|to)\s*фиат|фиат\s*(?:в|→|->|to)\s*крипто|"
    r"обмен\s+валют|меняю\s+(?:руб|доллар|\$)|"
    r"куплю\s+руб|продам\s+руб|куплю\s+доллар|продам\s+доллар|"
    r"рубл\w*\s+на\s+(?:карт|доллар)|доллар\w*\s+на\s+руб|"
    r"переведу\s+(?:деньги|доллар|руб)|"
    r"оплачу\s+(?:вашу|ваш[уые]?).{0,40}рубл|"
    r"комисси[яи]\s*\d+\s*%\s*(?:за\s+)?перевод",
    re.I,
)
TRANSLATOR_NOISE_RE = re.compile(
    r"переводчик|certified\s+translation|апостил|document\s+preparation|"
    r"преподаватель|язык(?:а|ов)?\b",
    re.I,
)

JOB_HIRE_RE = re.compile(
    r"(требуется|ищем\s+(?:сотрудника|работника|provider|owner-?operator)|"
    r"вакансия|hiring|на\s+чек|приглашает\s+owner)",
    re.I,
)

REAL_ESTATE_OFFER_RE = re.compile(
    r"(сда[её]тся|сдаю|сдаем)\s+.{0,40}(комнат|квартир|дом|студи|bedroom|condo|house)|"
    r"(комната|квартира|студия).{0,40}(сда[её]тся|\$\s?\d|/мес)",
    re.I,
)

EVENT_RE = re.compile(
    r"(мероприят|концерт|встреча|пикник|speed\s+dating|singles|"
    r"анонсов|вечеринка|вылазк)",
    re.I,
)

BUSINESS_SIGNAL_RE = re.compile(
    r"\b(inc|llc|corp|company|компани[яи]|студия|салон|агентство|"
    r"insurance|страхован)\b",
    re.I,
)

SPECIALIST_SIGNAL_RE = re.compile(
    r"(барбер|стрижк|психолог|репетитор|преподаватель|мастер|"
    r"консультирован|няня|тренер|фотограф|лицензированн)",
    re.I,
)

# Copy only an operating company writes: pickup points, tariff tables, courier
# services, cargo / logistics wording. Strong enough to outrank a person-name
# slot, which importers fill with the poster's own name.
COMPANY_OPERATIONS_RE = re.compile(
    r"\b(?:карго|cargo|freight)\b|грузоперевоз|логистическ|logistics|"
    r"пункт\w*\s+(?:приёма|приема|выдачи|самовывоза)|"
    r"тариф\w*\s+и\s+сроки|курьерск\w*\s+служб|"
    r"отправляем\s+(?:в|по)\s|доставка\s+из\s+сша|доставляем\s+(?:по|в)\s",
    re.I,
)

# Legacy narrow personal-goods pattern (kept for hard reject of garage sales).
PERSONAL_GOODS_RE = re.compile(
    r"\b(прода[юе]м\s+(?:личн|свою|детск)|отда[мю]\s+даром|garage\s+sale)\w*",
    re.I,
)

# Commercial goods sale — the gap that put "пиявки" into professionals.
GOODS_SALE_VERB_RE = re.compile(
    r"\b(прода[юёе]т?|продам|продаём|продаем|for\s+sale|selling)\b",
    re.I,
)
GOODS_PRODUCT_RE = re.compile(
    r"(?:пияв|принтер|коляск|мебел|телефон\s+прода|"
    r"high\s+chair|chicco|pixma|гаражн)",
    re.I,
)
GOODS_FULFILLMENT_RE = re.compile(
    r"(?:доставк|отправ(?:лю|ка|им)|по\s+сша|shipping|самовывоз|"
    r"цена\s+за\s+(?:штук|ед|упаков)|в\s+наличии|\$\s*\d+|usd\s*\d+)",
    re.I,
)
SERVICE_VERB_RE = re.compile(
    r"(?:записыва|принимаю\s+(?:на|к)|сеанс|консультац|массаж|"
    r"маникюр|педикюр|стрижк|окрашив|работаю\s+(?:как|по)|"
    r"услуги|предоставляю|провожу)",
    re.I,
)


@dataclass(frozen=True)
class RouteResult:
    entity_type: str | None
    target_collection: str | None
    confidence: str  # high | medium | none
    reason: str
    needs_manual_type: bool = False

    @property
    def ok(self) -> bool:
        return (
            self.entity_type is not None
            and self.target_collection is not None
            and not self.needs_manual_type
        )


def pair_for_type(entity_type: str) -> tuple[str, str] | None:
    collection = ENTITY_TO_COLLECTION.get(entity_type)
    if not collection:
        return None
    return entity_type, collection


def is_valid_pair(entity_type: str | None, target_collection: str | None) -> bool:
    if not entity_type or not target_collection:
        return False
    return (entity_type, target_collection) in VALID_PAIRS


def detect_lechu_or_transfer(text: str) -> str | None:
    blob = text or ""
    if LECHU_RE.search(blob):
        return "lechu_listing"
    if TRANSFER_RE.search(blob) and not TRANSLATOR_NOISE_RE.search(blob):
        return "transfer_listing"
    return None


def detect_goods_sale(text: str) -> bool:
    """Commercial physical-goods sale (not a service appointment)."""
    blob = text or ""
    if PERSONAL_GOODS_RE.search(blob):
        return True
    product = bool(GOODS_PRODUCT_RE.search(blob))
    fulfill = bool(GOODS_FULFILLMENT_RE.search(blob))
    sale_verb = bool(GOODS_SALE_VERB_RE.search(blob))
    service = bool(SERVICE_VERB_RE.search(blob))
    specialist = bool(SPECIALIST_SIGNAL_RE.search(blob))

    # Product + shipping/stock (e.g. «пиявочки + отправка по США»).
    if product and fulfill and not service:
        return True
    if sale_verb and (product or fulfill) and not service:
        return True
    if sale_verb and not service and not specialist:
        return True
    return False


def _manual(reason: str) -> RouteResult:
    return RouteResult(
        entity_type=None,
        target_collection=None,
        confidence="none",
        reason=reason,
        needs_manual_type=True,
    )


def _hit(entity_type: str, confidence: str, reason: str) -> RouteResult:
    pair = pair_for_type(entity_type)
    if not pair:
        return _manual(f"unknown_type:{entity_type}")
    return RouteResult(
        entity_type=pair[0],
        target_collection=pair[1],
        confidence=confidence,
        reason=reason,
        needs_manual_type=False,
    )


def route_card(
    *,
    text: str = "",
    category: str | None = None,
    business_name: str | None = None,
    person_name: str | None = None,
    classification: str | None = None,
    entity_type_hint: str | None = None,
    has_contact: bool = False,
) -> RouteResult:
    """Canonical P3 router. Atomic pair or needs_manual_type. No specialist fallback."""
    cat = (category or "").strip()
    bn = (business_name or "").strip()
    pn = (person_name or "").strip()
    blob = text or ""
    classification = (classification or "").strip() or None
    hint = (entity_type_hint or "").strip() or None

    # Gate 0 — explicit category / hard RE
    if cat == "events":
        return _hit("event", "high", "gate0:category=events")
    if cat in REAL_ESTATE_CATEGORIES:
        return _hit("real_estate", "high", f"gate0:category={cat}")
    if REAL_ESTATE_OFFER_RE.search(blob):
        return _hit("real_estate", "high", "gate0:real_estate_offer_re")

    # Gate 1 — route-shaped listings
    travel = detect_lechu_or_transfer(blob)
    if travel == "lechu_listing":
        return _hit("lechu_listing", "high", "gate1:lechu_re")
    if travel == "transfer_listing":
        return _hit("transfer_listing", "high", "gate1:transfer_re")
    if JOB_HIRE_RE.search(blob):
        return _hit("job", "medium", "gate1:job_hire_re")
    if detect_goods_sale(blob):
        return _hit("marketplace_listing", "medium", "gate1:goods_sale")
    if PERSONAL_GOODS_RE.search(blob) and not bn:
        return _hit("marketplace_listing", "medium", "gate1:personal_goods_re")

    # Gate 1b — upstream LLM / analyzer classification (trusted when present)
    if classification == "marketplace_item" or hint == "marketplace_listing":
        return _hit("marketplace_listing", "high", "gate1b:classification=marketplace")
    if classification == "real_estate_listing" or hint == "real_estate":
        return _hit("real_estate", "high", "gate1b:classification=real_estate")
    if classification == "job_post" or hint == "job":
        return _hit("job", "high", "gate1b:classification=job")
    if classification == "event_ad" or hint == "event":
        return _hit("event", "high", "gate1b:classification=event")
    if classification == "direct_business_ad" or hint == "business":
        return _hit("business", "high", "gate1b:classification=business")
    if classification in {"direct_specialist_ad", "self_promotion_without_contact"} or hint == "private_specialist":
        # Still block goods mis-routed as specialist ads.
        if detect_goods_sale(blob):
            return _hit("marketplace_listing", "medium", "gate1b:override_specialist_goods")
        return _hit("private_specialist", "high", "gate1b:classification=specialist")
    if hint == "organization":
        return _hit("organization", "high", "gate1b:hint=organization")
    if hint in ENTITY_TO_COLLECTION:
        return _hit(hint, "medium", f"gate1b:hint={hint}")

    # Gate 1c — event keyword with offer/contact signal
    if EVENT_RE.search(blob) and (
        has_contact or re.search(r"(присоединя|записыва|билет|\$)", blob, re.I)
    ):
        return _hit("event", "medium", "gate1c:event_re")

    # Gate 2 — business vs private_specialist
    # Company operations beat the name slots: the poster's name in `person_name`
    # must not turn a delivery service into a private specialist.
    if COMPANY_OPERATIONS_RE.search(blob) and not SPECIALIST_SIGNAL_RE.search(blob):
        conf = "high" if (has_contact or bn) else "medium"
        return _hit("business", conf, "gate2:company_operations_re")
    if bn and not pn:
        conf = "high" if has_contact else "medium"
        return _hit("business", conf, "gate2:business_name_slot")
    if pn and not bn:
        conf = "high" if has_contact else "medium"
        return _hit("private_specialist", conf, "gate2:person_name_slot")
    if BUSINESS_SIGNAL_RE.search(blob) and not SPECIALIST_SIGNAL_RE.search(blob):
        conf = "high" if has_contact else "medium"
        return _hit("business", conf, "gate2:business_signal_re")
    if SPECIALIST_SIGNAL_RE.search(blob) and not BUSINESS_SIGNAL_RE.search(blob):
        conf = "high" if has_contact else "medium"
        return _hit("private_specialist", conf, "gate2:specialist_signal_re")

    # Gate 3 — nothing fired → park for human, never invent a type
    return _manual("gate3:no_signal")


def route_from_row(row: dict[str, Any]) -> RouteResult:
    """Route an import_review_items-shaped dict."""
    has_contact = bool(
        (row.get("phone") or [])
        or (row.get("whatsapp") or [])
        or (row.get("website") or [])
        or (row.get("instagram") or [])
        or (row.get("telegram_username") or "")
        or (row.get("telegram_user_id") or "")
        or (row.get("email") or [])
    )
    text = (
        row.get("source_text")
        or row.get("description")
        or row.get("title")
        or ""
    )
    return route_card(
        text=str(text),
        category=row.get("category"),
        business_name=row.get("business_name"),
        person_name=row.get("person_name"),
        classification=row.get("ai_decision") or row.get("classification"),
        entity_type_hint=row.get("entity_type"),
        has_contact=has_contact,
    )


def route_from_post(post: dict[str, Any], entity: dict[str, Any] | None = None) -> RouteResult:
    """Route a collector post + extracted entity (reviewer.py shape)."""
    entity = entity or post.get("extracted_entity") or {}
    text = post.get("merged_text") or entity.get("description") or post.get("text") or ""
    contacts = any(
        [
            entity.get("phone"),
            entity.get("whatsapp"),
            entity.get("website"),
            entity.get("instagram"),
            entity.get("telegram_username"),
            entity.get("email"),
        ]
    )
    return route_card(
        text=str(text),
        category=entity.get("category") or post.get("category"),
        business_name=entity.get("business_name"),
        person_name=entity.get("person_name"),
        classification=post.get("classification"),
        entity_type_hint=entity.get("entity_type") or post.get("entity_type"),
        has_contact=contacts,
    )


def infer_entity_type(post: dict[str, Any], entity: dict[str, Any]) -> str | None:
    """Drop-in for reviewer.infer_entity_type — returns None instead of specialist fallback."""
    return route_from_post(post, entity).entity_type


def infer_target_collection(
    entity_type: str | None,
    category: str | None = None,
    classification: str | None = None,
) -> str | None:
    """Drop-in for reviewer.infer_target_collection — no 'services' fallback."""
    if entity_type and entity_type in ENTITY_TO_COLLECTION:
        return ENTITY_TO_COLLECTION[entity_type]
    if classification == "real_estate_listing":
        return "real_estate"
    if classification == "job_post":
        return "jobs"
    if classification == "event_ad":
        return "events"
    if classification == "marketplace_item":
        return "marketplace"
    if category == "events":
        return "events"
    return None


def tag_needs_manual(notes: str | None) -> str:
    base = (notes or "").strip()
    if TAG_NEEDS_MANUAL_TYPE in base:
        return base
    return f"{base} {TAG_NEEDS_MANUAL_TYPE}".strip() if base else TAG_NEEDS_MANUAL_TYPE
