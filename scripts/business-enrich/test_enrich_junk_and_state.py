#!/usr/bin/env python3
"""Junk email/image + state align when filling street.

Run: python3 scripts/business-enrich/test_enrich_junk_and_state.py
"""
from __future__ import annotations
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from enrich_published_businesses import (  # noqa: E402
    apply_parsed_address_fields,
    is_junk_email,
    is_junk_image_url,
    parse_address_parts,
)
from completeness_score import clean_enrich_description  # noqa: E402


class EnrichJunkStateTests(unittest.TestCase):
    def test_junk_email(self) -> None:
        self.assertTrue(is_junk_email("user@domain.com"))
        self.assertTrue(is_junk_email("test@example.com"))
        self.assertTrue(is_junk_email("email@email.com"))
        self.assertFalse(is_junk_email("olga@olgamiljko.com"))

    def test_junk_image(self) -> None:
        self.assertTrue(
            is_junk_image_url(
                "https://assets.squarespace.com/universal/default-favicon.ico"
            )
        )
        self.assertFalse(is_junk_image_url("https://cdn.example.com/a.jpg"))

    def test_new_street_overrides_wrong_state(self) -> None:
        parts = parse_address_parts("8101 Biscayne BLVD #609, Miami FL 33138")
        report = {"patch": {"address_line": parts["address_line"]}, "sources": {}}
        biz = {
            "city": "Miami",
            "state_code": "US-CA",
            "region": None,
            "postal_code": None,
            "address_line": None,
        }
        apply_parsed_address_fields(
            report,
            biz,
            parts,
            street_written=True,
            street_replaced=False,
            source="website",
        )
        self.assertEqual(report["patch"]["state_code"], "US-FL")
        self.assertEqual(report["patch"]["postal_code"], "33138")
        self.assertEqual(report["patch"]["region"], "FL 33138")

    def test_clean_description_dedupe_chrome(self) -> None:
        raw = (
            "Фотограф Olga Miljko - я являюсь профессионалом, владеющими всеми "
            "техническими средствами, необходимыми для осуществления успешной "
            "фотосессии и создания стильных образов, которые отвечают самым "
            "высоким требованиям. Предоставляю широкий спектр услуг: студийная "
            "фотосессия, фотосесс\n\n"
            "Фотограф Olga Miljko - я являюсь профессионалом, владеющими всеми "
            "техническими средствами, необходимыми для осуществления успешной "
            "фотосессии и создания стильных образов, которые отвечают самым "
            "высоким требованиям. Предоставляю широкий спектр услуг: студийная "
            "фотосессия, фотосессия на выезде. ПОРТРЕТЫ ДЛЯ МИРА Клиентские "
            "проекты Красота Мода Портреты Текущая страница:Плавание Свяжитесь со мной"
        )
        cleaned = clean_enrich_description(raw) or ""
        self.assertEqual(cleaned.count("Фотограф Olga"), 1)
        self.assertNotIn("Текущая страница", cleaned)
        self.assertNotIn("ПОРТРЕТЫ", cleaned)


    def test_geocode_reconciles_hub_ca_via_zip(self) -> None:
        from address_geo import reconcile_state_code, resolve_address_geo

        self.assertEqual(
            reconcile_state_code("US-CA", "33138", "FL 33138", network=False),
            "US-FL",
        )
        geo = resolve_address_geo(
            "8101 Biscayne BLVD #609",
            "Miami",
            "US-CA",
            "33138",
            region="FL 33138",
            throttle=False,
        )
        self.assertTrue(geo.ok)
        self.assertEqual(geo.patch.get("state_code"), "US-FL")
        self.assertEqual(geo.patch.get("location_precision"), "street")
        # Miss must not spam location_precision=None into the enrich patch.
        miss = resolve_address_geo(
            "1 Not A Real Streetzzzz",
            "Nowhere",
            "US-CA",
            "00000",
            throttle=False,
        )
        self.assertFalse(miss.ok)
        self.assertNotIn("location_precision", miss.patch)


if __name__ == "__main__":
    raise SystemExit(
        0 if unittest.main(verbosity=2, exit=False).result.wasSuccessful() else 1
    )
