#!/usr/bin/env python3
"""Richest-description pick for enrich (no LLM / no concat).

Run: python3 scripts/business-enrich/test_description_richness.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from completeness_score import (  # noqa: E402
    description_is_richer,
    is_weak_description,
    pick_richest_description,
    richness_score,
)
from enrich_resource_queue import _merge_fill_empty  # noqa: E402


SHORT_ROP = (
    "Affordable Dentist — family dental care in Fullerton. "
    "Call for an appointment today."
)

RICH_SITE = (
    "Affordable Dentist Dr. Polina Rhoudenko provides comprehensive family "
    "dentistry in Fullerton. We offer teeth whitening, Invisalign clear aligners, "
    "crowns and bridges, white esthetic fillings, dentures, professional cleaning, "
    "night guards, extractions, and implants. Our team focuses on gentle care for "
    "children and adults, with free orthodontist consultations and emergency dental "
    "service when you need it most. Visit our office on Laguna Road for a calm, "
    "modern experience."
)

WEAK_IG = "https://instagram.com/someclinic @someclinic book now"


class DescriptionRichnessTests(unittest.TestCase):
    def test_weak_scores_negative(self) -> None:
        self.assertTrue(is_weak_description(WEAK_IG))
        self.assertLess(richness_score(WEAK_IG), 0)

    def test_richer_beats_short(self) -> None:
        self.assertTrue(
            description_is_richer(
                RICH_SITE, SHORT_ROP, new_source="website", current_source="source"
            )
        )
        self.assertFalse(
            description_is_richer(
                SHORT_ROP, RICH_SITE, new_source="source", current_source="website"
            )
        )

    def test_pick_richest_among_three(self) -> None:
        text, source = pick_richest_description(
            [
                (SHORT_ROP, "source"),
                (WEAK_IG, "instagram"),
                (RICH_SITE, "website"),
            ]
        )
        self.assertEqual(source, "website")
        self.assertIsNotNone(text)
        assert text is not None
        self.assertIn("Invisalign", text)
        self.assertGreater(len(text), len(SHORT_ROP))

    def test_directory_listing_glue_is_weak(self) -> None:
        glue = (
            "Notary/Documents/Translation (2)\n\n"
            "Document Heroes, LLC\n\n"
            "February 21, 2022\n\n"
            "Olga Lannom\n\n"
            "7541\n\n"
            "Почта и сайт — в блоке «Контакты»"
        )
        self.assertTrue(is_weak_description(glue))
        self.assertLess(richness_score(glue), 0)

    def test_website_beats_directory_glue(self) -> None:
        glue = (
            "Notary/Documents/Translation (2)\n\nDocument Heroes, LLC\n\n"
            "February 21, 2022\n\nOlga Lannom\n\n7541"
        )
        text, source = pick_richest_description(
            [
                (glue, "existing"),
                (RICH_SITE, "website"),
            ]
        )
        self.assertEqual(source, "website")
        self.assertIn("Invisalign", text or "")

    def test_website_beats_telegram_ad_with_address_cta(self) -> None:
        telegram_ad = (
            "Профессиональные курсы “Start CDL Training” на русском языке проводит "
            "обучение поэтапно. Учиться можно на механической или автоматической "
            "коробке передач. Школа работает с 2014 года. Расположение тренировочной "
            "площадки-1920 Rowland St, Cinnaminson, NJ 08077 Подробности на сайте"
        )
        website_about = (
            "Whether you’re starting fresh or changing careers, our step-by-step "
            "training covers everything — from the first permit to the final test. "
            "You’ll get hands-on practice, expert instruction and full support "
            "through the whole process."
        )
        text, source = pick_richest_description(
            [
                (telegram_ad, "existing"),
                (website_about, "website"),
            ]
        )
        self.assertEqual(source, "website")
        self.assertIn("step-by-step", text or "")
        self.assertTrue(
            description_is_richer(
                website_about,
                telegram_ad,
                new_source="website",
                current_source="existing",
            )
        )

    def test_bfs_merge_keeps_richest(self) -> None:
        found: dict = {}
        _merge_fill_empty(
            found,
            {"description": SHORT_ROP, "_kind": "source"},
        )
        self.assertEqual(found.get("_description_source"), "source")
        _merge_fill_empty(
            found,
            {"description": RICH_SITE, "_kind": "website"},
        )
        self.assertIn("Invisalign", found.get("description") or "")
        self.assertEqual(found.get("_description_source"), "website")
        # A weaker later source must not overwrite.
        _merge_fill_empty(
            found,
            {"description": SHORT_ROP, "_kind": "yelp"},
        )
        self.assertIn("Invisalign", found.get("description") or "")
        self.assertEqual(found.get("_description_source"), "website")


if __name__ == "__main__":
    raise SystemExit(
        0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1
    )
