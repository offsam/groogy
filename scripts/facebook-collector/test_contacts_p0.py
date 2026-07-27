#!/usr/bin/env python3
"""Tests for P0/P1 contact extraction fixes."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from contacts import (  # noqa: E402
    extract_instagram,
    extract_phones,
    extract_telegram,
    extract_websites,
    extract_whatsapp,
)


class ContactExtractionP0Tests(unittest.TestCase):
    def test_telegram_labeled_not_instagram(self) -> None:
        text = "Telegram: @EvgeniiaKogai"
        self.assertEqual(extract_telegram(text), ["evgeniiakogai"])
        self.assertEqual(extract_instagram(text), [])

    def test_instagram_english_label(self) -> None:
        text = "Instagram: andrei_hawaii\nТелефон: +1 (323) 304-5871"
        self.assertEqual(extract_instagram(text), ["andrei_hawaii"])
        self.assertEqual(extract_phones(text), ["+13233045871"])

    def test_uuid_in_url_not_phone(self) -> None:
        text = (
            "Регистрируйся👉 https://www.loveoverse.com/events/"
            "4bf7a2a4-3037-4158-8a63-83c2c0413e05\n"
            "👉 TELEGRAM: t.me/NashiSinglesUSA\n"
            "👉 WHATSAPP:https://rb.gy/1c9jn0\n"
        )
        self.assertEqual(extract_phones(text), [])
        self.assertEqual(extract_telegram(text), ["nashisinglesusa"])
        wa = extract_whatsapp(text)
        self.assertEqual(len(wa), 1)
        self.assertTrue(wa[0].startswith("https://rb.gy/"))
        self.assertNotIn("WHATSAPP:", wa[0])
        webs = extract_websites(text)
        self.assertTrue(any("loveoverse.com" in w for w in webs))
        self.assertFalse(any("rb.gy" in w for w in webs))

    def test_bare_domain_websites(self) -> None:
        text = "tinyurl.com/Yummyevent и loveoverse.com/events/abc"
        webs = extract_websites(text)
        self.assertTrue(any("tinyurl.com/Yummyevent" in w for w in webs))
        self.assertTrue(any("loveoverse.com/events/abc" in w for w in webs))

    def test_two_telegrams_kept(self) -> None:
        text = "t.me/NashiSinglesUSA and t.me/NashuWeekend"
        self.assertEqual(
            extract_telegram(text), ["nashisinglesusa", "nashuweekend"]
        )


if __name__ == "__main__":
    unittest.main()
