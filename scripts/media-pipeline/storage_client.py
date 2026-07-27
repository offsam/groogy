"""Supabase Storage + REST helpers for Media Pipeline v1."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class MediaSupabase:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url.rstrip("/")
        self.rest = self.url + "/rest/v1"
        self.storage = self.url + "/storage/v1"
        self.key = service_key

    def _headers(self, *, prefer: str | None = None, content_type: str = "application/json") -> dict[str, str]:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
        }
        if content_type:
            h["Content-Type"] = content_type
        if prefer:
            h["Prefer"] = prefer
        return h

    def rest_request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: Any = None,
        prefer: str | None = None,
    ) -> Any:
        qs = f"?{urllib.parse.urlencode(params)}" if params else ""
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.rest}{path}{qs}",
            method=method,
            data=data,
            headers=self._headers(prefer=prefer),
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
            raise RuntimeError(f"HTTP {exc.code} {path}: {detail}") from exc

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        return self.rest_request("POST", f"/rpc/{name}", body=args)

    def upload(
        self,
        bucket: str,
        path: str,
        data: bytes,
        *,
        content_type: str,
        upsert: bool = False,
    ) -> None:
        headers = self._headers(content_type=content_type)
        headers["x-upsert"] = "true" if upsert else "false"
        # Storage uses different path encoding
        encoded = "/".join(urllib.parse.quote(p, safe="") for p in path.split("/"))
        req = urllib.request.Request(
            f"{self.storage}/object/{bucket}/{encoded}",
            method="POST",
            data=data,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
            raise RuntimeError(f"Storage upload {exc.code}: {detail}") from exc

    def public_url(self, bucket: str, path: str) -> str:
        return f"{self.url}/storage/v1/object/public/{bucket}/{path}"

    def create_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str | None:
        body = {"expiresIn": expires_in}
        encoded = "/".join(urllib.parse.quote(p, safe="") for p in path.split("/"))
        req = urllib.request.Request(
            f"{self.storage}/object/sign/{bucket}/{encoded}",
            method="POST",
            data=json.dumps(body).encode("utf-8"),
            headers=self._headers(),
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            signed = payload.get("signedURL") or payload.get("signedUrl")
            if not signed:
                return None
            if signed.startswith("http"):
                return signed
            return self.url + "/storage/v1" + signed
        except Exception:
            return None
