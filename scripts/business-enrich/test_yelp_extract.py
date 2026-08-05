#!/usr/bin/env python3
"""Yelp biz extract — JSON-LD profile (no live network required).

Run: python3 scripts/business-enrich/test_yelp_extract.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from yelp_extract import (  # noqa: E402
    extract_yelp_rating,
    normalize_yelp_url,
    parse_yelp_biz_html,
)

FIXTURE = """<!DOCTYPE html><html><head>
<meta property="og:title" content="Dance Code Ballroom Studio - Laguna Woods, CA" />
<meta property="og:description" content="Ballroom dance lessons for adults and kids in Laguna Woods." />
<meta property="og:image" content="https://s3-media0.fl.yelpcdn.com/bphoto/example/o.jpg" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Dance Code Ballroom Studio",
  "telephone": "+1-949-878-6463",
  "url": "https://dancecodeballroom.com",
  "image": "https://s3-media0.fl.yelpcdn.com/bphoto/example/o.jpg",
  "description": "Ballroom dance lessons for adults and kids in Laguna Woods.",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "23572 Moulton Pkwy Ste 102-104",
    "addressLocality": "Laguna Woods",
    "addressRegion": "CA",
    "postalCode": "92637"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": 5.0,
    "reviewCount": 9
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "10:00",
      "closes": "22:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": "Saturday",
      "opens": "10:00",
      "closes": "18:00"
    }
  ]
}
</script>
</head><body><a href="tel:+19498786463">Call</a></body></html>
"""


class YelpExtractTests(unittest.TestCase):
    def test_normalize_biz_url(self) -> None:
        self.assertEqual(
            normalize_yelp_url(
                "https://www.yelp.com/biz/dance-code-ballroom-studio-laguna-woods?osq=dance"
            ),
            "https://www.yelp.com/biz/dance-code-ballroom-studio-laguna-woods",
        )
        self.assertIsNone(normalize_yelp_url("https://dancecodeballroom.com"))

    def test_parse_fixture_profile(self) -> None:
        out = parse_yelp_biz_html(
            FIXTURE,
            "https://www.yelp.com/biz/dance-code-ballroom-studio-laguna-woods",
        )
        self.assertEqual(out["_status"], "ok")
        self.assertEqual(out["phone"], "+19498786463")
        self.assertEqual(out["city"], "Laguna Woods")
        self.assertIn("Moulton", out["address_line"] or "")
        self.assertEqual(out["postal_code"], "92637")
        self.assertEqual(out["website"], "https://dancecodeballroom.com")
        self.assertEqual(out["yelp_rating"], 5.0)
        self.assertEqual(out["yelp_reviews_count"], 9)
        self.assertIsNotNone(out.get("opening_hours"))
        weekly = out["opening_hours"]["weekly"]
        monday = next(d for d in weekly if d["day"] == 1)
        self.assertEqual(monday.get("open"), "10:00")
        self.assertEqual(monday.get("close"), "22:00")
        self.assertIn("https://dancecodeballroom.com", out["discovered_urls"])

    def test_rating_helper(self) -> None:
        rating, count, src = extract_yelp_rating(FIXTURE)
        self.assertEqual(rating, 5.0)
        self.assertEqual(count, 9)
        self.assertTrue(src)


if __name__ == "__main__":
    raise SystemExit(
        0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1
    )
