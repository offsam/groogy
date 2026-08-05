"""Analyzer implementations: rule-based and LLM."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any, Protocol

from categories import detect_category
from contacts import (
    extract_emails,
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    extract_whatsapp,
)
from names import extract_names
from schema import (
    empty_entity,
    empty_evidence,
    validate_analysis_result,
)

CITY_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    ("Irvine", "CA", re.compile(r"\birvine\b", re.I)),
    ("Newport Beach", "CA", re.compile(r"\bnewport\s+beach\b", re.I)),
    ("Orange County", "CA", re.compile(r"\b(?:orange\s+county|\boc\b)\b", re.I)),
    ("Los Angeles", "CA", re.compile(r"\b(?:los\s+angeles|\bla\b)\b", re.I)),
    ("Anaheim", "CA", re.compile(r"\banaheim\b", re.I)),
    ("Santa Ana", "CA", re.compile(r"\bsanta\s+ana\b", re.I)),
    ("Tustin", "CA", re.compile(r"\btustin\b", re.I)),
    ("Lake Forest", "CA", re.compile(r"\blake\s+forest\b", re.I)),
    ("Mission Viejo", "CA", re.compile(r"\bmission\s+viejo\b", re.I)),
    ("Huntington Beach", "CA", re.compile(r"\bhuntington\s+beach\b", re.I)),
    ("Laguna Niguel", "CA", re.compile(r"\blaguna\s+niguel\b", re.I)),
]

REJECT_REQUEST = re.compile(
    r"(посоветуйте|порекомендуйте|нужен\s+(?:хороший\s+)?(?:мастер|врач|няня|репетитор)|"
    r"ищем\s+(?:няню|мастера|репетитора)|recommend\s+a|looking\s+for\s+a\s+(?:nanny|tutor))",
    re.I,
)
REJECT_JOB = re.compile(
    r"\b(вакансия|ищу\s+работу|looking\s+for\s+(?:a\s+)?job|hiring|нанимаем|требуется\s+сотрудник)\b",
    re.I,
)
REJECT_MARKETPLACE = re.compile(
    r"\b(прода[юе]м\s+(?:личн|свою|детск)|отда[мю]\s+даром|garage\s+sale)\w*",
    re.I,
)
REJECT_HOUSING = re.compile(
    r"\b(сда[её]тся\s+(?:квартира|комната|дом)|room\s+for\s+rent|прода[её]тся\s+(?:дом|квартира|condo))\b",
    re.I,
)
THIRD_PARTY = re.compile(
    r"(хожу\s+к|ходил[аи]?\s+к|мой\s+сын\s+у|рекомендую\s+(?:мастера|врача|е[её])|"
    r"очень\s+довольн|у\s+не[её]\s+дела|вот\s+(?:е[её]|его)\s+(?:телефон|инста)|"
    r"recommend(?:ing)?\s+(?:her|him)|she\s+is\s+amazing|he\s+is\s+amazing)",
    re.I,
)
SELF_OFFER = re.compile(
    r"\b(предлагаю|предоставляю|работаю|записывайтесь|открыта\s+запись|мои\s+услуги|"
    r"я\s+[—\-–]?\s*(?:мастер|фотограф|тренер|психолог|няня|парикмахер)|"
    r"book\s+now|accepting\s+clients)\b",
    re.I,
)
PRICE_RE = re.compile(r"\$\s?\d+(?:[.,]\d+)?(?:\s*/\s*(?:час|hour|hr|сеанс|session))?", re.I)


class Analyzer(Protocol):
    name: str
    provider: str | None
    model: str | None

    def analyze(self, post: dict[str, Any]) -> dict[str, Any]:
        ...


def _fill_contacts(entity: dict[str, Any], text: str) -> None:
    entity["phone"] = extract_phones(text)
    entity["email"] = extract_emails(text)
    entity["website"] = extract_websites(text)
    entity["instagram"] = extract_instagram(text)
    entity["telegram"] = extract_telegram(text)
    entity["whatsapp"] = extract_whatsapp(text)


def _detect_city(text: str) -> tuple[str | None, str | None, list[str], list[str]]:
    city = state = None
    areas: list[str] = []
    evidence: list[str] = []
    for c, st, pattern in CITY_PATTERNS:
        m = pattern.search(text or "")
        if m:
            areas.append(c)
            evidence.append(m.group(0))
            if city is None:
                city, state = c, st
    return city, state, areas, evidence


def _attach_post_fields(post: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    out = dict(post)
    out.update(analysis)
    entity = out.get("extracted_entity") or empty_entity(post)
    if not entity.get("source_message_ids"):
        entity["source_message_ids"] = post.get("source_message_ids") or [
            post.get("primary_message_id") or post.get("message_id")
        ]
    if not entity.get("source_date"):
        entity["source_date"] = post.get("message_date_start") or post.get("message_date")
    out["extracted_entity"] = entity
    return out


class RuleBasedAnalyzer:
    """Improved heuristic classifier (v2). Not a substitute for LLM semantics."""

    name = "rule_based_v2"
    provider = None
    model = None

    def analyze(self, post: dict[str, Any]) -> dict[str, Any]:
        text = (post.get("merged_text") or post.get("text") or "").strip()
        entity = empty_entity(post)
        evidence = empty_evidence()
        warnings: list[str] = []
        missing: list[str] = []

        _fill_contacts(entity, text)
        names = extract_names(text, post.get("sender_name"))
        entity["person_name"] = names["person_name"]
        entity["business_name"] = names["business_name"]
        entity["extracted_name_source"] = names["extracted_name_source"]
        if names["extracted_name_source"] == "sender_profile":
            warnings.append("name_from_sender_profile_only")

        category, cat_warnings = detect_category(text)
        entity["category"] = category
        warnings.extend(cat_warnings)

        city, state, areas, loc_ev = _detect_city(text)
        entity["city"] = city
        entity["state"] = state
        entity["service_area"] = areas
        evidence["location_evidence"] = loc_ev

        prices = [m.group(0).strip() for m in PRICE_RE.finditer(text)]
        entity["prices"] = list(dict.fromkeys(prices))

        has_contact = bool(
            entity["phone"]
            or entity["email"]
            or entity["website"]
            or entity["instagram"]
            or entity["telegram"]
            or entity["whatsapp"]
        )
        if entity["phone"]:
            evidence["contact_evidence"].extend(entity["phone"])
        if entity["instagram"]:
            evidence["contact_evidence"].extend([f"@{x}" for x in entity["instagram"]])
        if entity["website"]:
            evidence["contact_evidence"].extend(entity["website"])

        self_offer = bool(SELF_OFFER.search(text))
        third_party = bool(THIRD_PARTY.search(text)) and not self_offer

        raw: dict[str, Any]

        if REJECT_REQUEST.search(text) and not (self_offer and has_contact):
            raw = {
                "classification": "recommendation_request",
                "decision": "rejected",
                "confidence": 0.86,
                "decision_reason": "Просьба посоветовать специалиста, не прямая реклама.",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings,
            }
        elif REJECT_JOB.search(text):
            raw = {
                "classification": "job_post",
                "decision": "needs_review",
                "confidence": 0.88,
                "decision_reason": "Вакансия / поиск работы → очередь Jobs.",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings + ["typed_job_post"],
            }
        elif REJECT_HOUSING.search(text):
            raw = {
                "classification": "real_estate_listing",
                "decision": "needs_review",
                "confidence": 0.84,
                "decision_reason": "Объявление недвижимости → очередь Real estate.",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings + ["typed_real_estate"],
            }
        elif REJECT_MARKETPLACE.search(text) and not (self_offer and category != "other"):
            raw = {
                "classification": "marketplace_item",
                "decision": "needs_review",
                "confidence": 0.8,
                "decision_reason": "Продажа вещи → очередь Marketplace.",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings + ["typed_marketplace"],
            }
        elif third_party:
            raw = {
                "classification": "third_party_recommendation",
                "decision": "needs_review",
                "confidence": 0.78,
                "decision_reason": "Рекомендация третьего лица — только ручная проверка.",
                "advertiser_relationship": "third_party_recommendation",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings + ["third_party_never_auto_accepted"],
            }
        elif self_offer and has_contact and category != "other":
            is_business = bool(entity["business_name"] and names["extracted_name_source"] in {
                "business_brand",
                "instagram",
            })
            entity["entity_type"] = "business" if is_business else "private_specialist"
            entity["description"] = text[:240]
            evidence["service_evidence"].append(category)
            if self_offer:
                evidence["business_evidence"].append("self_offer_language")
            confidence = 0.84 if (
                names["extracted_name_source"] in {"explicit_text", "business_brand", "instagram"}
                and has_contact
            ) else 0.76
            raw = {
                "classification": "direct_business_ad" if is_business else "direct_specialist_ad",
                "decision": "accepted" if confidence >= 0.82 else "needs_review",
                "confidence": confidence,
                "decision_reason": "Автор предлагает услугу с контактом (rule-based v2).",
                "advertiser_relationship": "self",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings,
            }
        elif self_offer and not has_contact:
            entity["entity_type"] = "private_specialist"
            entity["description"] = text[:240]
            if not entity["person_name"] and not entity["business_name"]:
                missing.append("name")
            missing.append("contact")
            raw = {
                "classification": "self_promotion_without_contact",
                "decision": "needs_review",
                "confidence": 0.7,
                "decision_reason": "Самореклама без прямого контакта в тексте.",
                "advertiser_relationship": "self",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings,
            }
        elif has_contact and category != "other":
            entity["entity_type"] = "private_specialist"
            entity["description"] = text[:240]
            raw = {
                "classification": "unclear",
                "decision": "needs_review",
                "confidence": 0.62,
                "decision_reason": "Есть контакт и категория, но неясно отношение автора.",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings,
            }
        elif len(text) < 40 and not has_contact:
            raw = {
                "classification": "irrelevant",
                "decision": "rejected",
                "confidence": 0.7,
                "decision_reason": "Короткое сообщение без коммерческих признаков.",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings,
            }
        else:
            raw = {
                "classification": "discussion",
                "decision": "rejected",
                "confidence": 0.6,
                "decision_reason": "Не похоже на прямую рекламу услуг.",
                "advertiser_relationship": "unknown",
                "extracted_entity": entity,
                "evidence": evidence,
                "missing_fields": missing,
                "warnings": warnings,
            }

        validated = validate_analysis_result(raw)
        return _attach_post_fields(post, validated)


LLM_SYSTEM_PROMPT = """You analyze Telegram group posts about local services/businesses.
Return ONLY valid JSON matching the required schema. No markdown, no commentary.

