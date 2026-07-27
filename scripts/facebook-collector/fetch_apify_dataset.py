"""Apify dataset / actor client for Facebook Groups PoC.

Secrets (APIFY_TOKEN, cookies) are never printed. Cookies must live in Apify
secret storage or env vars — never in repo JSON or DB.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

APIFY_API = "https://api.apify.com/v2"


class ApifyError(RuntimeError):
    pass


def _redact(text: str) -> str:
    token = os.environ.get("APIFY_TOKEN") or ""
    out = text
    if token and token in out:
        out = out.replace(token, "[REDACTED_APIFY_TOKEN]")
    # common cookie / session patterns
    for needle in ("c_user=", "xs=", "datr=", "fr=", "sb="):
        if needle in out:
            out = "[REDACTED_COOKIE_OR_SESSION_FRAGMENT]"
    return out


def _token() -> str:
    token = (os.environ.get("APIFY_TOKEN") or "").strip()
    if not token:
        raise ApifyError(
            "APIFY_TOKEN is missing. Add it to .env.local (see .env.example)."
        )
    return token


def _request(
    method: str,
    path: str,
    *,
    query: dict[str, str] | None = None,
    body: Any = None,
    timeout: int = 120,
) -> Any:
    token = _token()
    q = dict(query or {})
    q["token"] = token
    url = f"{APIFY_API}{path}?{urllib.parse.urlencode(q)}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        method=method,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = _redact(exc.read().decode("utf-8", errors="replace")[:500])
        raise ApifyError(f"Apify HTTP {exc.code} {path}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ApifyError(f"Apify network error: {_redact(str(exc))}") from exc


def fetch_dataset_items(
    dataset_id: str,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Mode A: read an existing Apify dataset."""
    dataset_id = dataset_id.strip()
    if not dataset_id:
        raise ApifyError("dataset_id is empty")
    query: dict[str, str] = {
        "format": "json",
        "clean": "true",
        "offset": str(max(0, offset)),
    }
    if limit is not None:
        query["limit"] = str(max(1, limit))
    data = _request("GET", f"/datasets/{dataset_id}/items", query=query)
    if not isinstance(data, list):
        raise ApifyError("Unexpected dataset response (expected JSON array)")
    return [row for row in data if isinstance(row, dict)]


def build_actor_input(
    *,
    group_url: str,
    limit: int,
    template: dict[str, Any] | None = None,
    cookie_env: str = "FACEBOOK_COOKIES_JSON",
) -> dict[str, Any]:
    """Merge group URL + limit into an Actor-specific input template.

    Cookies: if FACEBOOK_COOKIES_JSON is set, inject under template key
    `cookiesKey` (default `cookies`) — value is parsed JSON, never logged.
    Prefer Apify secret storage over env when possible.
    """
    if not group_url or not group_url.strip():
        raise ApifyError("group_url is required to start an Actor run")

    base = dict(template or {})
    # Common Apify Facebook group actor shapes
    if "startUrls" not in base and "groupUrls" not in base and "groupUrl" not in base:
        base["startUrls"] = [{"url": group_url.strip()}]
    elif "groupUrls" in base and isinstance(base["groupUrls"], list) and not base["groupUrls"]:
        base["groupUrls"] = [group_url.strip()]
    elif "groupUrl" in base and not base.get("groupUrl"):
        base["groupUrl"] = group_url.strip()
    elif "startUrls" in base and isinstance(base["startUrls"], list):
        if not base["startUrls"]:
            base["startUrls"] = [{"url": group_url.strip()}]

    for key in ("resultsLimit", "maxPosts", "maxItems", "maxPostsPerGroup", "count"):
        if key in base or key == "resultsLimit":
            if key in base or not any(k in base for k in ("maxPosts", "maxItems", "count")):
                if "resultsLimit" in base or key == "resultsLimit":
                    base.setdefault("resultsLimit", limit)
                break
    base.setdefault("resultsLimit", limit)

    cookies_raw = os.environ.get(cookie_env)
    if cookies_raw:
        cookies_key = str(base.pop("cookiesKey", "cookies"))
        try:
            base[cookies_key] = json.loads(cookies_raw)
        except json.JSONDecodeError as exc:
            raise ApifyError(
                f"{cookie_env} must be valid JSON (array/object). Do not commit it."
            ) from exc

    return base


def start_actor_run(actor_id: str, actor_input: dict[str, Any]) -> dict[str, Any]:
    actor_id = actor_id.strip()
    if not actor_id:
        raise ApifyError("actor_id is empty")
    # Accept username~actorName or act ID
    path = f"/acts/{urllib.parse.quote(actor_id, safe='~')}/runs"
    data = _request("POST", path, body=actor_input, timeout=60)
    if not isinstance(data, dict) or "data" not in data:
        raise ApifyError("Unexpected actor start response")
    return data["data"]


def wait_for_run(
    run_id: str,
    *,
    poll_seconds: float = 5.0,
    timeout_seconds: float = 900.0,
) -> dict[str, Any]:
    started = time.time()
    while True:
        data = _request("GET", f"/actor-runs/{run_id}")
        run = (data or {}).get("data") if isinstance(data, dict) else None
        if not isinstance(run, dict):
            raise ApifyError("Unexpected actor-run status response")
        status = run.get("status")
        if status in {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}:
            if status != "SUCCEEDED":
                raise ApifyError(f"Actor run ended with status={status}")
            return run
        if time.time() - started > timeout_seconds:
            raise ApifyError(f"Timed out waiting for actor run {run_id}")
        time.sleep(poll_seconds)


def run_actor_with_input(
    *,
    actor_id: str,
    actor_input: dict[str, Any],
    limit: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Start Actor with a fully prepared input payload (no group-url injection)."""
    run = start_actor_run(actor_id, actor_input)
    run_id = run.get("id")
    if not run_id:
        raise ApifyError("Actor run missing id")
    finished = wait_for_run(str(run_id))
    dataset_id = finished.get("defaultDatasetId")
    if not dataset_id:
        raise ApifyError("Actor run missing defaultDatasetId")
    items = fetch_dataset_items(str(dataset_id), limit=limit)
    meta = {
        "run_id": str(run_id),
        "dataset_id": str(dataset_id),
        "status": finished.get("status"),
        "actor_id": actor_id,
        "item_count": len(items),
    }
    return items, meta


def run_actor_and_fetch_items(
    *,
    actor_id: str,
    group_url: str,
    limit: int,
    template: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Mode B: start Actor, wait, return dataset items + run meta (no secrets)."""
    actor_input = build_actor_input(
        group_url=group_url, limit=limit, template=template
    )
    return run_actor_with_input(
        actor_id=actor_id, actor_input=actor_input, limit=limit
    )
