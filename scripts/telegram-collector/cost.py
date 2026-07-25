"""OpenRouter/OpenAI cost tracking and pricing helpers."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


# Approximate OpenRouter list prices for openai/gpt-4o-mini (USD per 1M tokens).
PRICE_PER_M = {
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
}


@dataclass
class CostTracker:
    model: str
    max_cost_usd: float
    input_tokens: int = 0
    output_tokens: int = 0
    requests: int = 0
    estimated_upfront_usd: float = 0.0

    def price(self) -> tuple[float, float]:
        row = PRICE_PER_M.get(self.model) or PRICE_PER_M["openai/gpt-4o-mini"]
        return float(row["input"]), float(row["output"])

    def add_usage(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.input_tokens += int(prompt_tokens or 0)
        self.output_tokens += int(completion_tokens or 0)
        self.requests += 1

    @property
    def cost_usd(self) -> float:
        pin, pout = self.price()
        return (self.input_tokens / 1_000_000.0) * pin + (
            self.output_tokens / 1_000_000.0
        ) * pout

    def estimate_for_posts(self, n_posts: int, avg_in: int = 700, avg_out: int = 350) -> float:
        pin, pout = self.price()
        return n_posts * (
            (avg_in / 1_000_000.0) * pin + (avg_out / 1_000_000.0) * pout
        )

    def would_exceed(self, extra_in: int = 700, extra_out: int = 350) -> bool:
        pin, pout = self.price()
        projected = self.cost_usd + (extra_in / 1_000_000.0) * pin + (
            extra_out / 1_000_000.0
        ) * pout
        return projected > self.max_cost_usd

    def as_dict(self) -> dict:
        return {
            "model": self.model,
            "requests": self.requests,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "approximate_cost_usd": round(self.cost_usd, 6),
            "avg_cost_per_request_usd": round(
                self.cost_usd / self.requests, 8
            )
            if self.requests
            else 0.0,
            "max_cost_usd": self.max_cost_usd,
            "estimated_upfront_usd": round(self.estimated_upfront_usd, 6),
        }


def load_max_cost_usd(default: float = 20.0) -> float:
    raw = (os.getenv("TELEGRAM_LLM_MAX_COST_USD") or str(default)).strip()
    try:
        return float(raw)
    except ValueError:
        return default
