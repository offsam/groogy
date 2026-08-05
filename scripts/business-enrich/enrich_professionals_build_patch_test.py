#!/usr/bin/env python3
"""Professional enrich build_patch contracts (Avagyan-like fill-empty + conflicts).

Run: python3 scripts/business-enrich/enrich_professionals_build_patch_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent / "import-review"))
sys.path.insert(0, str(ROOT.parent / "telegram-collector"))
sys.path.insert(0, str(ROOT.parent / "facebook-collector"))

from enrich_professionals_card_first import build_patch  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


AVAGYAN_TG = (
    "Как и обещали, выкладываем запись эфира с иммиграционным адвокатом "
    "Антоном Всеволодовым 👇 Разобрали темы, которые сейчас волнуют очень "
    "многих: - habeas corpus и практические условия его применения"
)
AVAGYAN_SHORT = (
    'display" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAY'
    "CAMAAADXqc3KAAAAOVBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
)
SITE_BIO = (
    "Avagyan Law — иммиграционные адвокаты в Калифорнии. "
    "Помогаем с визами, грин-картами и защитой в суде."
)

# Weak TG description → auto-replace from website; short garbage → replace.
pro_weak = {
    "description": AVAGYAN_TG,
    "short_description": AVAGYAN_SHORT,
    "private_address_line": None,
    "website": "https://avagyanlaw.com",
    "phone": "+19169999909",
    "email": "contact@avagyanlaw.com",
    "city": "Sacramento",
    "postal_code": None,
    "opening_hours": None,
}
found_site = {
    "description": SITE_BIO,
    "address_line": "600 N Brand Blvd Ste 570, Glendale, CA 91203",
    "_address_source": "website",
    "city": "Glendale",
    "postal_code": "91203",
    "phone": "+19169000090",
    "hours": "Mon-Fri 9am-5pm",
    "website": "https://avagyanlaw.com",
}
patch, conflicts = build_patch(pro_weak, found_site)
assert_true(
    patch.get("description") == SITE_BIO,
    f"weak TG desc should auto-replace, got {patch.get('description')!r}",
)
assert_true(
    isinstance(patch.get("short_description"), str)
    and patch["short_description"].startswith("Avagyan Law"),
    f"garbage short should replace, got {patch.get('short_description')!r}",
)
assert_true(
    "Brand" in str(patch.get("private_address_line") or ""),
    f"empty street should fill from website, got {patch.get('private_address_line')!r}",
)
assert_true(
    patch.get("postal_code") == "91203",
    f"ZIP should fill without CA-only filter, got {patch.get('postal_code')!r}",
)
assert_true(
    isinstance(patch.get("opening_hours"), dict),
    f"hours should fill opening_hours, got {patch.get('opening_hours')!r}",
)
assert_true(
    any(c.get("key") == "phone" for c in conflicts),
    f"different phone should conflict, got {conflicts!r}",
)

# Existing strong street + different website street → address conflict, no silent overwrite.
pro_filled = {
    **pro_weak,
    "description": SITE_BIO,  # already good
    "short_description": "Иммиграционный адвокат",
    "private_address_line": "100 Main St",
    "opening_hours": {"weekday_text": ["closed"]},
}
found_other = {
    "description": SITE_BIO + " Офисы в Glendale и Sacramento.",
    "address_line": "600 N Brand Blvd Ste 570",
    "_address_source": "website",
    "city": "Glendale",
    "postal_code": "75201",  # TX-style ZIP — must still be valid when empty
    "hours": "Open 24 hours",
}
patch2, conflicts2 = build_patch(pro_filled, found_other)
assert_true(
    "private_address_line" not in patch2,
    "existing street must not silent-overwrite",
)
assert_true(
    any(c.get("key") == "address_line" for c in conflicts2),
    f"different street must conflict, got {conflicts2!r}",
)
assert_true(
    any(c.get("key") == "description" for c in conflicts2),
    f"different strong description must conflict, got {conflicts2!r}",
)
assert_true(
    "opening_hours" not in patch2,
    "existing opening_hours must stay (fill-empty)",
)

# Empty ZIP + non-CA ZIP from found
pro_no_zip = {
    "description": SITE_BIO,
    "short_description": SITE_BIO[:80],
    "private_address_line": "600 N Brand Blvd",
    "postal_code": None,
    "opening_hours": {"weekday_text": ["x"]},
}
found_tx = {
    "address_line": "600 N Brand Blvd",
    "_address_source": "website",
    "postal_code": "75201",
}
patch3, _ = build_patch(pro_no_zip, found_tx)
assert_true(
    patch3.get("postal_code") == "75201",
    f"non-CA ZIP must fill when empty, got {patch3.get('postal_code')!r}",
)

print("OK: enrich_professionals build_patch contracts")
