from __future__ import annotations

import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_profile_avatar import self_promo_avatar_target


class TelegramProfileAvatarTargetTest(unittest.TestCase):
    def test_matching_author_and_contact_handle_is_self_promo(self) -> None:
        target, reason = self_promo_avatar_target(
            {
                "source": "telegram",
                "source_author_username": "beata_in_america",
                "telegram_username": "beata_in_america",
            }
        )
        self.assertIsNotNone(target)
        self.assertEqual(reason, "author_is_contact")

    def test_matching_author_name_is_self_promo(self) -> None:
        target, reason = self_promo_avatar_target(
            {
                "source": "telegram",
                "source_author_id": "123",
                "source_author_display_name": "Беата Иванова",
                "person_name": "Беата Иванова — переводчик",
            }
        )
        self.assertIsNotNone(target)
        self.assertEqual(reason, "author_name_matches_card")

    def test_direct_ad_signal_requires_known_author(self) -> None:
        target, reason = self_promo_avatar_target(
            {
                "source": "telegram",
                "ai_reason": "The post is a direct advertisement by the sender.",
            }
        )
        self.assertIsNone(target)
        self.assertEqual(reason, "self_promo_not_confirmed")

    def test_third_party_recommender_is_rejected(self) -> None:
        target, reason = self_promo_avatar_target(
            {
                "source": "telegram",
                "source_author_id": "123",
                "source_author_display_name": "Мария",
                "person_name": "Беата",
                "ai_reason": "Recommendation for a translator.",
            }
        )
        self.assertIsNone(target)
        self.assertEqual(reason, "self_promo_not_confirmed")

    def test_existing_card_image_is_never_replaced(self) -> None:
        target, reason = self_promo_avatar_target(
            {
                "source": "telegram",
                "preview_image_url": "https://example.com/photo.jpg",
                "source_author_id": "123",
                "ai_reason": "direct advertisement by sender",
            }
        )
        self.assertIsNone(target)
        self.assertEqual(reason, "image_exists")


if __name__ == "__main__":
    unittest.main()
