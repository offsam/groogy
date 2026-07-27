"""Drift check: EXTRACTION_CLASSIFICATION_CONTRACT_V1 must mirror the code.

Imports the live constants from the source modules and asserts each appears in
the contract document verbatim. Change a pattern in code → change the doc in
the same PR, or CI fails. Run:
  python3 scripts/import-review/test_extraction_contract.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))

DOC = (
    ROOT / "docs" / "architecture" / "pipeline" / "EXTRACTION_CLASSIFICATION_CONTRACT_V1.md"
).read_text(encoding="utf-8")

failures: list[str] = []


def must_contain(label: str, needle: str) -> None:
    if needle not in DOC:
        failures.append(f"{label}: not found in contract doc: {needle[:80]!r}")


import re as _re


def _doc_pattern(label: str) -> str | None:
    """Reconstruct a regex from the doc: find `LABEL = re.compile(`, join the
    quoted fragments up to the block end (adjacent-literal concatenation,
    exactly like Python does)."""
    m = _re.search(rf"{label} = re\.compile\((.*?)(?:^```|\)\s*$)", DOC, _re.S | _re.M)
    if not m:
        return None
    return "".join(_re.findall(r'r?"((?:[^"\\]|\\.)*)"', m.group(1)))


def check_regex(label: str, pattern_obj) -> None:
    doc_pat = _doc_pattern(label)
    if doc_pat is None:
        failures.append(f"{label}: definition block not found in contract doc")
    elif doc_pat != pattern_obj.pattern:
        failures.append(
            f"{label}: doc pattern differs from code\n"
            f"    doc:  {doc_pat[:90]!r}\n    code: {pattern_obj.pattern[:90]!r}"
        )


def main() -> int:
    import contacts
    import names
    import common as ir_common
    import reviewer
    import facebook_decision_policy as fbp
    import enrich_published_businesses as epb
    import run_enrichment_pipeline as rep

    check_regex("PHONE_RE", contacts.PHONE_RE)
    check_regex("EMAIL_RE", contacts.EMAIL_RE)
    check_regex("INSTAGRAM_URL_RE", contacts.INSTAGRAM_URL_RE)
    check_regex("INSTAGRAM_LABELED_RE", contacts.INSTAGRAM_LABELED_RE)
    check_regex("INSTAGRAM_HANDLE_RE", contacts.INSTAGRAM_HANDLE_RE)
    check_regex("WEBSITE_RE", contacts.WEBSITE_RE)
    check_regex("BARE_WEBSITE_RE", contacts.BARE_WEBSITE_RE)
    check_regex("GREETING_BLOCKLIST", names.GREETING_BLOCKLIST)

    check_regex("LECHU_RE", reviewer.LECHU_RE)
    check_regex("TRANSFER_RE", reviewer.TRANSFER_RE)
    check_regex("REAL_ESTATE_OFFER_RE", fbp.REAL_ESTATE_OFFER_RE)
    check_regex("JOB_HIRE_RE", fbp.JOB_HIRE_RE)
    check_regex("MARKETPLACE_RE", fbp.MARKETPLACE_RE)
    check_regex("EVENT_RE", fbp.EVENT_RE)
    check_regex("BUSINESS_SIGNAL_RE", fbp.BUSINESS_SIGNAL_RE)
    check_regex("SPECIALIST_SIGNAL_RE", fbp.SPECIALIST_SIGNAL_RE)

    for name in (
        "HIGH_CONFIDENCE_MIN",
        "COMPLETE_CARD_CONFIDENCE_MIN",
        "COMPLETE_CARD_DESCRIPTION_MIN",
        "MARKETPLACE_MAX_AGE_DAYS",
        "RENTAL_MAX_AGE_DAYS",
        "JOB_EVENT_MAX_AGE_DAYS",
    ):
        must_contain(name, f"{name} = {getattr(ir_common, name)}")

    for host in epb.JUNK_HOST_PARTS:
        must_contain("JUNK_HOST_PARTS", host)
    for host in rep.PLATFORM_HOSTS:
        must_contain("PLATFORM_HOSTS", host)

    if failures:
        print(f"FAIL: contract doc drifted from code ({len(failures)} items):")
        for f in failures[:20]:
            print("  -", f)
        return 1
    print("OK: contract doc mirrors all live extraction/classification constants")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
