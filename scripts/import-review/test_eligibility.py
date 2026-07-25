#!/usr/bin/env python3
"""Unit tests for autopublish eligibility helpers."""

from __future__ import annotations

import unittest

from eligibility import (
    evaluate_eligibility,
    extract_direct_contacts,
    has_direct_contact,
    normalize_instagram,
    normalize_phone,
    normalize_telegram_username,
    normalize_website,
)


class NormalizeTests(unittest.TestCase):
    def test_phone_nanp_valid(self) -> None:
        self.assertEqual(normalize_phone("(626) 481-3333"), "+16264813333")
        self.assertEqual(normalize_phone("+1 626 481 3333"), "+16264813333")

    def test_phone_rejects_invalid_area(self) -> None:
        self.assertIsNone(normalize_phone("+10501294005"))
        self.assertIsNone(normalize_phone("+10401283255"))
        self.assertIsNone(normalize_phone("0501294005"))

    def test_instagram_url_and_handle(self) -> None:
        self.assertEqual(normalize_instagram("@mary.smith"), "mary.smith")
        self.assertEqual(
            normalize_instagram("https://instagram.com/mary.smith"), "mary.smith"
        )
        self.assertIsNone(normalize_instagram("https://instagram.com/p/ABC123"))
        self.assertIsNone(normalize_instagram("gmail.com"))

    def test_website(self) -> None:
        self.assertEqual(normalize_website("example.com"), "https://example.com")
        self.assertIsNone(normalize_website("whatsapp"))
        self.assertIsNone(normalize_website("not a url"))

    def test_telegram_username(self) -> None:
        self.assertEqual(normalize_telegram_username("@MarySmith"), "MarySmith")
        self.assertIsNone(normalize_telegram_username("ab"))  # too short
        self.assertIsNone(normalize_telegram_username("12345"))  # must start letter


class ContactAndEligibilityTests(unittest.TestCase):
    def test_source_url_and_user_id_not_direct(self) -> None:
        row = {
            "ai_decision": "accepted",
            "ai_confidence": 0.95,
            "entity_type": "marketplace_listing",
            "target_collection": "marketplace",
            "title": "Диван",
            "description": "Продаю диван в хорошем состоянии, забирать сегодня",
            "category": "furniture",
            "source_url": "https://t.me/c/1333533747/123",
            "telegram_user_id": "123456789",
            "phone": [],
            "instagram": [],
            "website": [],
            "email": [],
            "whatsapp": [],
            "telegram_username": None,
            "duplicate_status": "unique",
            "source_posted_at": "2026-07-01T00:00:00+00:00",
        }
        contacts = extract_direct_contacts(row)
        self.assertFalse(has_direct_contact(contacts))
        result = evaluate_eligibility(row)
        self.assertFalse(result["eligible"])
        self.assertIn("нет контакта", result["reasons"])

    def test_strong_phone_marketplace_eligible(self) -> None:
        row = {
            "ai_decision": "accepted",
            "ai_confidence": 0.95,
            "entity_type": "marketplace_listing",
            "target_collection": "marketplace",
            "title": "Оксана Амирова",
            "description": "Продаю коляску в отличном состоянии, самовывоз Bay Area",
            "category": "baby",
            "phone": ["+1 (626) 481-3333"],
            "instagram": [],
            "website": [],
            "email": [],
            "whatsapp": [],
            "telegram_username": None,
            "duplicate_status": "unique",
            "source_posted_at": "2026-06-20T00:00:00+00:00",
            "city": None,
        }
        result = evaluate_eligibility(row)
        self.assertTrue(result["eligible"], result["reasons"])
        self.assertEqual(result["contacts"]["phone"], ["+16264813333"])

    def test_events_blocked(self) -> None:
        row = {
            "ai_decision": "accepted",
            "ai_confidence": 1.0,
            "entity_type": "event",
            "target_collection": "events",
            "title": "День рождения",
            "description": "Приглашаем всех на праздник в субботу в парке",
            "category": "events",
            "phone": ["+16264813333"],
            "duplicate_status": "unique",
            "source_posted_at": "2026-07-01T00:00:00+00:00",
        }
        result = evaluate_eligibility(row)
        self.assertFalse(result["eligible"])
        self.assertTrue(any("events" in r for r in result["reasons"]))

    def test_specialist_city_optional_with_contact(self) -> None:
        row = {
            "ai_decision": "accepted",
            "ai_confidence": 0.9,
            "entity_type": "private_specialist",
            "target_collection": "private_specialists",
            "title": "Мария Психолог",
            "description": "Психолог для мам, онлайн и офлайн консультации",
            "category": "psychology",
            "instagram": ["maria_psy"],
            "phone": [],
            "city": None,
            "duplicate_status": "unique",
            "source_posted_at": "2026-01-01T00:00:00+00:00",
        }
        result = evaluate_eligibility(row)
        self.assertTrue(result["eligible"], result["reasons"])

    def test_business_not_stale_by_age(self) -> None:
        row = {
            "ai_decision": "accepted",
            "ai_confidence": 0.95,
            "entity_type": "business",
            "target_collection": "businesses",
            "title": "Кафе Круги",
            "description": "Семейное кафе с детской зоной и завтраками",
            "category": "food",
            "phone": ["+16264813333"],
            "city": "Los Angeles",
            "duplicate_status": "unique",
            "source_posted_at": "2025-11-01T00:00:00+00:00",
        }
        result = evaluate_eligibility(row)
        self.assertTrue(result["eligible"], result["reasons"])
        self.assertFalse(any("устаревш" in r for r in result["reasons"]))

    def test_marketplace_still_stale(self) -> None:
        row = {
            "ai_decision": "accepted",
            "ai_confidence": 0.95,
            "entity_type": "marketplace_listing",
            "target_collection": "marketplace",
            "title": "Коляска",
            "description": "Продаю коляску в отличном состоянии, самовывоз",
            "category": "baby",
            "phone": ["+16264813333"],
            "duplicate_status": "unique",
            "source_posted_at": "2026-01-01T00:00:00+00:00",
        }
        result = evaluate_eligibility(row)
        self.assertFalse(result["eligible"])
        self.assertTrue(any("устаревш" in r for r in result["reasons"]))


if __name__ == "__main__":
    unittest.main()
