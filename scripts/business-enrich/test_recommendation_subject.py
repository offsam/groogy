#!/usr/bin/env python3
"""Unit tests for recommendation subject / employer / junk-service rules."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

from recommendation_subject import (  # noqa: E402
    clean_public_description,
    extract_employer,
    is_corporate_instagram,
    personal_website_or_none,
    recommended_subject_name,
    resolve_professional_display_name,
    strip_recommender_voice,
)
from web_enrichment import (  # noqa: E402
    _service_offers_from_json_ld,
    is_plausible_service_title,
)


LYUBOV_TEXT = """
Для тех, кто сейчас в поиске Mercedes-Benz: рекомендую обратиться в Mercedes-Benz of Anaheim к Айман Зейтун.
Сейчас у дилера отличные условия по лизингу на модельный ряд 2026 года.
Айман поможет с подбором авто, ответит на все вопросы по комплектациям.
📍 Ознакомиться с выбором: https://www.mercedesbenzofanaheim.com/
📞 Телефон для связи: +1 (805) 264-1118
Пишите или звоните напрямую, он сориентирует вас по актуальным акциям и наличию.
+1 (805) 264-1118 Айман

Контакты: тел: +18052641118 · сайт: https://www.mercedesbenzofanaheim.com/
Источник: Telegram, дата: 2026-06-19T20:56:24+00:00
"""


class SubjectTests(unittest.TestCase):
    def test_extracts_aiman_not_lyubov(self) -> None:
        self.assertEqual(recommended_subject_name(LYUBOV_TEXT), "Айман Зейтун")

    def test_rejects_recommender_as_display_name(self) -> None:
        name = resolve_professional_display_name(
            {
                "display_name": "Lyubov Nikonova",
                "recommender_names": ["Lyubov Nikonova"],
                "third_party_mention_count": 1,
                "comment_texts": [LYUBOV_TEXT],
            }
        )
        self.assertEqual(name, "Айман Зейтун")

    def test_external_employer_not_russian_catalog(self) -> None:
        emp = extract_employer(LYUBOV_TEXT)
        assert emp is not None
        self.assertEqual(emp["employer_name"], "Mercedes-Benz of Anaheim")
        self.assertFalse(emp["is_russian_catalog"])
        self.assertIn("продаж", emp["employer_role"] or "")

    def test_description_strips_contacts_and_footer(self) -> None:
        cleaned = clean_public_description(LYUBOV_TEXT) or ""
        self.assertNotIn("805", cleaned)
        self.assertNotIn("mercedesbenzofanaheim.com", cleaned)
        self.assertNotIn("Источник", cleaned)
        self.assertNotIn("2026-06-19T", cleaned)
        self.assertIn("Айман", cleaned)

    def test_corporate_instagram_and_dealership_site(self) -> None:
        self.assertTrue(is_corporate_instagram("https://www.instagram.com/MercedesBenzUSA/"))
        self.assertIsNone(
            personal_website_or_none(
                ["https://www.mercedesbenzofanaheim.com/"],
                employer_name="Mercedes-Benz of Anaheim",
            )
        )


class JunkServiceTests(unittest.TestCase):
    def test_nav_titles_rejected(self) -> None:
        for title in ("Home", "Contact", "About Us", "Company", "MINUTES", "SECONDS"):
            self.assertFalse(is_plausible_service_title(title), title)

    def test_real_service_kept(self) -> None:
        self.assertTrue(
            is_plausible_service_title(
                "Женская стрижка", has_price=True, typed_service=True
            )
        )

    def test_json_ld_filters_knows_about_chrome(self) -> None:
        offers = _service_offers_from_json_ld(
            {
                "@type": "AutoDealer",
                "knowsAbout": [
                    "Home",
                    "Contact",
                    "About Us",
                    "MINUTES",
                    "Automotive Digital Marketing Solutions | Dealer.com",
                    "Impressive range. Awe-inspiring style.",
                ],
                "makesOffer": [
                    {
                        "@type": "Offer",
                        "itemOffered": {"@type": "Service", "name": "Vehicle leasing consultation"},
                        "price": "0",
                        "priceCurrency": "USD",
                    }
                ],
            }
        )
        titles = [o["title"] for o in offers]
        self.assertIn("Vehicle leasing consultation", titles)
        for junk in ("Home", "Contact", "About Us", "MINUTES", "Dealer.com"):
            self.assertTrue(all(junk.lower() not in t.lower() for t in titles), junk)


class RecommenderVoiceTests(unittest.TestCase):
    def test_keeps_facts_drops_the_recommendation_sentence(self) -> None:
        kept = strip_recommender_voice(
            "Для тех, кто в поиске Mercedes-Benz: рекомендую обратиться "
            "в Mercedes-Benz of Anaheim к Айман Зейтун.\n"
            "Сейчас у дилера отличные условия по лизингу на модельный ряд 2026 года.\n"
            "Айман поможет с подбором авто и ответит на вопросы по комплектациям."
        )
        self.assertIsNotNone(kept)
        self.assertNotIn("рекомендую", kept or "")
        self.assertIn("отличные условия по лизингу", kept or "")

    def test_pure_review_leaves_no_description(self) -> None:
        self.assertIsNone(
            strip_recommender_voice(
                "Алёна, моя жена. Мне кажется, никто в мире не наводит чистоту "
                "так тщательно, как она. Её телефон 9258007001."
            )
        )

    def test_owner_call_to_action_survives(self) -> None:
        text = (
            "Печать документов. Доставка или встреча. Качество как оригинал. "
            "Обращайтесь в ЛС, рекомендуем записаться заранее."
        )
        self.assertEqual(strip_recommender_voice(text), text)

    def test_abbreviation_does_not_split_a_sentence(self) -> None:
        text = (
            "Сдаётся частично в аренду меблированный офис (300 кв. футов). "
            "В помещении большое окно, современная мебель и высокоскоростной интернет."
        )
        self.assertEqual(strip_recommender_voice(text), text)


if __name__ == "__main__":
    raise SystemExit(unittest.main())
