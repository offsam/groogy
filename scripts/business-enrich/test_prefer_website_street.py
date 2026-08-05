#!/usr/bin/env python3
"""Own-website street beats telegram glue.

Run: python3 scripts/business-enrich/test_prefer_website_street.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from address_geo import prefer_own_website_street, street_identity  # noqa: E402
from enrich_resource_queue import _merge_fill_empty  # noqa: E402


class PreferWebsiteStreetTests(unittest.TestCase):
    def test_identity_ignores_ave_vs_avenue(self) -> None:
        self.assertEqual(
            street_identity("237 Ocean Ave"),
            street_identity("237 Ocean Avenue"),
        )

    def test_party_glue_loses_to_shop(self) -> None:
        self.assertTrue(
            prefer_own_website_street(
                "237 Ocean Ave",
                "4695 MacArthur Ct 11th Floor",
            )
        )

    def test_same_street_kept(self) -> None:
        self.assertFalse(
            prefer_own_website_street(
                "4695 MacArthur Court",
                "4695 MacArthur Ct",
            )
        )

    def test_empty_existing_takes_website(self) -> None:
        self.assertTrue(
            prefer_own_website_street(None, "15052 Red Hill Ave")
        )

    def test_stub_website_does_not_wipe_full_line(self) -> None:
        self.assertFalse(
            prefer_own_website_street(
                "2605 U.S. 130, Cinnaminson, NJ, USA",
                "7213 truck drive",
            )
        )

    def test_full_website_replaces_different_city_line(self) -> None:
        self.assertTrue(
            prefer_own_website_street(
                "2605 U.S. 130, Cinnaminson, NJ, USA",
                "7213 Truck Drive, Riverside, CA 92504",
            )
        )

    def test_merge_website_overwrites_source_glue(self) -> None:
        found: dict = {}
        _merge_fill_empty(
            found,
            {
                "_kind": "source",
                "address_line": "237 Ocean Ave",
                "address": "237 Ocean Ave, Laguna Beach",
            },
        )
        self.assertEqual(found.get("address_line"), "237 Ocean Ave")
        _merge_fill_empty(
            found,
            {
                "_kind": "website",
                "address_line": "4695 MacArthur Ct",
                "address": "4695 MacArthur Ct, Newport Beach, CA 92660",
            },
        )
        self.assertEqual(found.get("address_line"), "4695 MacArthur Ct")
        self.assertEqual(found.get("_address_source"), "website")


if __name__ == "__main__":
    unittest.main()
