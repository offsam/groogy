"""Facebook-only decision policy.

Runs AFTER the shared analyzer / schema policy. Never imported by Telegram
collector paths. May raise rejected → needs_review and set routing fields,
but never autopublishes (no accepted upgrades from this module).
"""

from __future__ import annotations

import re
from typing import Any

OFFER_SIGNAL_RE = re.compile(
    r"(предлагаю|предоставляю|запись|записывайтесь|цена|прайс|\$\s?\d|"
    r"сда[юеё]м?|прода[юеё]м?|курс|урок|аренда|стрижк|доставк|"
    r"консультац|лицензированн|мой\s+онлайн-?курс|стоимость)",
    re.I,
)

REQUEST_REJECT_RE = re.compile(
    r"(посоветуйте|порекомендуйте|кто\s+может|кто\s+знает|"
    r"ищу\s+(?:хорошего\s+)?(?:мастера|сантехника|хэндимэна|паркет|"
    r"человека|специалиста)|может\s+кто\s+то\s+может\s+помочь\s+найти)",
    re.I,
)

JOB_SEEK_RE = re.compile(
    r"(ищу\s+работу|looking\s+for\s+(?:a\s+)?(?:job|position)|resume|резюме|"
    r"готов\s+много\s+работать\s+и\s+обучаться)",
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

REAL_ESTATE_SEEK_RE = re.compile(
    r"(ищу|ищем)\s+.{0,30}(квартир|комнат|студи|1бд|bedroom)",
    re.I,
)

MARKETPLACE_RE = re.compile(
    r"(прода[юе]м?\s+|for\s+sale|selling)|"
    r"\b(принтер|printer|коляск|high\s+chair|chicco|pixma|гаражн)\b",
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


def _text(post: dict[str, Any]) -> str:
    return (post.get("merged_text") or post.get("text") or "").strip()


def _entity(post: dict[str, Any]) -> dict[str, Any]:
    ent = post.get("extracted_entity")
    return ent if isinstance(ent, dict) else {}


def _contacts(entity: dict[str, Any]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for key in ("phone", "instagram", "website", "telegram", "whatsapp", "email"):
        vals = entity.get(key) or []
        if isinstance(vals, str):
            vals = [vals] if vals.strip() else []
        out[key] = [str(v).strip() for v in vals if str(v).strip()]
    return out


def has_direct_contact(entity: dict[str, Any]) -> bool:
    c = _contacts(entity)
    return bool(
        c["phone"] or c["instagram"] or c["website"] or c["telegram"] or c["whatsapp"]
    )


def has_offer_signal(text: str) -> bool:
    return bool(OFFER_SIGNAL_RE.search(text or ""))


def is_self_offer(post: dict[str, Any], text: str) -> bool:
    rel = (post.get("advertiser_relationship") or "").lower()
    classification = (post.get("classification") or "").lower()
    if rel in {"self", "authorized_business_post"}:
        return True
    if classification in {
        "direct_business_ad",
        "direct_specialist_ad",
        "self_promotion_without_contact",
        "event_ad",
    }:
        return True
    # Heuristic for rule_based/LLM that missed relationship
    if has_offer_signal(text) and not REQUEST_REJECT_RE.search(text):
        if re.search(
            r"(меня\s+зовут|я\s+[—\-–]?\s*(?:барбер|психолог|мастер)|"
            r"предлагаю|предоставляю|работаю|записывайтесь|мой\s+курс)",
            text,
            re.I,
        ):
            return True
    return False


def _set_route(
    post: dict[str, Any],
    *,
    entity_type: str | None,
    target_collection: str | None,
    classification: str | None = None,
) -> None:
    entity = _entity(post)
    if entity_type:
        entity["entity_type"] = entity_type
        entity["target_collection"] = target_collection
    post["extracted_entity"] = entity
    if classification:
        post["classification"] = classification


def _promote_needs_review(post: dict[str, Any], reason: str) -> None:
    """Never upgrade to accepted here — review queue only."""
    old = post.get("decision")
    post["decision"] = "needs_review"
    warnings = list(post.get("warnings") or [])
    warnings.append(f"facebook_policy:{reason}")
    if old and old != "needs_review":
        warnings.append(f"facebook_policy_from:{old}")
    post["warnings"] = warnings
    post["decision_reason"] = (
        f"Facebook policy → needs_review ({reason}). "
        f"Prior: {post.get('decision_reason') or old}"
    )
    post["facebook_policy_applied"] = True
    post["facebook_policy_lifted"] = old == "rejected"


def apply_facebook_decision_policy(post: dict[str, Any]) -> dict[str, Any]:
    """Mutate analyzed logical post. No-op unless source == facebook."""
    if (post.get("source") or "").lower() != "facebook":
        return post

    text = _text(post)
    entity = _entity(post)
    contacts_ok = has_direct_contact(entity)
    offer = has_offer_signal(text) or is_self_offer(post, text)
    post.setdefault("facebook_policy_applied", False)
    post.setdefault("facebook_policy_lifted", False)

    # --- Hard rejects / demand (keep rejected) ---
    if REQUEST_REJECT_RE.search(text) and not (
        (is_self_offer(post, text) or has_offer_signal(text))
        and contacts_ok
        and re.search(r"(предлагаю|сдаю|продаю|стрижк|курс|консультац)", text, re.I)
    ):
        post["decision"] = "rejected"
        post["classification"] = post.get("classification") or "recommendation_request"
        post["decision_reason"] = "Facebook policy: recommendation/demand request."
        _set_route(post, entity_type=None, target_collection=None)
        post["facebook_policy_applied"] = True
        return post

    if JOB_SEEK_RE.search(text) and not JOB_HIRE_RE.search(text):
        post["decision"] = "rejected"
        post["classification"] = "job_post"
        post["decision_reason"] = "Facebook policy: job seeker (not an offer)."
        _set_route(post, entity_type=None, target_collection=None)
        post["facebook_policy_applied"] = True
        return post

    if REAL_ESTATE_SEEK_RE.search(text) and not REAL_ESTATE_OFFER_RE.search(text):
        post["decision"] = "rejected"
        post["classification"] = "real_estate_listing"
        post["decision_reason"] = "Facebook policy: housing seeker (demand)."
        _set_route(post, entity_type=None, target_collection=None)
        post["facebook_policy_applied"] = True
        return post

    # Demand for movers / helpers paying someone — not a catalog offer
    if re.search(r"ищу\s+человека\s+кто\s+поможет|ищу\s+помощи\s+с\s+переезд", text, re.I):
        post["decision"] = "rejected"
        post["decision_reason"] = "Facebook policy: service demand, not an offer."
        post["facebook_policy_applied"] = True
        return post

    # --- Routing + possible lift ---
    if REAL_ESTATE_OFFER_RE.search(text):
        _set_route(
            post,
            entity_type="real_estate",
            target_collection="real_estate",
            classification="real_estate_listing",
        )
        if post.get("decision") == "rejected" or post.get("decision") != "needs_review":
            _promote_needs_review(post, "real_estate_offer")
        else:
            post["facebook_policy_applied"] = True
        return post

    if JOB_HIRE_RE.search(text):
        _set_route(
            post,
            entity_type="job",
            target_collection="jobs",
            classification="job_post",
        )
        # Jobs go to review queue, never business catalog auto-path
        if post.get("decision") == "rejected":
            _promote_needs_review(post, "job_hire_not_business")
        else:
            post["decision"] = "needs_review"
            post["facebook_policy_applied"] = True
        return post

    if MARKETPLACE_RE.search(text) and not SPECIALIST_SIGNAL_RE.search(text):
        # Physical goods / furniture / electronics
        if re.search(
            r"(прода|for\s+sale|printer|принтер|коляск|high\s+chair|chicco|pixma|"
            r"мебел|телефон\s+прода)",
            text,
            re.I,
        ) or (
            re.search(r"\b(estimated|wxdxh|frame\s+chair|inkjet)\b", text, re.I)
        ):
            _set_route(
                post,
                entity_type="marketplace_listing",
                target_collection="marketplace",
                classification="marketplace_item",
            )
            if post.get("decision") == "rejected":
                _promote_needs_review(post, "marketplace_item")
            else:
                post["decision"] = "needs_review"
                post["facebook_policy_applied"] = True
            return post

    if EVENT_RE.search(text) and (
        offer or contacts_ok or re.search(r"(присоединя|записыва|билет|\$)", text, re.I)
    ):
        _set_route(
            post,
            entity_type="event",
            target_collection="events",
            classification="event_ad",
        )
        if post.get("decision") == "rejected":
            _promote_needs_review(post, "event_ad")
        else:
            post["decision"] = "needs_review"
            post["facebook_policy_applied"] = True
        return post

    # Specialist / business offers with contact → lift rejected
    if (is_self_offer(post, text) or offer) and contacts_ok:
        if BUSINESS_SIGNAL_RE.search(text) and not SPECIALIST_SIGNAL_RE.search(text):
            _set_route(
                post,
                entity_type="business",
                target_collection="businesses",
                classification="direct_business_ad",
            )
            reason = "business_offer_with_contact"
        else:
            _set_route(
                post,
                entity_type="private_specialist",
                target_collection="private_specialists",
                classification="direct_specialist_ad",
            )
            reason = "specialist_offer_with_contact"
        if post.get("decision") == "rejected":
            _promote_needs_review(post, reason)
        else:
            # Keep accepted as-is only if already accepted; else needs_review
            if post.get("decision") == "accepted":
                post["decision"] = "needs_review"
                warnings = list(post.get("warnings") or [])
                warnings.append("facebook_policy:force_needs_review_no_autopublish")
                post["warnings"] = warnings
            post["facebook_policy_applied"] = True
        return post

    # Offer signals without contact → needs_review (self promo)
    if offer and is_self_offer(post, text) and post.get("decision") == "rejected":
        if SPECIALIST_SIGNAL_RE.search(text) or BUSINESS_SIGNAL_RE.search(text):
            _set_route(
                post,
                entity_type="private_specialist"
                if SPECIALIST_SIGNAL_RE.search(text)
                else "business",
                target_collection="private_specialists"
                if SPECIALIST_SIGNAL_RE.search(text)
                else "businesses",
            )
            _promote_needs_review(post, "offer_without_strong_contact")
            return post

    return post


CONTACT_LABEL_LINE_RE = re.compile(
    r"^(?:телефон|phone|звоните|whatsapp|telegram|телеграм|instagram|инста(?:грам)?|"
    r"email|e-mail|сайт|website|contacts?)\s*[:：]",
    re.I,
)
TITLE_LABEL_ONLY_RE = re.compile(
    r"^(?:телефон|phone|звоните|whatsapp|telegram|instagram|email|сайт|contacts?)\s*$",
    re.I,
)


def choose_facebook_title(post: dict[str, Any]) -> str | None:
    """Title rules: never default to author_name except specialist fallback."""
    entity = _entity(post)
    marketplace = (
        entity.get("marketplace") if isinstance(entity.get("marketplace"), dict) else {}
    )
    text = _text(post)
    et = entity.get("entity_type") or post.get("entity_type")
    target = entity.get("target_collection") or post.get("target_collection")

    if target == "marketplace" or et == "marketplace_listing":
        return (
            marketplace.get("title")
            or entity.get("business_name")
            or _guess_item_title(text)
        )

    if target == "real_estate" or et == "real_estate":
        city = entity.get("city") or ""
        kind = _guess_housing_kind(text)
        bits = [b for b in (kind, city) if b]
        return " · ".join(bits) if bits else kind or None

    if target == "events" or et == "event":
        return (
            _clean_title_candidate(entity.get("business_name"))
            or _clean_title_candidate(entity.get("person_name"))
            or _first_line(text)
        )

    if et == "business" or target == "businesses":
        return (
            _clean_title_candidate(entity.get("business_name"))
            or _guess_brand(text)
            or _first_line(text)
        )

    if et == "private_specialist" or target == "private_specialists":
        brand = _clean_title_candidate(entity.get("business_name")) or _guess_brand(text)
        person = _clean_title_candidate(entity.get("person_name"))
        # Named company / Inc / Insurance in text → brand over author
        if brand and BUSINESS_SIGNAL_RE.search(text):
            return brand
        return (
            person
            or brand
            or _clean_title_candidate(post.get("sender_name"))
            or _clean_title_candidate(post.get("author_name"))
        )

    # Generic: brand/person from entity only — not author / contact labels
    return (
        _clean_title_candidate(entity.get("business_name"))
        or _clean_title_candidate(entity.get("person_name"))
        or _guess_brand(text)
        or _first_line(text, 80)
    )


def _clean_title_candidate(value: Any) -> str | None:
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    if TITLE_LABEL_ONLY_RE.match(s) or CONTACT_LABEL_LINE_RE.match(s):
        return None
    # "Телефон: +1 323…" as whole title
    if CONTACT_LABEL_LINE_RE.match(s):
        return None
    return s


def _first_line(text: str, limit: int = 60) -> str | None:
    for raw in (text or "").splitlines():
        line = raw.strip().lstrip("#").strip()
        line = re.sub(r"^[🚚🚛📷📞]+\s*", "", line).strip()
        if not line:
            continue
        # Skip pure greetings so later contact/brand lines can win
        if re.match(
            r"^(?:привет|здравствуй(?:те)?|hello|hi|добрый\s+(?:день|вечер)|друзья)[,!.\s]",
            line,
            re.I,
        ):
            continue
        # Instagram: handle → usable title when nothing else
        ig = re.match(
            r"^(?:instagram|инста(?:грам)?)\s*[:：]\s*@?([A-Za-z0-9._]{2,30})\s*$",
            line,
            re.I,
        )
        if ig:
            return ig.group(1)[:limit]
        if CONTACT_LABEL_LINE_RE.match(line) or TITLE_LABEL_ONLY_RE.match(line):
            continue
        cleaned = _clean_title_candidate(line)
        if cleaned:
            return cleaned[:limit]
    return None


def _guess_housing_kind(text: str) -> str:
    t = (text or "").lower()
    if "комнат" in t or "room" in t:
        return "Комната"
    if "студи" in t or "studio" in t:
        return "Студия"
    if "квартир" in t or "apartment" in t or "1br" in t or "1бд" in t:
        return "Квартира"
    if "дом" in t or "house" in t:
        return "Дом"
    return "Жильё"


def _guess_item_title(text: str) -> str | None:
    m = re.search(
        r"(Canon\s+\w+(?:\s+\w+)?|Chicco\s+\w+(?:\s+\w+)?|коляск\w*|принтер\w*)",
        text or "",
        re.I,
    )
    if m:
        return m.group(1).strip()
    return _first_line(text, 80)


def _guess_brand(text: str) -> str | None:
    m = re.search(
        r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9&.' ]{1,40}?\s+"
        r"(?:Inc|LLC|Corp|Company|Insurance|Cargo|Connect|Studio|Agency))\b",
        text or "",
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    # "# Brand — description" / emoji bullet brand line
    m = re.search(
        r"^#\s*[🚚🚛🏢]?\s*([A-Za-zА-Яа-яЁё0-9][^\n—\-]{2,55})\s*[—\-]",
        text or "",
        re.M,
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    m = re.search(r"^#\s*([^\n—\-]{3,60})", text or "", re.M)
    if m:
        brand = re.sub(r"^[🚚🚛🏢\s]+", "", m.group(1)).strip()
        if brand and not CONTACT_LABEL_LINE_RE.match(brand):
            return brand[:60]
    return None