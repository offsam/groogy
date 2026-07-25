#!/usr/bin/env python3
"""Run SQL against linked Supabase project via Management API (curl)."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REF = "zmsbosigfmnmyavuhlyb"


def token() -> str:
    out = subprocess.check_output(
        ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
        text=True,
    ).strip()
    if not out:
        raise SystemExit("missing Supabase CLI token")
    return out


def sql(query: str):
    payload = json.dumps({"query": query})
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        fh.write(payload)
        path = fh.name
    try:
        proc = subprocess.run(
            [
                "curl",
                "-sS",
                "-X",
                "POST",
                f"https://api.supabase.com/v1/projects/{REF}/database/query",
                "-H",
                f"Authorization: Bearer {token()}",
                "-H",
                "Content-Type: application/json",
                "--data-binary",
                f"@{path}",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
    finally:
        Path(path).unlink(missing_ok=True)

    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(proc.stdout) from exc
    if isinstance(data, dict) and data.get("message"):
        raise RuntimeError(data["message"])
    return data


def main() -> None:
    query = sys.stdin.read() if len(sys.argv) == 1 else " ".join(sys.argv[1:])
    if not query.strip():
        raise SystemExit("empty query")
    print(json.dumps(sql(query), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
