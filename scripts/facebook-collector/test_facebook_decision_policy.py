#!/usr/bin/env python3
"""Unit tests for Facebook decision policy (no network)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TG = HERE.parents[1] / "scripts" / "telegram-collector"
for p in (HERE, TG):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from facebook_decision_policy import (  # noqa: E402
    apply_facebook_decision_policy,
    choose_facebook_title,
)


def _post(
    text: str,
    *,
    decision: str = "rejected",
    classification: str = "discussion",
    phone: list[str] | None = None,
    instagram: list[str] | None = None,
    website: list[str] | None = None,
    person_name: str | None = None,
    business_name: str | None = None,
    sender_name: str | None = "Author",
) -> dict:
    return {
        "source": "facebook",
        "merged_text": text,
        "text": text,
        "decision": decision,
        "classification": classification,
        "confidence": 0.6,
        "decision_reason": "baseline",
        "advertiser_relationship": "unknown",
        "sender_name": sender_name,
        "extracted_entity": {
            "entity_type": None,
            "business_name": business_name,
            "person_name": person_name,
            "phone": phone or [],
            "instagram": instagram or [],
            "website": website or [],
            "telegram": [],
            "whatsapp": [],
            "email": [],
            "category": "other",
        },
    }


class FacebookDecisionPolicyTests(unittest.TestCase):
    def test_non_facebook_noop(self) -> None:
        p = _post("предлагаю стрижку")
        p["source"] = "telegram"
        out = apply_facebook_decision_policy(p)
        self.assertEqual(out["decision"], "rejected")
        self.assertFalse(out.get("facebook_policy_applied"))

    def test_barber_phone_price(self) -> None:
        text = (
            "Меня зовут Алексей, лицензированный барбер. "
            "СТОИМОСТЬ СТРИЖКИ ВСЕГО 20$. Для записи: +1-747-304-9816"
        )
        out = apply_facebook_decision_policy(
            _post(text, phone=["+17473049816"], person_name="Алексей")
        )
        self.assertEqual(out["decision"], "needs_review")
        self.assertTrue(out.get("facebook_policy_lifted"))
        self.assertEqual(out["extracted_entity"]["entity_type"], "private_specialist")
        self.assertEqual(out["extracted_entity"]["target_collection"], "private_specialists")

    def test_room_rental(self) -> None:
        text = (
            "Сдается приватная комната в 1br квартире. "
            "Локация Fairfax. Цена $1,250/мес. За подробностями в лс."
        )
        out = apply_facebook_decision_policy(_post(text))
        self.assertEqual(out["decision"], "needs_review")
        self.assertEqual(out["extracted_entity"]["entity_type"], "real_estate")
        self.assertEqual(out["classification"], "real_estate_listing")

    def test_canon_printer_marketplace(self) -> None:
        text = (
            "Reliable Canon PIXMA iP6000D inkjet photo printer is silver and black. "
            "This unit has a built-in control panel."
        )
        out = apply_facebook_decision_policy(_post(text))
        self.assertEqual(out["decision"], "needs_review")
        self.assertEqual(out["extracted_entity"]["target_collection"], "marketplace")

    def test_chicco_marketplace(self) -> None:
        text = (
            "Adjustable Chicco Polly high chair has a gray and beige color scheme. "
            "Estimated (WxDxH): 21 x 33 x 41 in"
        )
        out = apply_facebook_decision_policy(_post(text))
        self.assertEqual(out["decision"], "needs_review")
        self.assertEqual(out["classification"], "marketplace_item")

    def test_hawaii_tours_phone(self) -> None:
        text = (
            "Если вы собираетесь на Гавайи — буду рад помочь. "
            "Прокат машин, туры, уроки серфинга. Телефон: +1 (323) 304-5871"
        )
        out = apply_facebook_decision_policy(_post(text, phone=["+13233045871"]))
        self.assertEqual(out["decision"], "needs_review")
        self.assertIn(
            out["extracted_entity"]["entity_type"],
            {"private_specialist", "business"},
        )

    def test_recommend_plumber_rejected(self) -> None:
        out = apply_facebook_decision_policy(
            _post("Посоветуйте, пожалуйста, хорошего сантехника, хэндимэна.")
        )
        self.assertEqual(out["decision"], "rejected")

    def test_looking_for_parquet_rejected(self) -> None:
        out = apply_facebook_decision_policy(
            _post(
                "Может кто то может помочь найти человека который работаем паркетом."
            )
        )
        self.assertEqual(out["decision"], "rejected")

    def test_hvac_job_seek_rejected(self) -> None:
        out = apply_facebook_decision_policy(
            _post(
                "Здравствуйте. ищу работу Hvac technician helper. "
                "Готов много работать и обучаться."
            )
        )
        self.assertEqual(out["decision"], "rejected")
        self.assertEqual(out["classification"], "job_post")

    def test_ihss_hire_jobs_not_business(self) -> None:
        out = apply_facebook_decision_policy(
            _post("Требуется IHSS provider на чек. 44 часа в месяц. Звоните 323 868 3276",
                  phone=["+13238683276"])
        )
        self.assertEqual(out["decision"], "needs_review")
        self.assertEqual(out["extracted_entity"]["entity_type"], "job")
        self.assertEqual(out["extracted_entity"]["target_collection"], "jobs")
        self.assertNotEqual(out["extracted_entity"]["entity_type"], "business")

    def test_title_not_author_for_business(self) -> None:
        p = _post(
            "# RND Safe Cargo Inc приглашает",
            business_name="RND Safe Cargo Inc",
            sender_name="Random Author",
        )
        p["extracted_entity"]["entity_type"] = "business"
        p["extracted_entity"]["target_collection"] = "businesses"
        title = choose_facebook_title(p)
        self.assertEqual(title, "RND Safe Cargo Inc")
        self.assertNotEqual(title, "Random Author")

    def test_title_specialist_fallback_author(self) -> None:
        p = _post("предлагаю стрижку", sender_name="Алексей")
        p["extracted_entity"]["entity_type"] = "private_specialist"
        p["extracted_entity"]["target_collection"] = "private_specialists"
        self.assertEqual(choose_facebook_title(p), "Алексей")

    def test_title_skips_phone_label(self) -> None:
        text = "Телефон: +1 (323) 304-5871\nInstagram: andrei_hawaii"
        p = _post(text, sender_name="Someone")
        title = choose_facebook_title(p)
        self.assertIsNotNone(title)
        self.assertNotEqual(title, "Телефон")
        self.assertFalse(str(title).lower().startswith("телефон"))

    def test_title_brand_over_author_for_insurance(self) -> None:
        text = "# 🚚 Dovbenko Truck Insurance — надёжное страхование\n📞 312-621-6111"
        p = _post(text, sender_name="Anglician Ross")
        p["extracted_entity"]["entity_type"] = "private_specialist"
        p["extracted_entity"]["target_collection"] = "private_specialists"
        title = choose_facebook_title(p)
        self.assertIn("Dovbenko", title or "")
        self.assertNotEqual(title, "Anglician Ross")


if __name__ == "__main__":
    unittest.main()
