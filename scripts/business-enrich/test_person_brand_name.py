#!/usr/bin/env python3
"""Mirror of display-name person→brand rules (TS is SoT for live enrich).

Run: python3 scripts/business-enrich/test_person_brand_name.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from audit_fix_entity_names import (  # noqa: E402
    brand_from_description,
    is_person_like_name,
)


CHERRY = (
    "🍒 Червона вишня Склянка вже в European Delights!\n"
    "Друзі, привезли свіжу вишню!\n"
    "📍 European Delights\n"
    "Працюємо щодня: 10-7"
)


class PersonBrandNameTests(unittest.TestCase):
    def test_person_vs_brand(self) -> None:
        self.assertTrue(is_person_like_name("Татьяна Морщук"))
        self.assertFalse(is_person_like_name("European Delights"))

    def test_brand_from_cherry_ad(self) -> None:
        brand = brand_from_description(CHERRY, current="Татьяна Морщук")
        self.assertEqual(brand, "European Delights")


if __name__ == "__main__":
    raise SystemExit(
        0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1
    )
