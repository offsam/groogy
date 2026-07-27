#!/usr/bin/env python3
"""Tests for Facebook profile enrichment (no network)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
for p in (HERE,):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from profile_enrichment import (  # noqa: E402
    SOURCE_TAG,
    discover_profile_urls,
    enrich_analyzed_posts,
    merge_profile_into_entity,
    normalize_page_actor_row,
    profile_from_actor_user,
)


class ProfileEnrichmentTests(unittest.TestCase):
    def test_discover_page_url_from_text(self) -> None:
        urls = discover_profile_urls(
            text="Пишите нам https://www.facebook.com/NashiConnectUSA и в Direct"
        )
        self.assertTrue(any("NashiConnectUSA" in u for u in urls))

    def test_skip_group_and_permalink(self) -> None:
        urls = discover_profile_urls(
            text=(
                "https://www.facebook.com/groups/RussianinLosAngeles/permalink/123 "
                "https://facebook.com/photo/?fbid=1"
            )
        )
        self.assertEqual(urls, [])

    def test_numeric_author_id(self) -> None:
        urls = discover_profile_urls(text="", author_id="100001943954861")
        self.assertEqual(
            urls, ["https://facebook.com/profile.php?id=100001943954861"]
        )

    def test_skip_pfbid(self) -> None:
        urls = discover_profile_urls(text="", author_id="pfbid02Lgcg6FLA")
        self.assertEqual(urls, [])

    def test_merge_does_not_overwrite(self) -> None:
        entity = {
            "phone": ["+13235550100"],
            "website": [],
            "email": [],
            "entity_type": "business",
        }
        profile = {
            "phone": ["+19999999999"],
            "website": ["https://example.com"],
            "email": ["a@example.com"],
            "name": "Demo Biz",
            "description": "About us",
        }
        out, applied = merge_profile_into_entity(entity, profile)
        self.assertEqual(out["phone"], ["+13235550100"])
        self.assertEqual(out["website"], ["https://example.com"])
        self.assertEqual(out["email"], ["a@example.com"])
        self.assertEqual(out["business_name"], "Demo Biz")
        self.assertEqual(out["field_sources"]["website"], SOURCE_TAG)
        self.assertIn("website", applied)
        self.assertNotIn("phone", applied)

    def test_normalize_page_row(self) -> None:
        row = {
            "title": "Acme Inc",
            "pageUrl": "https://www.facebook.com/acme",
            "phone": "+1 555 0100",
            "email": "hi@acme.example",
            "website": "https://acme.example",
            "address": "LA, CA",
            "categories": ["Local Business"],
            "intro": "We fix things",
            "profileImageUrl": "https://scontent.xx.fbcdn.net/pic.jpg",
        }
        prof = normalize_page_actor_row(row)
        self.assertEqual(prof["source"], SOURCE_TAG)
        self.assertEqual(prof["phone"], ["+1 555 0100"])
        self.assertTrue(prof["photos"])

    def test_enrich_posts_local_only_no_crash(self) -> None:
        posts = [
            {
                "source": "facebook",
                "merged_text": "Услуги. https://www.facebook.com/SomeBizPage",
                "extracted_entity": {
                    "entity_type": "business",
                    "phone": [],
                    "website": [],
                    "email": [],
                },
                "adapter_raw_slim": {
                    "user": {
                        "id": "100001943954861",
                        "name": "Some Biz",
                        "profilePic": "https://scontent.xx.fbcdn.net/a.jpg",
                    }
                },
            }
        ]
        stats = enrich_analyzed_posts(posts, enabled=True, fetch_remote=False)
        self.assertGreaterEqual(stats["candidates"], 1)
        self.assertTrue(posts[0].get("enrichments"))
        self.assertEqual(posts[0]["enrichments"][0]["source"], SOURCE_TAG)
        # Local author snapshot should land
        entity = posts[0]["extracted_entity"]
        self.assertTrue(
            entity.get("facebook_profile_photos")
            or entity.get("business_name")
            or posts[0]["enrichments"][0].get("data")
        )

    def test_actor_user_snapshot(self) -> None:
        data = profile_from_actor_user(
            {"id": "12345", "name": "Ada", "profilePic": "https://x/y.jpg"}
        )
        self.assertEqual(data["source"], SOURCE_TAG)
        self.assertEqual(data["name"], "Ada")
        self.assertTrue(data["photos"])


if __name__ == "__main__":
    unittest.main()
