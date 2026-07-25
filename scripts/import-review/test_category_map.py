#!/usr/bin/env python3
"""Tests for AI category → categories.id mapping."""

from __future__ import annotations

import unittest

from category_map import resolve_category_id

CATS = [
    {"id": "1", "slug": "beauty", "name": "Красота", "is_active": True},
    {"id": "2", "slug": "education", "name": "Образование", "is_active": True},
    {"id": "3", "slug": "auto", "name": "Автосервис", "is_active": True},
    {"id": "4", "slug": "medical", "name": "Медицина", "is_active": True},
    {"id": "5", "slug": "services", "name": "Услуги", "is_active": True},
    {"id": "6", "slug": "restaurants", "name": "Рестораны", "is_active": True},
    {"id": "7", "slug": "legal", "name": "Юристы", "is_active": True},
    {"id": "8", "slug": "fitness", "name": "Спорт и фитнес", "is_active": True},
    {"id": "9", "slug": "pets", "name": "Животные", "is_active": True},
    {"id": "10", "slug": "finance", "name": "Финансы и бухгалтерия", "is_active": True},
    {"id": "11", "slug": "insurance", "name": "Страхование", "is_active": True},
    {"id": "12", "slug": "travel", "name": "Путешествия", "is_active": True},
    {"id": "13", "slug": "events", "name": "Мероприятия", "is_active": True},
    {"id": "14", "slug": "real_estate", "name": "Недвижимость", "is_active": True},
]


class CategoryMapTests(unittest.TestCase):
    def test_fitness_to_fitness(self) -> None:
        r = resolve_category_id("fitness", CATS)
        self.assertEqual(r["category_id"], "8")
        self.assertFalse(r["needs_manual"])

    def test_pet_to_pets(self) -> None:
        r = resolve_category_id("pet_services", CATS)
        self.assertEqual(r["category_id"], "9")

    def test_accounting_to_finance(self) -> None:
        r = resolve_category_id("accounting", CATS)
        self.assertEqual(r["category_id"], "10")

    def test_insurance(self) -> None:
        r = resolve_category_id("insurance", CATS)
        self.assertEqual(r["category_id"], "11")

    def test_real_estate(self) -> None:
        r = resolve_category_id("real_estate_services", CATS)
        self.assertEqual(r["category_id"], "14")

    def test_events_and_travel(self) -> None:
        self.assertEqual(resolve_category_id("events", CATS)["category_id"], "13")
        self.assertEqual(resolve_category_id("travel", CATS)["category_id"], "12")

    def test_cleaning_stays_services(self) -> None:
        r = resolve_category_id("cleaning", CATS)
        self.assertEqual(r["category_id"], "5")

    def test_other_needs_manual(self) -> None:
        r = resolve_category_id("other", CATS)
        self.assertTrue(r["needs_manual"])
        self.assertIsNone(r["category_id"])


if __name__ == "__main__":
    unittest.main()
