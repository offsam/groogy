#!/usr/bin/env python3
"""Unit tests for ready_to_publish_gate."""

from __future__ import annotations

import unittest

from ready_to_publish_gate import (
    is_unusable_ready_title,
    qualifies_ready_to_publish,
    status_after_ready_gate,
)


class TitleTests(unittest.TestCase):
    def test_username_and_dump(self) -> None:
        self.assertTrue(is_unusable_ready_title(""))
        self.assertTrue(is_unusable_ready_title("S"))
        self.assertTrue(is_unusable_ready_title("makeupme_sasha"))
        self.assertTrue(is_unusable_ready_title("Sasha makeupme_sasha"))
        dump = (
            "Ищу мастера по наращиванию ресниц в Irvine на выходные, "
            "пишите в личку если можете принять завтра утром, очень срочно "
            "нужно к празднику и ещё куча текста объявления целиком"
        )
        self.assertTrue(is_unusable_ready_title(dump))
        self.assertFalse(
            is_unusable_ready_title(
                "Саша, визажист",
                description="Саша делает макияж в Irvine.",
            )
        )


class GateTests(unittest.TestCase):
    def test_phone_or_city(self) -> None:
        ok, _ = qualifies_ready_to_publish(
            {"title": "Саша, визажист", "phone": ["+19495551212"], "city": None}
        )
        self.assertTrue(ok)
        ok, reason = qualifies_ready_to_publish(
            {"title": "Саша, визажист", "phone": [], "city": ""}
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "no_phone_or_city")

    def test_duplicate_and_junk_title(self) -> None:
        ok, reason = qualifies_ready_to_publish(
            {
                "title": "Саша, визажист",
                "phone": ["+19495551212"],
                "duplicate_status": "likely_duplicate",
            }
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "duplicate")
        ok, reason = qualifies_ready_to_publish(
            {
                "title": "Sasha makeupme_sasha",
                "phone": ["+19495551212"],
                "city": "Irvine",
            }
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "unusable_title")

    def test_status_mapping(self) -> None:
        row = {
            "title": "Саша, визажист",
            "phone": ["+19495551212"],
            "city": "Irvine",
        }
        self.assertEqual(status_after_ready_gate(row, "pending"), "pending")
        self.assertEqual(
            status_after_ready_gate(row, "pending", prefer_ready=True),
            "ready_to_publish",
        )
        self.assertEqual(
            status_after_ready_gate(
                {"title": "Саша, визажист", "phone": [], "city": ""},
                "ready_to_publish",
            ),
            "needs_more_info",
        )
        self.assertEqual(
            status_after_ready_gate({"title": "x"}, "rejected"),
            "rejected",
        )


if __name__ == "__main__":
    unittest.main()
