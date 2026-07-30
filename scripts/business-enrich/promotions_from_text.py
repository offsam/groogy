"""Pull акции out of ad copy for the recommendation publish path.

Python port of `lib/promotions/extract.ts` with one addition the TS side does
not need: a promo block often carries no date of its own («акция к празднику»)
while the date sits in a neighbouring line («С праздником 4 июля»). Here the
whole ad is used as date context, so a holiday special does not become a
promotion that never expires.

Expired promos are never published — same rule as
`addMissingEntityPromotions` in lib/promotions/queries.ts.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

PROMO_LINE_RE = re.compile(
    r"(?:скидк\w*\s*(?:до\s*)?(\d{1,2})\s*%"
    r"|(\d{1,2})\s*%\s*(?:скидк\w*|off)"
    r"|discount\s*(?:of\s*)?(\d{1,2})\s*%"
    r"|(\d{1,2})\s*%\s*off)",
    re.I,
)
PROMO_NOUN_RE = re.compile(
    r"\bакци[яию]\b|\bспецпредложен|\bспециальн\w*\s+предложен|\bspecial\s+offer|\bpromo\b",
    re.I,
)
# «0% годовых (APR)», «1.9% APR» — a financing offer, not a discount percent.
APR_RE = re.compile(r"(\d{1,2}(?:[.,]\d)?)\s*%\s*(?:apr|годовых)", re.I)
MONEY_OFF_RE = re.compile(
    r"\$\s?\d+\s*(?:off|скидк\w*)|\d+\s*\$\s*(?:off|скидк\w*)", re.I
)
# «сориентирует по актуальным акциям» promises info, it is not an offer itself.
INFO_PROMO_RE = re.compile(
    r"(?:по|об|о|про)\s+(?:наши\w*\s+|актуальны\w*\s+|текущи\w*\s+)*акци\w+"
    r"|актуальны\w*\s+акци\w+"
    r"|уточняйте\s+акци\w+"
    r"|следите\s+за\s+акци\w+",
    re.I,
)
# A short line right above the offer usually carries its real name.
HEADING_HINT_RE = re.compile(r"предложен|акци|специальн|скидк|promo|offer|sale", re.I)
PROMO_RANGE_RE = re.compile(
    r"с\s+(\d{1,2})\s*(?:по|-|–|—)\s*(\d{1,2})\s+([а-яё]+)", re.I
)
PROMO_UNTIL_RE = re.compile(
    r"(?:до|по|к)\s+(\d{1,2})\s+([а-яё]+)", re.I
)
PROMO_DATE_RE = re.compile(r"(\d{1,2})\s+([а-яё]+)", re.I)

MONTHS_RU: dict[str, int] = {
    "января": 1, "январь": 1,
    "февраля": 2, "февраль": 2,
    "марта": 3, "март": 3,
    "апреля": 4, "апрель": 4,
    "мая": 5, "май": 5,
    "июня": 6, "июнь": 6,
    "июля": 7, "июль": 7,
    "августа": 8, "август": 8,
    "сентября": 9, "сентябрь": 9,
    "октября": 10, "октябрь": 10,
    "ноября": 11, "ноябрь": 11,
    "декабря": 12, "декабрь": 12,
}

EMOJI_PREFIX_RE = re.compile(r"^[\W\d_]+", re.UNICODE)
GREETING_PREFIX_RE = re.compile(
    r"^(?:всем\s+)?(?:привет|здравствуйте|добрый\s+день|добрый\s+вечер|друзья|дорогие\s+\w+)[!,.\s—-]*",
    re.I,
)


def _iso(year: int, month: int, day: int) -> str | None:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _resolve_year(month: int, day: int, now: datetime) -> int:
    """Keep the current year unless the date is far behind (next-year promo)."""
    candidate = _iso(now.year, month, day)
    if not candidate:
        return now.year
    delta = (date.fromisoformat(candidate) - now.date()).days
    if delta < -300:
        return now.year + 1
    return now.year


def _dates_from(text: str, now: datetime) -> tuple[str | None, str | None]:
    match = PROMO_RANGE_RE.search(text)
    if match:
        month = MONTHS_RU.get(match.group(3).lower())
        if month:
            year = _resolve_year(month, int(match.group(2)), now)
            return (
                _iso(year, month, int(match.group(1))),
                _iso(year, month, int(match.group(2))),
            )
    match = PROMO_UNTIL_RE.search(text)
    if match:
        month = MONTHS_RU.get(match.group(2).lower())
        if month:
            year = _resolve_year(month, int(match.group(1)), now)
            return None, _iso(year, month, int(match.group(1)))
    match = PROMO_DATE_RE.search(text)
    if match:
        month = MONTHS_RU.get(match.group(2).lower())
        if month:
            year = _resolve_year(month, int(match.group(1)), now)
            return None, _iso(year, month, int(match.group(1)))
    return None, None


def _has_promo_noun(text: str) -> bool:
    return bool(PROMO_NOUN_RE.search(INFO_PROMO_RE.sub(" ", text)))


def _is_offer(block: str) -> bool:
    """True when the block announces an offer, not just mentions акции exist."""
    if PROMO_LINE_RE.search(block) or MONEY_OFF_RE.search(block):
        return True
    apr = APR_RE.search(block)
    if apr:
        # 0% APR is an offer by itself; any other rate is just a description of
        # market terms unless the copy frames it as an акция.
        if float(apr.group(1).replace(",", ".")) == 0 or _has_promo_noun(block):
            return True
    return _has_promo_noun(block)


def _discount(text: str) -> tuple[int | None, str | None]:
    match = PROMO_LINE_RE.search(text)
    if match:
        raw = next((g for g in match.groups() if g), None)
        if raw is not None:
            percent = int(raw)
            if 0 < percent <= 90:
                return percent, f"−{percent}%"
    apr = APR_RE.search(text)
    if apr:
        return None, f"{apr.group(1).replace(',', '.')}% APR"
    return None, None


def _narrow_to_offer(block: str) -> str:
    """Keep the offer itself, not the whole self-introduction around it."""
    if len(block) <= 280:
        return block
    lines = [line for line in block.split("\n") if line.strip()]
    if len(lines) > 1:
        hits = [i for i, line in enumerate(lines) if _is_offer(line)]
        if hits:
            lo, hi = min(hits), max(hits)
            # «Действует акция:» — the terms follow on the next lines.
            if lines[hi].rstrip().endswith(":"):
                while hi + 1 < len(lines) and hi - min(hits) < 6:
                    hi += 1
            # A price or deadline often lands on the next short line.
            for _ in range(2):
                nxt = hi + 1
                if nxt < len(lines) and len(lines[nxt]) <= 90 and re.search(
                    r"\d|до\s|скидк|акци", lines[nxt], re.I
                ):
                    hi = nxt
                else:
                    break
            narrowed = "\n".join(lines[lo : hi + 1]).strip()
            if narrowed:
                block = narrowed
    if len(block) <= 280:
        return block
    sentences = re.split(r"(?<=[.!?])\s+", block)
    picked = [s for s in sentences if _is_offer(s)]
    return " ".join(picked).strip() if picked else block


def _title(block: str) -> str:
    for line in block.split("\n"):
        cleaned = EMOJI_PREFIX_RE.sub("", line).strip()
        cleaned = GREETING_PREFIX_RE.sub("", cleaned).strip()
        if len(cleaned) >= 8:
            return cleaned[:160]
    return "Акция"


def promotions_from_ad_text(
    text: str | None, now: datetime | None = None
) -> list[dict[str, Any]]:
    if not text or not text.strip():
        return []
    moment = now or datetime.now(timezone.utc)
    blocks = [b.strip() for b in re.split(r"\n{2,}", text) if b.strip()]

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, block in enumerate(blocks):
        if len(block) > 600 or not _is_offer(block):
            continue
        percent, label = _discount(block)
        valid_from, valid_until = _dates_from(block, moment)
        if not valid_until:
            # The deadline often sits in the neighbouring line («С праздником
            # 4 июля!» above, «только до 10 августа» below).
            context = "\n".join(blocks[max(0, index - 1) : index + 2])
            valid_from, valid_until = _dates_from(context, moment)
        block = _narrow_to_offer(block)
        heading = blocks[index - 1] if index else ""
        if heading and len(heading) <= 120 and HEADING_HINT_RE.search(heading):
            title = _title(heading)
            block = f"{heading}\n\n{block}"
        else:
            title = _title(block)
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "title": title,
                "body": block[:2000],
                "discount_label": label,
                "discount_percent": percent,
                "valid_from": valid_from,
                "valid_until": valid_until,
            }
        )
        if len(out) >= 3:
            break
    return out


def is_promotion_active(promo: dict[str, Any], now: datetime | None = None) -> bool:
    status = promo.get("status")
    if status and status != "active":
        return False
    until = promo.get("valid_until")
    if not until:
        return True
    try:
        end = date.fromisoformat(str(until))
    except ValueError:
        return True
    moment = now or datetime.now(timezone.utc)
    return end >= moment.date()


def strip_promotion_blocks(text: str | None, promotions: list[dict[str, Any]]) -> str:
    """Remove promo paragraphs from narrative copy once they are stored."""
    if not text:
        return ""
    remaining = text
    for promo in promotions:
        body = str(promo.get("body") or "").strip()
        if not body:
            continue
        if body in remaining:
            remaining = remaining.replace(body, "")
            continue
        for part in re.split(r"\n{2,}", body):
            part = part.strip()
            if part and part in remaining:
                remaining = remaining.replace(part, "")
    return re.sub(r"\n{3,}", "\n\n", remaining).strip()


def add_missing_entity_promotions(
    client: Any,
    *,
    owner_type: str,
    owner_id: str,
    promotions: list[dict[str, Any]],
    category_id: str | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Insert promos that are new and still valid. Returns inserted rows."""
    if not promotions:
        return []
    existing = (
        client._request(
            "GET",
            "/entity_promotions",
            params={
                "select": "title",
                "owner_type": f"eq.{owner_type}",
                "owner_id": f"eq.{owner_id}",
                "limit": "100",
            },
        )
        or []
    )
    taken = {str(r.get("title") or "").strip().lower() for r in existing}
    inserted: list[dict[str, Any]] = []
    sort = 0
    for promo in promotions:
        title = str(promo.get("title") or "").strip()[:160]
        if not title or title.lower() in taken:
            continue
        if not is_promotion_active({**promo, "status": "active"}, now):
            continue
        taken.add(title.lower())
        sort += 10
        body = {
            "owner_type": owner_type,
            "owner_id": owner_id,
            "title": title,
            "body": (str(promo.get("body") or "").strip() or None),
            "discount_label": promo.get("discount_label"),
            "discount_percent": promo.get("discount_percent"),
            "category_id": category_id,
            "status": "active",
            "valid_from": promo.get("valid_from"),
            "valid_until": promo.get("valid_until"),
            "sort_order": sort,
        }
        rows = client._request(
            "POST", "/entity_promotions", body=body, prefer="return=representation"
        )
        if isinstance(rows, list) and rows:
            inserted.append(rows[0])
    return inserted
