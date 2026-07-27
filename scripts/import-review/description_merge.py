"""Merge multiple ad texts into one coherent business description (no LLM)."""

from __future__ import annotations

import re
from typing import Any

MAX_MERGED_CHARS = 1800
MIN_DESC_CHARS = 40
NEAR_DUP_SIM = 0.78
RELATED_MIN_SIM = 0.18
CONTAINMENT_RATIO = 0.88

GREETING_RE = re.compile(
    r"^(всем\s+(привет|доброго\s+(дня|вечера|утра))|привет[\s!,.]*|"
    r"здравствуйте[\s!,.]*|добрый\s+(день|вечер|утро)[\s!,.]*|"
    r"ребята[\s!,.]*|девочки[\s!,.]*)\s*",
    re.I,
)
NOISE_LINE_RE = re.compile(
    r"^(подробности\s+в\s+(лс|личк|direct)|пишите\s+в\s+(лс|личк|direct|dm)|"
    r"вопросы\s+в\s+лс|напишите\s+мне|contact\s+me)\.?$",
    re.I,
)


def _norm_ws(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def text_tokens(text: str) -> set[str]:
    cleaned = re.sub(r"[^\w\s]+", " ", (text or "").lower(), flags=re.UNICODE)
    return {t for t in cleaned.split() if len(t) >= 3}


def similarity(a: str, b: str) -> float:
    ta, tb = text_tokens(a), text_tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _strip_greeting(text: str) -> str:
    lines = text.split("\n")
    if not lines:
        return text
    first = GREETING_RE.sub("", lines[0]).strip()
    first = re.sub(r"^[\s.,:;!\-–—]+", "", first).strip()
    if first:
        lines[0] = first
    else:
        lines = lines[1:]
    return "\n".join(lines).strip()


def _split_units(text: str) -> list[str]:
    """Split into paragraphs, then sentences for finer unique extraction."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    units: list[str] = []
    for p in paras:
        if len(p) < 120 and "\n" not in p:
            units.append(p)
            continue
        # keep bullet blocks together
        if re.search(r"(^|\n)\s*[•✅✔\-–]\s*", p):
            units.append(p)
            continue
        parts = re.split(r"(?<=[.!?…])\s+(?=[A-ZА-ЯЁ«\"])", p)
        for part in parts:
            part = part.strip()
            if part:
                units.append(part)
    return units


def _is_noise_unit(unit: str) -> bool:
    u = unit.strip()
    if len(u) < 12:
        return True
    if NOISE_LINE_RE.match(u):
        return True
    return False


def _contained(shorter: str, longer: str) -> bool:
    sa, sb = text_tokens(shorter), text_tokens(longer)
    if not sa or not sb:
        return False
    return len(sa & sb) / len(sa) >= CONTAINMENT_RATIO


def _clean_candidate(raw: str) -> str | None:
    text = _norm_ws(raw or "")
    if len(text) < MIN_DESC_CHARS:
        return None
    text = _strip_greeting(text)
    text = _norm_ws(text)
    if len(text) < MIN_DESC_CHARS:
        return None
    return text


def collect_description_candidates(rows: list[dict[str, Any]]) -> list[str]:
    """Gather unique-ish description texts from cluster rows."""
    out: list[str] = []
    for r in rows:
        for field in ("description", "source_text"):
            cleaned = _clean_candidate(str(r.get(field) or ""))
            if not cleaned:
                continue
            # drop near-dups / contained
            keep = True
            for i, existing in enumerate(list(out)):
                sim = similarity(cleaned, existing)
                if sim >= NEAR_DUP_SIM:
                    # keep longer
                    if len(cleaned) > len(existing):
                        out[i] = cleaned
                    keep = False
                    break
                if _contained(cleaned, existing):
                    keep = False
                    break
                if _contained(existing, cleaned):
                    out[i] = cleaned
                    keep = False
                    break
            if keep:
                out.append(cleaned)
    return out


def merge_descriptions(
    rows: list[dict[str, Any]],
    *,
    title: str | None = None,
    max_chars: int = MAX_MERGED_CHARS,
) -> str | None:
    """Build one meaningful description from all cluster ad texts.

    Strategy:
    1. Deduplicate near-identical posts.
    2. Drop unrelated texts (wrong merge pollution).
    3. Use the richest related text as base.
    4. Append unique factual sentences/paragraphs not already covered.
    """
    candidates = collect_description_candidates(rows)
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0][:max_chars]

    title_blob = (title or "").strip()
    # Anchor = longest candidate (usually the fullest ad)
    candidates.sort(key=len, reverse=True)
    base = candidates[0]
    related = [base]
    for c in candidates[1:]:
        sim_base = similarity(c, base)
        sim_title = similarity(c, title_blob) if title_blob else 0.0
        if sim_base >= RELATED_MIN_SIM or sim_title >= 0.35:
            related.append(c)
        # else: skip as likely wrong-cluster noise

    if len(related) == 1:
        return base[:max_chars]

    covered = text_tokens(base)
    extras: list[str] = []
    for other in related[1:]:
        for unit in _split_units(other):
            if _is_noise_unit(unit):
                continue
            ut = text_tokens(unit)
            if not ut:
                continue
            overlap = len(ut & covered) / len(ut)
            if overlap >= 0.72:
                continue
            # avoid tiny fragments that add little
            if len(unit) < 28 and overlap >= 0.4:
                continue
            extras.append(unit)
            covered |= ut
            if len(base) + sum(len(x) + 2 for x in extras) >= max_chars:
                break
        if len(base) + sum(len(x) + 2 for x in extras) >= max_chars:
            break

    if not extras:
        return base[:max_chars]

    # Prefer paragraph join; keep extras compact
    extra_block = "\n\n".join(extras)
    merged = f"{base}\n\n{extra_block}".strip()
    if len(merged) > max_chars:
        merged = merged[: max_chars - 1].rsplit("\n", 1)[0].rstrip() + "…"
    return merged
