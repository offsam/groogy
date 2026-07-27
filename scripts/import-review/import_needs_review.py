#!/usr/bin/env python3
"""Idempotent import of Reviewer v1 needs_review → import_review_items.

Usage:
  python scripts/import-review/import_needs_review.py \\
    --source .../la_orange_county_reviewer_v1.json \\
    --source-key telegram:la_orange_county \\
    --dry-run

  python scripts/import-review/import_needs_review.py ... --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from common import as_list, load_env, map_post

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOC_SOURCE = (
    ROOT
    / "scripts"
    / "telegram-collector"
    / "data"
    / "la_orange_county"
    / "full"
    / "la_orange_county_reviewer_v1.json"
)
FFM_REVIEWER = (
    ROOT
    / "scripts"
    / "telegram-collector"
    / "data"
    / "full"
    / "fun_for_mom_reviewer_v1.json"
)
LOCKED_STATUSES = {"approved", "rejected", "duplicate"}
SOURCE_KEY_LOC = "telegram:la_orange_county"
SOURCE_KEY_FFM = "telegram:fun_for_mom"  # historical rows may still be plain "telegram"


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) < 10:
        return None
    return digits[-11:] if len(digits) >= 11 else digits


def normalize_ig(raw: str) -> str | None:
    value = (raw or "").strip().lstrip("@").lower()
    if "instagram.com/" in value:
        value = value.split("instagram.com/")[-1].split("?")[0].strip("/").split("/")[0]
    value = value.lstrip("@").strip()
    return value or None


def normalize_web(raw: str) -> str | None:
    s = (raw or "").strip().lower()
    if not s:
        return None
    if not s.startswith("http"):
        s = "https://" + s
    try:
        host = (urlparse(s).netloc or "").removeprefix("www.")
        return host or None
    except Exception:
        return None


def content_fingerprint(row: dict[str, Any]) -> str:
    title = (row.get("title") or row.get("business_name") or row.get("person_name") or "")
    title = re.sub(r"\s+", " ", str(title).strip().lower())
    phones = sorted({p for p in (normalize_phone(x) or "" for x in as_list(row.get("phone"))) if p})
    igs = sorted({g for g in (normalize_ig(x) or "" for x in as_list(row.get("instagram"))) if g})
    webs = sorted({w for w in (normalize_web(x) or "" for x in as_list(row.get("website"))) if w})
    return f"{title}|{','.join(phones)}|{','.join(igs)}|{','.join(webs)}"


def has_public_contact(row: dict[str, Any]) -> bool:
    if as_list(row.get("phone")) or as_list(row.get("whatsapp")):
        return True
    if as_list(row.get("instagram")) or as_list(row.get("website")) or as_list(row.get("email")):
        return True
    uname = (row.get("telegram_username") or "").strip().lstrip("@")
    if uname and re.match(r"^[A-Za-z][A-Za-z0-9_]{3,31}$", uname):
        return True
    return False


def only_numeric_tg(row: dict[str, Any]) -> bool:
    if has_public_contact(row):
        return False
    uid = (row.get("telegram_user_id") or row.get("source_author_id") or "").strip()
    return bool(uid and uid.isdigit())


class SupabaseRest:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = service_key

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: Any = None,
        prefer: str | None = None,
    ) -> Any:
        qs = f"?{urllib.parse.urlencode(params)}" if params else ""
        req = urllib.request.Request(
            f"{self.base}{path}{qs}",
            method=method,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                **({"Prefer": prefer} if prefer else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
            raise RuntimeError(f"HTTP {exc.code} {path}: {detail}") from exc

    def fetch_existing(self, fingerprints: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        chunk_size = 80
        for i in range(0, len(fingerprints), chunk_size):
            chunk = fingerprints[i : i + chunk_size]
            values = ",".join(f'"{f}"' for f in chunk)
            rows = self._request(
                "GET",
                "/import_review_items",
                params={
                    "select": "id,source_fingerprint,review_status,updated_at,source",
                    "source_fingerprint": f"in.({values})",
                },
            )
            for row in rows or []:
                out[row["source_fingerprint"]] = row
        return out

    def count_by_source(self, source: str) -> int:
        rows = self._request(
            "GET",
            "/import_review_items",
            params={"select": "id", "source": f"eq.{source}", "limit": "1"},
            prefer="count=exact",
        )
        # Prefer header count — urllib doesn't expose easily; fall back to range fetch
        # Use RPC-less: fetch with Prefer count via raw request
        return self._count("source", f"eq.{source}")

    def _count(self, field: str, op: str) -> int:
        qs = urllib.parse.urlencode({"select": "id", field: op})
        req = urllib.request.Request(
            f"{self.base}/import_review_items?{qs}",
            method="GET",
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Prefer": "count=exact",
                "Range": "0-0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                cr = resp.headers.get("content-range") or resp.headers.get("Content-Range") or ""
                if "/" in cr:
                    tail = cr.split("/")[-1]
                    if tail.isdigit():
                        return int(tail)
        except urllib.error.HTTPError as exc:
            cr = exc.headers.get("content-range") or exc.headers.get("Content-Range") or ""
            if "/" in cr:
                tail = cr.split("/")[-1]
                if tail.isdigit():
                    return int(tail)
        # Fallback: bounded page count (should not be needed for verification)
        rows = self._request(
            "GET",
            "/import_review_items",
            params={"select": "id", field: op, "limit": "10000"},
        )
        return len(rows or [])

    def insert_many(self, rows: list[dict[str, Any]], *, attempts: int = 4) -> list[dict[str, Any]]:
        if not rows:
            return []
        # Strip internal keys
        clean = []
        for r in rows:
            item = {k: v for k, v in r.items() if not k.startswith("_")}
            clean.append(item)
        last_exc: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                created = self._request(
                    "POST",
                    "/import_review_items",
                    body=clean,
                    prefer="return=representation",
                )
                return created or []
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt == attempts:
                    break
                time.sleep(1.5 * attempt)
        assert last_exc is not None
        raise last_exc

    def insert_audit(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        self._request(
            "POST",
            "/import_review_audit",
            body=rows,
            prefer="return=minimal",
        )
        return len(rows)

    def update_pending(self, item_id: str, row: dict[str, Any]) -> None:
        payload = {
            k: v
            for k, v in row.items()
            if k not in {"raw_payload", "review_status", "source_fingerprint"}
            and not k.startswith("_")
        }
        self._request(
            "PATCH",
            "/import_review_items",
            params={"id": f"eq.{item_id}"},
            body=payload,
            prefer="return=minimal",
        )


def load_ffm_contact_indexes() -> dict[str, Any]:
    """Build contact indexes from Fun for Mom reviewer JSON (comparison only, not import)."""
    phones: set[str] = set()
    igs: set[str] = set()
    webs: set[str] = set()
    fps: set[str] = set()
    if not FFM_REVIEWER.is_file():
        return {"phone": phones, "instagram": igs, "website": webs, "fingerprint": fps, "posts": 0}
    data = json.loads(FFM_REVIEWER.read_text(encoding="utf-8"))
    posts = data.get("posts") or []
    for p in posts:
        row = map_post(p, source_key=SOURCE_KEY_FFM)
        for ph in as_list(row.get("phone")):
            n = normalize_phone(ph)
            if n:
                phones.add(n)
        for ig in as_list(row.get("instagram")):
            n = normalize_ig(ig)
            if n:
                igs.add(n)
        for w in as_list(row.get("website")):
            n = normalize_web(w)
            if n:
                webs.add(n)
        fps.add(content_fingerprint(row))
    return {
        "phone": phones,
        "instagram": igs,
        "website": webs,
        "fingerprint": fps,
        "posts": len(posts),
    }


def annotate_cross_group_duplicates(
    rows: list[dict[str, Any]],
    ffm: dict[str, Any],
) -> dict[str, int]:
    stats = {
        "phone": 0,
        "instagram": 0,
        "website": 0,
        "fingerprint": 0,
        "any": 0,
    }
    for row in rows:
        hits: list[str] = []
        for ph in as_list(row.get("phone")):
            n = normalize_phone(ph)
            if n and n in ffm["phone"]:
                hits.append("phone")
                break
        for ig in as_list(row.get("instagram")):
            n = normalize_ig(ig)
            if n and n in ffm["instagram"]:
                hits.append("instagram")
                break
        for w in as_list(row.get("website")):
            n = normalize_web(w)
            if n and n in ffm["website"]:
                hits.append("website")
                break
        fp = content_fingerprint(row)
        if fp and fp != "|||" and fp in ffm["fingerprint"]:
            hits.append("fingerprint")

        if not hits:
            continue
        stats["any"] += 1
        for h in hits:
            stats[h] += 1
        # Keep source distinct; mark as likely duplicate for reviewer queue
        prev = (row.get("duplicate_status") or "unique").lower()
        if prev in {"unique", "", "none"} or prev == "recurring_ad":
            row["duplicate_status"] = "likely_duplicate"
        note = f"cross_group_duplicate_vs_fun_for_mom:{','.join(hits)}"
        reason = row.get("ai_reason") or ""
        if note not in str(reason):
            row["ai_reason"] = f"{reason} | {note}".strip(" |")
    return stats


def print_dry_run_report(
    *,
    source_path: Path,
    source_key: str,
    posts: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    to_insert: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
    skipped_same: int,
    skipped_locked: int,
    ffm_overlap: dict[str, int],
    errors: list[str],
) -> None:
    entity_types = Counter(r.get("entity_type") for r in rows)
    dup_status = Counter(r.get("duplicate_status") for r in rows)
    exact_dup = sum(1 for r in rows if (r.get("duplicate_status") or "").lower() == "exact_duplicate")
    likely_dup = sum(1 for r in rows if (r.get("duplicate_status") or "").lower() == "likely_duplicate")

    with_public = sum(1 for r in rows if has_public_contact(r))
    only_tg = sum(1 for r in rows if only_numeric_tg(r))
    no_contact = sum(1 for r in rows if not has_public_contact(r) and not only_numeric_tg(r))

    print("=== Import Review dry-run ===")
    print(f"source_file: {source_path}")
    print(f"source_key: {source_key}")
    print(f"needs_review found: {len(posts)}")
    print(f"will create: {len(to_insert)}")
    print(f"already exists (fingerprint): {len(existing)}")
    print(f"skipped unchanged existing: {skipped_same}")
    print(f"skipped locked: {skipped_locked}")
    print(f"flagged exact_duplicate (AI): {exact_dup}")
    print(f"flagged likely_duplicate (AI+cross): {likely_dup}")
    print("overlap with Fun for Mom:")
    print(f"  phone: {ffm_overlap['phone']}")
    print(f"  instagram: {ffm_overlap['instagram']}")
    print(f"  website: {ffm_overlap['website']}")
    print(f"  fingerprint: {ffm_overlap['fingerprint']}")
    print(f"  any: {ffm_overlap['any']}")
    print(f"entity_type: {dict(entity_types)}")
    print(f"duplicate_status: {dict(dup_status)}")
    print(f"has real public contact: {with_public}")
    print(f"only numeric telegram_user_id: {only_tg}")
    print(f"no public contact: {no_contact}")
    print(f"errors: {len(errors)}")
    for e in errors[:10]:
        print(f"  error: {e}")
    # Sample fingerprints to prove namespace
    if to_insert:
        print(f"sample fingerprint: {to_insert[0]['source_fingerprint']}")
        print(f"sample source field: {to_insert[0]['source']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--source", type=Path, default=DEFAULT_LOC_SOURCE)
    parser.add_argument("--source-key", type=str, default=SOURCE_KEY_LOC)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--refresh-pending",
        action="store_true",
        help="Also PATCH existing pending/in_review/needs_more_info rows",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("Use only one of --dry-run / --apply", file=sys.stderr)
        return 2

    source_key = args.source_key.strip()
    if source_key == "telegram":
        print(
            "ABORT: plain source 'telegram' forbidden — use telegram:la_orange_county",
            file=sys.stderr,
        )
        return 2
    if "fun_for_mom" in str(args.source) and "la_orange" not in str(args.source):
        print("ABORT: refusing Fun for Mom input for this import", file=sys.stderr)
        return 2

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    data = json.loads(args.source.read_text(encoding="utf-8"))
    # Stage-1 sanity on the historical LA Orange County reviewer snapshot only.
    if args.limit is None and "la_orange_county" in str(args.source):
        all_posts = data.get("posts") or []
        counts = Counter(p.get("decision") for p in all_posts)
        print(
            "Reviewer file decisions:",
            f"accepted={counts.get('accepted', 0)}",
            f"needs_review={counts.get('needs_review', 0)}",
            f"rejected={counts.get('rejected', 0)}",
        )
        if (
            counts.get("accepted", 0) != 469
            or counts.get("needs_review", 0) != 2804
            or counts.get("rejected", 0) != 1466
        ):
            print(
                "ABORT: unexpected reviewer counts (expected 469/2804/1466)",
                file=sys.stderr,
            )
            return 2

    posts = [
        p
        for p in data.get("posts") or []
        if p.get("decision") in {"needs_review", "accepted"}
    ]
    if args.limit:
        posts = posts[: args.limit]

    rows = [map_post(p, source_key=source_key) for p in posts]
    # Safety: every row must carry the dedicated source key
    bad_source = [r for r in rows if r.get("source") != source_key]
    if bad_source:
        print(f"ABORT: {len(bad_source)} rows missing source_key={source_key}", file=sys.stderr)
        return 2

    ffm = load_ffm_contact_indexes()
    ffm_overlap = annotate_cross_group_duplicates(rows, ffm)

    fingerprints = [r["source_fingerprint"] for r in rows]
    errors: list[str] = []
    for r in rows:
        if not r["source_message_ids"]:
            errors.append(f"missing message ids: {r.get('title')}")
        if not r["source_fingerprint"]:
            errors.append("empty fingerprint")
        if not str(r["source_fingerprint"]).startswith(source_key + ":"):
            errors.append(f"fingerprint missing source_key prefix: {r['source_fingerprint']}")

    # Detect duplicate fingerprints within this batch
    fp_counts = Counter(fingerprints)
    batch_dup_fps = {fp for fp, n in fp_counts.items() if n > 1}
    if batch_dup_fps:
        errors.append(f"duplicate fingerprints inside batch: {len(batch_dup_fps)}")

    client = SupabaseRest(url, key)
    existing = client.fetch_existing(fingerprints) if rows else {}

    to_insert: list[dict[str, Any]] = []
    to_update: list[tuple[str, dict[str, Any]]] = []
    skipped_locked = 0
    skipped_same = 0
    seen_fp: set[str] = set()

    for row in rows:
        fp = row["source_fingerprint"]
        if fp in seen_fp:
            # exact duplicate inside import batch — skip second copy
            continue
        seen_fp.add(fp)
        prev = existing.get(fp)
        if not prev:
            to_insert.append(row)
            continue
        status = prev.get("review_status")
        if status in LOCKED_STATUSES:
            skipped_locked += 1
            continue
        if not args.refresh_pending:
            skipped_same += 1
            continue
        update_row = dict(row)
        to_update.append((prev["id"], update_row))

    print_dry_run_report(
        source_path=args.source,
        source_key=source_key,
        posts=posts,
        rows=rows,
        to_insert=to_insert,
        existing=existing,
        skipped_same=skipped_same,
        skipped_locked=skipped_locked,
        ffm_overlap=ffm_overlap,
        errors=errors,
    )

    if args.dry_run:
        print("\nDRY-RUN complete. No writes performed.")
        return 0 if not errors else 1

    # APPLY — queue only, never publish
    print("\n=== Import Review apply ===")
    inserted = 0
    updated = 0
    audit_rows = 0
    batch = 50
    for i in range(0, len(to_insert), batch):
        chunk = to_insert[i : i + batch]
        created = client.insert_many(chunk)
        inserted += len(created)
        audits = []
        for created_row in created:
            audits.append(
                {
                    "item_id": created_row["id"],
                    "admin_id": None,
                    "action": "import_needs_review",
                    "previous_status": None,
                    "new_status": "pending",
                    "changed_fields": {
                        "source": source_key,
                        "source_fingerprint": created_row.get("source_fingerprint"),
                    },
                    "note": f"Импорт needs_review из {source_key}",
                }
            )
        audit_rows += client.insert_audit(audits)
        print(f"inserted {inserted}/{len(to_insert)}", flush=True)

    for item_id, payload in to_update:
        client.update_pending(item_id, payload)
        updated += 1
        if updated % 100 == 0:
            print(f"updated {updated}/{len(to_update)}", flush=True)

    in_db = client._count("source", f"eq.{source_key}")
    print(
        f"done: inserted={inserted} updated={updated} "
        f"skipped_locked={skipped_locked} skipped_same={skipped_same} "
        f"audit={audit_rows} source_rows_in_db={in_db}"
    )
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
