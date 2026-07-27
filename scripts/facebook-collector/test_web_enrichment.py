#!/usr/bin/env python3
"""Tests for website/Instagram enrichment merge rules (offline)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from web_enrichment import (  # noqa: E402
    SOURCE_INSTAGRAM,
    SOURCE_WEBSITE,
    enrich_from_website_instagram,
    merge_web_enrichment,
    merge_website_profiles,
    website_fetch_candidates,
)



class WebEnrichmentTests(unittest.TestCase):
    def test_merge_does_not_overwrite_post_phone(self) -> None:
        entity = {
            "entity_type": "business",
            "phone": ["+13235550100"],
            "website": ["https://example.com"],
            "email": [],
            "description": None,
        }
        website_data = {
            "status": "ok",
            "name": "Example Co",
            "description": "About example",
            "phone": ["+19999999999"],
            "email": ["hi@example.com"],
            "address": "LA, CA",
            "hours": "Mon-Fri 9-5",
            "logo": "https://example.com/logo.png",
            "social_links": ["https://instagram.com/exampleco"],
        }
        out, web_applied, ig_applied = merge_web_enrichment(
            entity, website_data=website_data, instagram_data=None
        )
        self.assertEqual(out["phone"], ["+13235550100"])
        self.assertEqual(out["email"], ["hi@example.com"])
        self.assertEqual(out["description"], "About example")
        self.assertEqual(out["business_name"], "Example Co")
        self.assertEqual(out["field_sources"]["email"], SOURCE_WEBSITE)
        self.assertNotIn("phone", web_applied)
        self.assertIn("email", web_applied)
        self.assertEqual(ig_applied, [])

    def test_instagram_fills_empty_bio_and_avatar(self) -> None:
        entity = {
            "entity_type": "private_specialist",
            "person_name": None,
            "description": None,
            "instagram": ["kogai"],
            "website": [],
        }
        ig = {
            "status": "ok",
            "username": "kogai",
            "name": "Evgeniia Kogai",
            "bio": "Psychologist · online",
            "website": "https://kogai.example",
            "category": "Health/beauty",
            "avatar": "https://instagram.com/avatar.jpg",
        }
        out, web_applied, ig_applied = merge_web_enrichment(
            entity, website_data=None, instagram_data=ig
        )
        self.assertEqual(out["person_name"], "Evgeniia Kogai")
        self.assertEqual(out["description"], "Psychologist · online")
        self.assertEqual(out["website"], ["https://kogai.example"])
        self.assertEqual(out["field_sources"]["description"], SOURCE_INSTAGRAM)
        self.assertIn("instagram_avatar", out)
        self.assertTrue(ig_applied)
        self.assertEqual(web_applied, [])

    def test_enrich_posts_handles_fetch_failure(self) -> None:
        posts = [
            {
                "extracted_entity": {
                    "entity_type": "business",
                    "website": ["https://this-domain-should-fail.invalid"],
                    "instagram": [],
                    "phone": [],
                }
            }
        ]
        with patch(
            "web_enrichment.extract_website_profile",
            return_value={"status": "unavailable", "error": "fetch_failed", "source": "website"},
        ):
            stats = enrich_from_website_instagram(posts, enabled=True)
        self.assertEqual(stats["website_enriched"], 0)
        self.assertEqual(stats["errors"], 0)

    def test_enrich_disabled(self) -> None:
        stats = enrich_from_website_instagram([{}], enabled=False)
        self.assertFalse(stats["enabled"])

    def test_website_fetch_candidates_include_origin(self) -> None:
        c = website_fetch_candidates(
            "https://yougenius.coach/p/french-for-beginners/"
        )
        self.assertEqual(c[0], "https://yougenius.coach/p/french-for-beginners/")
        self.assertIn("https://yougenius.coach/", c)

    def test_merge_website_profiles_fills_email_from_origin(self) -> None:
        deep = {
            "status": "ok",
            "url": "https://yougenius.coach/p/french/",
            "name": "Course",
            "email": [],
            "phone": [],
            "description": "deep",
        }
        origin = {
            "status": "ok",
            "url": "https://yougenius.coach/",
            "name": "yougenius.coach",
            "email": ["yougenius.coach@gmail.com"],
            "phone": ["+18184542222"],
            "description": "home",
        }
        merged = merge_website_profiles(deep, origin)
        assert merged is not None
        self.assertEqual(merged["email"], ["yougenius.coach@gmail.com"])
        self.assertEqual(merged["description"], "deep")


if __name__ == "__main__":
    unittest.main()
