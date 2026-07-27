#!/usr/bin/env python3
"""Tests for Facebook geo/price enrichment (dictionary + price regex)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from geo_price_enrichment import (  # noqa: E402
    enrich_prices_and_city,
    extract_city_from_text,
    extract_prices_from_text,
)


class PriceExtractionTests(unittest.TestCase):
    def test_dollar_forms(self) -> None:
        text = "стрижка $20, борода 10$, от $90 сутки, $20/hour и $15/час, $25 per hour"
        got = extract_prices_from_text(text)
        self.assertIn("$20", got)
        self.assertIn("10$", got)
        self.assertIn("от $90", got)
        self.assertIn("$20/hour", got)
        self.assertIn("$15/час", got)
        self.assertIn("$25 per hour", got)

    def test_ot_suffix_dollar(self) -> None:
        got = extract_prices_from_text("Скидки на жилье! От 90$ сутки")
        self.assertTrue(any(p.lower() == "от 90$" for p in got), got)

    def test_no_phone_as_price(self) -> None:
        self.assertEqual(extract_prices_from_text("Звоните 323 868 3276"), [])

    def test_comma_thousands(self) -> None:
        self.assertIn("$1,250", extract_prices_from_text("Цена $1,250/мес"))


class CityDictionaryTests(unittest.TestCase):
    def test_longest_match_west_hollywood(self) -> None:
        self.assertEqual(
            extract_city_from_text("Studio near West Hollywood and Hollywood"),
            "West Hollywood",
        )

    def test_studio_city(self) -> None:
        self.assertEqual(
            extract_city_from_text("📍 Los Angeles (Studio City & nearby areas)"),
            "Studio City",
        )

    def test_sherman_oaks(self) -> None:
        self.assertEqual(
            extract_city_from_text("выезд в Sherman Oaks, CA"),
            "Sherman Oaks",
        )

    def test_woodland_hills(self) -> None:
        self.assertEqual(
            extract_city_from_text("из Woodland Hills в Calabasas"),
            "Woodland Hills",
        )

    def test_not_in_dictionary(self) -> None:
        self.assertIsNone(extract_city_from_text("живу на Оаху, Гавайи"))
        self.assertIsNone(extract_city_from_text("Fairfax & The Grove"))

    def test_no_bare_la(self) -> None:
        # Do not treat bare "LA" / "la" as Los Angeles (too noisy).
        self.assertIsNone(extract_city_from_text("group Russian in LA meetup"))


class EnrichMergeTests(unittest.TestCase):
    def test_does_not_overwrite_existing(self) -> None:
        posts = [
            {
                "text": "Sherman Oaks $20",
                "extracted_entity": {
                    "city": "Irvine",
                    "prices": ["$99"],
                },
            }
        ]
        stats = enrich_prices_and_city(posts, enabled=True)
        self.assertEqual(stats["prices_filled"], 0)
        self.assertEqual(stats["city_filled"], 0)
        self.assertEqual(posts[0]["extracted_entity"]["city"], "Irvine")
        self.assertEqual(posts[0]["extracted_entity"]["prices"], ["$99"])

    def test_fills_empty(self) -> None:
        posts = [
            {
                "text": "Барбер в Sherman Oaks. Стрижка 20$",
                "extracted_entity": {"city": None, "prices": []},
            }
        ]
        stats = enrich_prices_and_city(posts, enabled=True)
        self.assertEqual(stats["city_filled"], 1)
        self.assertEqual(stats["prices_filled"], 1)
        self.assertEqual(posts[0]["extracted_entity"]["city"], "Sherman Oaks")
        self.assertEqual(posts[0]["extracted_entity"]["prices"], ["20$"])
        self.assertEqual(
            posts[0]["extracted_entity"]["field_sources"]["city"], "post_text_rules"
        )


if __name__ == "__main__":
    unittest.main()
