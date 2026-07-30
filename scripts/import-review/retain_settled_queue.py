#!/usr/bin/env python3
"""Safe retention for settled import_review_items + orphan import-review storage.

What it does (in order):
  1) Promote businesses/professionals still pointing at import-review/… into
     business/{id}/ or professional/{id}/ and rewrite image_url.
  2) Compact raw_payload/source_media on settled rows via
     admin_compact_settled_import_review_batch (pending queue untouched).
  3) Delete import-review/{itemId}/ objects only when the item is settled
     AND no entity image_url still references those files.

Default is dry-run. Pass --apply to execute.

Usage:
  python3 scripts/import-review/retain_settled_queue.py
  python3 scripts/import-review/retain_settled_queue.py --apply
  python3 scripts/import-review/retain_settled_queue.py --apply --compact-only
  python3 scripts/import-review/retain_settled_queue.py --apply --storage-only
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))

from common import SupabaseRest, load_env  # noqa: E402

BUCKET = "business-images"
IMPORT_REVIEW_RE = re.compile(
    r"/storage/v1/object/public/business-images/(import-review/[^?]+)",
    re.I,
)
SETTLED = ("approved", "rejected", "duplicate")


def public_url(base: str, object_path: str) -> str:
    return f"{base.rstrip('/')}/storage/v1/object/public/{BUCKET}/{object_path}"


def object_path_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = IMPORT_REVIEW_RE.search(url)
    return urllib.parse.unquote(m.group(1)) if m else None


class StorageClient:
    def __init__(self, url: str, key: str) -> None:
        self.base = url.rstrip("/") + "/storage/v1"
        self.key = key

    def _request(
        self,
        method: str,
        path: str,
        *,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        json_body: Any = None,
    ) -> Any:
        body = data
        hdrs = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            **(headers or {}),
        }
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self.base}{path}",
            method=method,
            data=body,
            headers=hdrs,
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                if not raw:
                    return None
                ctype = resp.headers.get("Content-Type", "")
                if "application/json" in ctype:
                    return json.loads(raw.decode("utf-8"))
                return raw
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"HTTP {exc.code} {path}: {detail}") from exc

    def list(self, prefix: str) -> list[dict[str, Any]]:
        rows = self._request(
            "POST",
            "/object/list/" + BUCKET,
            json_body={"prefix": prefix, "limit": 100, "offset": 0},
        )
        return rows or []

    def download(self, object_path: str) -> bytes:
        raw = self._request("GET", f"/object/{BUCKET}/{object_path}")
        if not isinstance(raw, (bytes, bytearray)):
            raise RuntimeError(f"unexpected download payload for {object_path}")
        return bytes(raw)

    def upload(self, object_path: str, content: bytes, content_type: str) -> None:
        self._request(
            "POST",
            f"/object/{BUCKET}/{object_path}",
            data=content,
            headers={
                "Content-Type": content_type or "image/webp",
                "x-upsert": "true",
            },
        )

    def remove(self, paths: list[str]) -> None:
        if not paths:
            return
        self._request("DELETE", f"/object/{BUCKET}", json_body={"prefixes": paths})


def fetch_entities_with_import_review(
    client: SupabaseRest, table: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            client._request(
                "GET",
                f"/{table}",
                params={
                    "select": "id,status,image_url",
                    "image_url": "ilike.*import-review*",
                    "order": "id",
                    "offset": str(offset),
                    "limit": "200",
                },
            )
            or []
        )
        rows.extend(batch)
        if len(batch) < 200:
            break
        offset += 200
    return rows


def promote_entity(
    rest: SupabaseRest,
    storage: StorageClient,
    base_url: str,
    *,
    table: str,
    folder: str,
    row: dict[str, Any],
    apply: bool,
) -> dict[str, Any]:
    src_path = object_path_from_url(row.get("image_url"))
    if not src_path:
        return {"id": row["id"], "skipped": "not_import_review"}
    file_name = src_path.rsplit("/", 1)[-1]
    dest_path = f"{folder}/{row['id']}/{file_name}"
    dest_url = public_url(base_url, dest_path)
    out: dict[str, Any] = {
        "id": row["id"],
        "table": table,
        "status": row.get("status"),
        "from": src_path,
        "to": dest_path,
    }
    if not apply:
        out["would_promote"] = True
        return out
    content = storage.download(src_path)
    storage.upload(dest_path, content, "image/webp")
    rest._request(
        "PATCH",
        f"/{table}",
        params={"id": f"eq.{row['id']}"},
        body={"image_url": dest_url},
        prefer="return=minimal",
    )
    out["promoted"] = True
    return out


def compact_batches(rest: SupabaseRest, apply: bool, max_batches: int = 20) -> list[dict]:
    reports = []
    if not apply:
        reports.append(
            {
                "dry_run": True,
                "note": "Pass --apply to run admin_compact_settled_import_review_batch. Pending rows are never compacted.",
            }
        )
        return reports

    for i in range(max_batches):
        result = rest._request(
            "POST",
            "/admin_compact_settled_import_review_batch",
            body={"p_limit": 500},
            base=rest.rpc,
        )
        reports.append({"batch": i + 1, "result": result})
        remaining = 0
        if isinstance(result, dict):
            remaining = int(result.get("remaining") or 0)
            updated = int(result.get("updated") or 0)
            print(f"  compact batch {i+1}: updated={updated} remaining={remaining}")
            if updated == 0 or remaining == 0:
                break
        else:
            break
    return reports


def settled_item_ids(rest: SupabaseRest) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    offset = 0
    while True:
        rows = (
            rest._request(
                "GET",
                "/import_review_items",
                params={
                    "select": "id,review_status,preview_image_url",
                    "review_status": "in.(approved,rejected,duplicate)",
                    "order": "id",
                    "offset": str(offset),
                    "limit": "500",
                },
            )
            or []
        )
        for r in rows:
            out[str(r["id"])] = r
        if len(rows) < 500:
            break
        offset += 500
    return out


def referenced_import_review_urls(rest: SupabaseRest) -> set[str]:
    urls: set[str] = set()
    for table in ("businesses", "professionals"):
        offset = 0
        while True:
            rows = (
                rest._request(
                    "GET",
                    f"/{table}",
                    params={
                        "select": "image_url",
                        "image_url": "ilike.*import-review*",
                        "offset": str(offset),
                        "limit": "500",
                    },
                )
                or []
            )
            for r in rows:
                u = (r.get("image_url") or "").split("?")[0]
                if u:
                    urls.add(u)
            if len(rows) < 500:
                break
            offset += 500
    return urls


def clean_storage(
    rest: SupabaseRest,
    storage: StorageClient,
    base_url: str,
    *,
    apply: bool,
) -> dict[str, Any]:
    settled = settled_item_ids(rest)
    referenced = referenced_import_review_urls(rest)
    would_delete: list[str] = []
    deleted: list[str] = []
    skipped_ref: list[str] = []

    # Top-level folders under import-review/
    top = storage.list("import-review")
    # Storage list with prefix "import-review" may return files or folders depending on API.
    # Prefer listing prefix "" then filter — hydrate uses import-review/{id}/file.
    # Use REST: list with prefix import-review/ via empty folder listing trick.
    folder_names: set[str] = set()
    for item in top:
        name = str(item.get("name") or "")
        if not name or name == ".emptyFolderPlaceholder":
            continue
        # If listing returns nested path, take first segment after import-review
        folder_names.add(name.split("/")[0])

    # Also include settled item ids that have preview urls even if list is incomplete
    for item_id, row in settled.items():
        folder_names.add(item_id)
        path = object_path_from_url(row.get("preview_image_url"))
        if path:
            folder_names.add(path.split("/")[1] if path.startswith("import-review/") else item_id)

    for item_id in sorted(folder_names):
        if item_id not in settled:
            continue
        files = storage.list(f"import-review/{item_id}")
        paths = []
        for f in files:
            fname = str(f.get("name") or "")
            if not fname or fname == ".emptyFolderPlaceholder":
                continue
            # skip nested folders
            if f.get("id") is None and not f.get("metadata"):
                continue
            paths.append(f"import-review/{item_id}/{fname}")
        if not paths:
            continue
        urls = {public_url(base_url, p) for p in paths}
        preview = (settled[item_id].get("preview_image_url") or "").split("?")[0]
        if preview:
            urls.add(preview)
        if urls & referenced:
            skipped_ref.append(item_id)
            continue
        would_delete.extend(paths)
        if apply:
            storage.remove(paths)
            deleted.extend(paths)

    return {
        "settled_items": len(settled),
        "folders_considered": len(folder_names),
        "would_delete_files": len(would_delete) if not apply else len(deleted),
        "deleted_files": len(deleted),
        "skipped_still_referenced": len(skipped_ref),
        "sample_deleted": (deleted or would_delete)[:15],
        "sample_skipped": skipped_ref[:15],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--compact-only", action="store_true")
    parser.add_argument("--storage-only", action="store_true")
    parser.add_argument("--promote-only", action="store_true")
    args = parser.parse_args()

    load_env()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    rest = SupabaseRest(url, key)
    storage = StorageClient(url, key)
    report: dict[str, Any] = {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "applied": bool(args.apply),
    }

    do_promote = not args.compact_only and not args.storage_only
    do_compact = not args.storage_only and not args.promote_only
    do_storage = not args.compact_only and not args.promote_only

    if do_promote:
        print("phase 1: promote import-review entity images")
        promotions = []
        for table, folder in (("businesses", "business"), ("professionals", "professional")):
            rows = fetch_entities_with_import_review(rest, table)
            print(f"  {table}: {len(rows)} still on import-review")
            for row in rows:
                promotions.append(
                    promote_entity(
                        rest,
                        storage,
                        url,
                        table=table,
                        folder=folder,
                        row=row,
                        apply=args.apply,
                    )
                )
        report["promote"] = {
            "count": len(promotions),
            "promoted": sum(1 for p in promotions if p.get("promoted") or p.get("would_promote")),
            "sample": promotions[:20],
        }

    if do_compact:
        print("phase 2: compact settled raw_payload")
        report["compact"] = compact_batches(rest, apply=args.apply)

    if do_storage:
        print("phase 3: delete unreferenced import-review storage for settled items")
        # Re-check references after promote
        report["storage"] = clean_storage(rest, storage, url, apply=args.apply)

    out_dir = ROOT / "scripts" / "import-review" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if args.apply else "dry"
    path = out_dir / f"retain_settled_queue_{mode}_{stamp}.json"
    latest = out_dir / f"retain_settled_queue_{mode}_latest.json"
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")
    latest.write_text(text, encoding="utf-8")
    print(f"report: {path}")
    if not args.apply:
        print("dry-run only; pass --apply to execute")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
