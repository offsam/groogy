#!/usr/bin/env python3
"""Street abbrev Str. + Google Maps embed address.

Run: python3 scripts/facebook-collector/test_address_str_abbrev.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from web_enrichment import (  # noqa: E402
    ADDRESS_LINE_RE,
    _address_from_google_maps_embed,
    extract_address_text,
)


class StreetAbbrevTests(unittest.TestCase):
    def test_str_abbrev_matches(self) -> None:
        self.assertTrue(
            ADDRESS_LINE_RE.search("1718 E 15 Str. Brooklyn, NY 11229")
        )

    def test_maps_embed_decoded(self) -> None:
        html = (
            '<iframe src="https://maps.google.com/maps?…'
            '!2s1718+E+15th+St%2C+Brooklyn%2C+NY+11229%2C+USA!5e0"></iframe>'
        )
        hit = _address_from_google_maps_embed(html)
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertIn("Brooklyn", hit)
        self.assertIn("11229", hit)

    def test_extract_prefers_embed_over_str_footer(self) -> None:
        html = """
        <html><body>
        <p>1718 E 15 Str. Brooklyn, NY 11229</p>
        <iframe src="https://www.google.com/maps/embed?pb=!1m18!2s1718+E+15th+St%2C+Brooklyn%2C+NY+11229%2C+USA!5e0"></iframe>
        </body></html>
        """
        addr = extract_address_text(html, None)
        self.assertIsNotNone(addr)
        assert addr is not None
        self.assertIn("15th", addr)
        self.assertIn("Brooklyn", addr)


if __name__ == "__main__":
    raise SystemExit(
        0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1
    )
