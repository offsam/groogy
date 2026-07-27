"""Facebook-specific LLM client (addendum only; Telegram prompt untouched)."""

from __future__ import annotations

from typing import Any

from analyzers import LLM_SYSTEM_PROMPT
from cost import CostTracker
from llm_client import LLMClient, _parse_json_object

FACEBOOK_SYSTEM_ADDENDUM = """
FACEBOOK GROUP ADDENDUM (applies only to Facebook source posts):
- Facebook posts are often long storytelling offers. Do NOT require a short Telegram-style ad.
- Treat price, phone, website, Instagram, Telegram/WhatsApp, and booking CTAs as strong offer signals.
- Recommendation requests ("посоветуйте", "ищу мастера", "кто может помочь найти") are NOT offers → classification=recommendation_request, decision=rejected.
- Job seekers ("ищу работу") → classification=job_post, decision=rejected.
- Hiring / vacancies ("требуется", "вакансия", "на чек") → classification=job_post; prefer entity_type path for jobs, not business catalog.
- Physical goods for sale → classification=marketplace_item.
- Room/apartment/house for rent by the author → classification=real_estate_listing.
- Events / meetups / concerts → classification=event_ad.
- Personal service ads (barber, tutor, psychologist) → direct_specialist_ad / private_specialist.
- Named companies with services → direct_business_ad / business.
- Never invent contacts. Prefer needs_review over rejected when a clear self-offer has a contact.
"""


class FacebookLLMClient(LLMClient):
    """Same client as Telegram, with Facebook system addendum only."""

    def complete_json(
        self, user_content: str, *, repair: bool = False
    ) -> tuple[dict[str, Any], dict[str, int]]:
        system = LLM_SYSTEM_PROMPT + "\n" + FACEBOOK_SYSTEM_ADDENDUM
        if repair:
            system += (
                "\nPrevious response was invalid JSON or violated the schema. "
                "Return ONLY a valid JSON object with the required keys. "
                "classification must NOT be a category value."
            )
        content, usage = self._request_with_retries(system, user_content)
        data = _parse_json_object(content)
        return data, usage


def build_facebook_llm_client() -> FacebookLLMClient:
    tracker = CostTracker(
        model="openai/gpt-4o-mini",
        max_cost_usd=float((__import__("os").getenv("TELEGRAM_LLM_MAX_COST_USD") or "5")),
    )
    return FacebookLLMClient(tracker)