CRITICAL FIELD SEPARATION:
- classification MUST be one of these exact values ONLY:
  direct_business_ad, direct_specialist_ad, self_promotion_without_contact,
  third_party_recommendation, recommendation_request, event_ad, job_post,
  marketplace_item, real_estate_listing, discussion, irrelevant, unclear
- category is a SEPARATE field inside extracted_entity and MUST be one of:
  beauty, health, fitness, education, childcare, legal, accounting, insurance,
  real_estate_services, auto_services, car_rental, home_services, cleaning, moving,
  food, photography_video, events, travel, pet_services, professional_services, other
- NEVER put a category value into classification.

Rules:
- Never invent names, cities, phones, services, or legal business names.
- Use only evidence present in the post text.
- If the author offers their own services with Instagram/phone/website/Telegram, use classification=direct_specialist_ad (or direct_business_ad for a named business), advertiser_relationship=self.
- Third-party recommendations are NEVER accepted; use classification=third_party_recommendation and decision=needs_review.
- Travel-carry ads («Лечу …», take packages/documents on a flight, попутчик) → classification=unclear, decision=needs_review, warning typed_lechu (system routes to Lechu).
- Money transfer / currency exchange offers (рубли↔доллары, перевод денег, обмен валют) → classification=unclear, decision=needs_review, warning typed_transfer (system routes to Transfers). Do NOT use marketplace_item for FX.
- Pure «ищу / посоветуйте / looking for» with no offered contact → classification=recommendation_request, decision=needs_review (seeking hold — not rejected).
- If unsure about category, use other and add a warning.
- Contact fields must be arrays.
- extracted_name_source must be one of: explicit_text, business_brand, instagram, sender_profile, unknown.
- advertiser_relationship: self | authorized_business_post | third_party_recommendation | unknown
"""


def _llm_user_payload(post: dict[str, Any]) -> str:
    return json.dumps(
        {
            "post": {
                "merged_text": post.get("merged_text") or post.get("text"),
                "sender_name": post.get("sender_name"),
                "sender_id": post.get("sender_id"),
                "source_message_ids": post.get("source_message_ids"),
                "message_date_start": post.get("message_date_start"),
                "message_date_end": post.get("message_date_end"),
                "merge_reason": post.get("merge_reason"),
            },
            "allowed_categories": [
                "beauty",
                "health",
                "fitness",
                "education",
                "childcare",
                "legal",
                "accounting",
                "insurance",
                "real_estate_services",
                "auto_services",
                "car_rental",
                "home_services",
                "cleaning",
                "moving",
                "food",
                "photography_video",
                "events",
                "travel",
                "pet_services",
                "professional_services",
                "other",
            ],
            "required_json_keys": [
                "classification",
                "decision",
                "confidence",
                "decision_reason",
                "advertiser_relationship",
                "extracted_entity",
                "evidence",
                "missing_fields",
                "warnings",
            ],
        },
        ensure_ascii=False,
    )


class LLMAnalyzer:
    """LLM-backed analyzer using OpenRouter, OpenAI, or Anthropic."""

    name = "llm_v1"

    def __init__(self) -> None:
        self.provider, self.api_key, self.model, self.base_url = resolve_llm_config()
        if not self.api_key:
            raise RuntimeError(
                "LLM key not configured. Set OPENROUTER_API_KEY, OPENAI_API_KEY, "
                "or ANTHROPIC_API_KEY in .env / .env.local."
            )

    def analyze(self, post: dict[str, Any]) -> dict[str, Any]:
        try:
            content = self._complete(_llm_user_payload(post))
            data = _parse_json_response(content)
        except Exception as exc:
            entity = empty_entity(post)
            _fill_contacts(entity, post.get("merged_text") or post.get("text") or "")
            fallback = validate_analysis_result(
                {
                    "classification": "unclear",
                    "decision": "needs_review",
                    "confidence": 0.4,
                    "decision_reason": f"LLM call/parse failed: {type(exc).__name__}",
                    "advertiser_relationship": "unknown",
                    "extracted_entity": entity,
                    "evidence": empty_evidence(),
                    "missing_fields": [],
                    "warnings": [f"llm_error:{type(exc).__name__}"],
                }
            )
            out = _attach_post_fields(post, fallback)
            out["analyzer"] = self.name
            out["llm_provider"] = self.provider
            out["llm_model"] = self.model
            return out

        # Ensure contacts are arrays even if model returns strings.
        entity = data.get("extracted_entity") or {}
        for key in (
            "phone",
            "email",
            "website",
            "instagram",
            "facebook",
            "telegram",
            "whatsapp",
            "services",
            "prices",
            "service_area",
            "languages",
        ):
            if key in entity and isinstance(entity[key], str):
                entity[key] = [entity[key]] if entity[key].strip() else []
        data["extracted_entity"] = entity
        if not entity.get("source_message_ids"):
            entity["source_message_ids"] = post.get("source_message_ids") or []
        try:
            validated = validate_analysis_result(data)
        except Exception as exc:
            entity = empty_entity(post)
            _fill_contacts(entity, post.get("merged_text") or post.get("text") or "")
            validated = validate_analysis_result(
                {
                    "classification": "unclear",
                    "decision": "needs_review",
                    "confidence": 0.4,
                    "decision_reason": f"LLM schema invalid: {type(exc).__name__}",
                    "advertiser_relationship": "unknown",
                    "extracted_entity": entity,
                    "evidence": empty_evidence(),
                    "missing_fields": [],
                    "warnings": [f"schema_error:{type(exc).__name__}"],
                }
            )
        # Ground contacts with deterministic extractors (do not invent).
        text = post.get("merged_text") or post.get("text") or ""
        grounded = validated["extracted_entity"]
        for key, values in {
            "phone": extract_phones(text),
            "email": extract_emails(text),
            "website": extract_websites(text),
            "instagram": extract_instagram(text),
            "telegram": extract_telegram(text),
            "whatsapp": extract_whatsapp(text),
        }.items():
            grounded[key] = values
        validated["extracted_entity"] = grounded
        validated = validate_analysis_result(validated)
        out = _attach_post_fields(post, validated)
        out["analyzer"] = self.name
        out["llm_provider"] = self.provider
        out["llm_model"] = self.model
        return out
    def _complete(self, user_content: str) -> str:
        if self.provider in {"openrouter", "openai"}:
            return self._chat_completions(user_content)
        if self.provider == "anthropic":
            return self._anthropic(user_content)
        raise RuntimeError(f"Unsupported provider: {self.provider}")

    def _chat_completions(self, user_content: str) -> str:
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": LLM_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.provider == "openrouter":
            headers["HTTP-Referer"] = "https://localhost"
            headers["X-Title"] = "Krugi Telegram Collector"
        req = urllib.request.Request(
            self.base_url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"LLM HTTP {exc.code}: {detail}") from exc
        return body["choices"][0]["message"]["content"]

    def _anthropic(self, user_content: str) -> str:
        payload = {
            "model": self.model,
            "max_tokens": 2000,
            "temperature": 0,
            "system": LLM_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_content}],
        }
        req = urllib.request.Request(
            self.base_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"Anthropic HTTP {exc.code}: {detail}") from exc
        parts = body.get("content") or []
        texts = [p.get("text", "") for p in parts if p.get("type") == "text"]
        return "\n".join(texts)


def resolve_llm_config() -> tuple[str | None, str | None, str | None, str | None]:
    """Return provider, api_key, model, base_url from env."""
    forced = (os.getenv("TELEGRAM_LLM_PROVIDER") or "").strip().lower()
    model_override = (os.getenv("TELEGRAM_LLM_MODEL") or "").strip() or None

    openrouter = (os.getenv("OPENROUTER_API_KEY") or "").strip() or None
    openai = (os.getenv("OPENAI_API_KEY") or "").strip() or None
    anthropic = (os.getenv("ANTHROPIC_API_KEY") or "").strip() or None

    if forced == "openrouter" or (not forced and openrouter):
        return (
            "openrouter",
            openrouter,
            model_override or "openai/gpt-4o-mini",
            "https://openrouter.ai/api/v1/chat/completions",
        )
    if forced == "openai" or (not forced and openai):
        return (
            "openai",
            openai,
            model_override or "gpt-4o-mini",
            "https://api.openai.com/v1/chat/completions",
        )
    if forced == "anthropic" or (not forced and anthropic):
        return (
            "anthropic",
            anthropic,
            model_override or "claude-3-5-haiku-latest",
            "https://api.anthropic.com/v1/messages",
        )
    return None, None, None, None


def llm_key_status() -> dict[str, Any]:
    provider, key, model, _ = resolve_llm_config()
    return {
        "configured": bool(key),
        "provider": provider,
        "model": model,
        "missing_keys": [
            name
            for name, val in [
                ("OPENROUTER_API_KEY", os.getenv("OPENROUTER_API_KEY")),
                ("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY")),
                ("ANTHROPIC_API_KEY", os.getenv("ANTHROPIC_API_KEY")),
            ]
            if not (val or "").strip()
        ],
    }


def _parse_json_response(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def get_analyzer(mode: str | None = None) -> Analyzer:
    selected = (mode or os.getenv("TELEGRAM_ANALYZER_MODE") or "llm").strip().lower()
    if selected in {"rule_based", "rule", "rules"}:
        return RuleBasedAnalyzer()
    if selected in {"llm", "openai", "openrouter", "anthropic"}:
        status = llm_key_status()
        if not status["configured"]:
            print(
                "Ошибка: TELEGRAM_ANALYZER_MODE=llm, но AI-ключ не найден.\n"
                "Добавьте один из ключей в .env.local:\n"
                "  OPENROUTER_API_KEY=\n"
                "  OPENAI_API_KEY=\n"
                "  ANTHROPIC_API_KEY=\n"
                "Опционально: TELEGRAM_LLM_PROVIDER, TELEGRAM_LLM_MODEL.\n"
                "Фиктивный LLM-анализ не запускался.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        return LLMAnalyzer()
    print(f"Ошибка: неизвестный TELEGRAM_ANALYZER_MODE={selected}", file=sys.stderr)
    raise SystemExit(2)
