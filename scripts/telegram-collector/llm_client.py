"""LLM HTTP client with retries, backoff, and usage accounting."""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request
from typing import Any

from analyzers import LLM_SYSTEM_PROMPT, resolve_llm_config
from cost import CostTracker


class LLMClientError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class LLMClient:
    def __init__(self, tracker: CostTracker, *, request_delay_s: float = 0.15, timeout_s: int = 90):
        provider, api_key, model, base_url = resolve_llm_config()
        if not api_key or provider not in {"openrouter", "openai"}:
            raise RuntimeError("OpenRouter/OpenAI key required for full run")
        self.provider = provider
        self.api_key = api_key
        self.model = model or tracker.model
        self.base_url = base_url
        self.tracker = tracker
        self.request_delay_s = request_delay_s
        self.timeout_s = timeout_s

    def complete_json(self, user_content: str, *, repair: bool = False) -> tuple[dict[str, Any], dict[str, int]]:
        system = LLM_SYSTEM_PROMPT
        if repair:
            system += (
                "\nPrevious response was invalid JSON or violated the schema. "
                "Return ONLY a valid JSON object with the required keys. "
                "classification must NOT be a category value."
            )
        content, usage = self._request_with_retries(system, user_content)
        data = _parse_json_object(content)
        return data, usage

    def _request_with_retries(self, system: str, user_content: str) -> tuple[str, dict[str, int]]:
        last_exc: Exception | None = None
        for attempt in range(4):
            if self.request_delay_s:
                time.sleep(self.request_delay_s + random.uniform(0, 0.05))
            try:
                content, usage = self._once(system, user_content)
                self.tracker.add_usage(usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))
                return content, usage
            except LLMClientError as exc:
                last_exc = exc
                if not exc.retryable or attempt == 3:
                    raise
                backoff = (2 ** attempt) + random.uniform(0, 0.5)
                time.sleep(backoff)
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt == 3:
                    raise
                time.sleep((2 ** attempt) + random.uniform(0, 0.5))
        raise RuntimeError(f"LLM failed after retries: {last_exc}")

    def _once(self, system: str, user_content: str) -> tuple[str, dict[str, int]]:
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.provider == "openrouter":
            headers["HTTP-Referer"] = "https://localhost"
            headers["X-Title"] = "Krugi Telegram Collector"
        req = urllib.request.Request(
            self.base_url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:400]
            retryable = exc.code == 429 or 500 <= exc.code <= 599
            raise LLMClientError(
                f"HTTP {exc.code}: {detail}",
                status=exc.code,
                retryable=retryable,
            ) from exc
        except TimeoutError as exc:
            raise LLMClientError("timeout", retryable=True) from exc

        content = body["choices"][0]["message"]["content"]
        usage_raw = body.get("usage") or {}
        usage = {
            "prompt_tokens": int(usage_raw.get("prompt_tokens") or 0),
            "completion_tokens": int(usage_raw.get("completion_tokens") or 0),
            "total_tokens": int(usage_raw.get("total_tokens") or 0),
        }
        return content, usage


def _parse_json_object(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    if text.startswith("```"):
        import re

        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("JSON root must be object")
    return data
