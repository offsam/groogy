#!/usr/bin/env python3
"""Fetch homepage profile JSON for recommendation / queue enrich (stdout)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "facebook-collector"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))

from web_enrichment import extract_website_profile  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    args = ap.parse_args()
    profile = extract_website_profile(args.url) or {}
    print(json.dumps(profile, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
