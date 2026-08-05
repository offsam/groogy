#!/usr/bin/env python3
"""Address parse + bogus ROP city=Orange regressions.

Run: python3 scripts/business-enrich/test_address_parse_orange.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from enrich_published_businesses import (  # noqa: E402
    city_is_bogus,
    parse_address_parts,
    scraped_address,
)
from enrich_resource_queue import sanitize_street_line  # noqa: E402


class AddressParseOrangeTests(unittest.TestCase):
    def test_orange_city_is_bogus(self) -> None:
        self.assertTrue(city_is_bogus("Orange"))
        self.assertTrue(city_is_bogus("orange county"))
        self.assertTrue(city_is_bogus("Ste."))
        self.assertFalse(city_is_bogus("Lake Forest"))
        self.assertFalse(city_is_bogus("Irvine"))

    def test_dangling_ste_not_kept_as_street_city(self) -> None:
        raw = "25 Spectrum Pointe Drive, Ste."
        self.assertEqual(sanitize_street_line(raw), "25 Spectrum Pointe Drive")
        street, parts = scraped_address(raw)
        self.assertEqual(street, "25 Spectrum Pointe Drive")
        self.assertNotEqual(parts.get("city"), "Ste.")
        self.assertTrue(city_is_bogus(parts.get("city")) or parts.get("city") is None)

    def test_full_church_address(self) -> None:
        raw = "25 Spectrum Pointe Drive, Ste. 403, Lake Forest, CA 92630"
        parts = parse_address_parts(raw)
        self.assertIn("Spectrum Pointe", parts.get("address_line") or "")
        self.assertIn("403", parts.get("address_line") or "")
        self.assertEqual(parts.get("city"), "Lake Forest")
        self.assertEqual(parts.get("state_code"), "US-CA")
        self.assertEqual(parts.get("postal_code"), "92630")

    def test_church_address_without_comma_before_city(self) -> None:
        raw = "25 Spectrum Pointe Drive, Ste. 403 Lake Forest, CA 92630"
        parts = parse_address_parts(raw)
        self.assertEqual(parts.get("city"), "Lake Forest")
        self.assertEqual(parts.get("postal_code"), "92630")
        self.assertIn("403", parts.get("address_line") or "")


if __name__ == "__main__":
    raise SystemExit(
        0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1
    )
