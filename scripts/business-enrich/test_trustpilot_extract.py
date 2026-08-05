#!/usr/bin/env python3
"""Unit tests for trustpilot_extract (no live network)."""

from __future__ import annotations

import unittest

from trustpilot_extract import (
    extract_trustpilot_rating,
    normalize_trustpilot_url,
)

FIXTURE = """
<html><head>
<script type="application/ld+json">
{"@type":"Organization","name":"Start CDL",
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"3.7","reviewCount":"1"}}
</script>
</head>
<body>
<img alt="TrustScore 3.5 out of 5" />
<span>3.7</span>
</body></html>
"""

TRUSTSCORE_ONLY = """
<html><body>
<p>TrustScore 4.2 out of 5</p>
<a>Reviews 16</a>
</body></html>
"""


class TrustpilotExtractTests(unittest.TestCase):
    def test_normalize_review_url(self) -> None:
        self.assertEqual(
            normalize_trustpilot_url(
                "https://www.trustpilot.com/review/startcdl.com?utm=1"
            ),
            "https://www.trustpilot.com/review/startcdl.com",
        )
        self.assertEqual(
            normalize_trustpilot_url("https://uk.trustpilot.com/review/startcdl.com"),
            "https://www.trustpilot.com/review/startcdl.com",
        )
        self.assertIsNone(normalize_trustpilot_url("https://yelp.com/biz/x"))

    def test_json_ld_rating(self) -> None:
        rating, count, src = extract_trustpilot_rating(FIXTURE)
        self.assertEqual(rating, 3.7)
        self.assertEqual(count, 1)
        self.assertEqual(src, "json_ld_aggregate")

    def test_trustscore_text(self) -> None:
        rating, count, src = extract_trustpilot_rating(TRUSTSCORE_ONLY)
        self.assertEqual(rating, 4.2)
        self.assertEqual(count, 16)
        self.assertEqual(src, "trustscore_text")


if __name__ == "__main__":
    raise SystemExit(
        0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1
    )
