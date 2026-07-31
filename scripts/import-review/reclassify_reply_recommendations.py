#!/usr/bin/env python3
"""Reclassify mis-queued import_review ads that are actually recommendations.

Pattern (Hollywood / Fun for Mom case):
  Author replies under «кто посоветует?» with someone else's phone + name
  («+1 (513) 410-3875 Наргиза, Ирвайн»). Import queue wrongly makes a
  private_specialist card named after the *author*.

Product rules:
  - Move into import_comment_recommendations (third_party).
  - clarity=card_ready  → subject name + contact (can become a catalog card).
  - clarity=contact_only → contact present but subject unclear; keep for
    later phone match when a real profile is created / duplicate-scanned.
  - Close the import_review row so it leaves the ad queue.

Usage:
  python3 scripts/import-review/reclassify_reply_recommendations.py --dry-run
  python3 scripts/import-review/reclassify_reply_recommendations.py --apply
  python3 scripts/import-review/reclassify_reply_recommendations.py --apply --limit 50
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "business-enrich"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from eligibility import (  # noqa: E402
    normalize_instagram,
    normalize_phone,
    normalize_telegram_username,
)
from recommendation_subject import recommended_subject_name  # noqa: E402

OUT_DIR = ROOT / "scripts" / "import-review" / "data" / "reclassify_reply_recommendations"

REC_SIGNAL_RE = re.compile(
    r"(рекоменд|советую|посоветовал|посоветовала|от души советую|"
    r"очень\s+хорош|классный\s+мастер|проверенн|берите\s+(е[её]|его|её)|"
    r"обращайтесь\s+к|ходите\s+к)",
    re.I,
)
SELF_AD_RE = re.compile(
    r"(?i)(?:"
    r"\bя\s+(?:мастер|специалист|врач|юрист|риелтор|агент|делаю|принимаю|работаю)|"
    r"мои?\s+(?:услуги|работы|прайс|instagram|инстаграм|номер|телефон)|"
    r"записывайтесь|запись\s+онлайн|прайс\s*лист|"
    r"direct\s+message|пиши(?:те)?\s+в\s+л[сc]|открыт[ао]\s+запись|"
    r"спасибо\s+.*\s+за\s+рекомендац"
    r")"
)
# Own ads / marketplace / events — not third-party tips.
NOT_REC_RE = re.compile(
    r"(?i)(?:"
    r"прода[юём]|отдам|отдаю|сда[её]тся|сниму|ищу\s+съем|"
    r"кабинет\s+для|аренда\s+кабинет|"
    r"приглашаю\s+вас|приглашаем|"
    r"бесплатн\w+\s+(?:вебинар|занятие|встречу|образоват)|"
    r"арт[\-\s]?терапевт|изобилие|кукольн|спектакл|"
    r"групп[уыеа]\s+по\s+теннис|набор\s+в\s+групп|"
    r"инструменты\s+для\s+хэндимен|handyman|"
    r"credit\s+score|дилер(?:у|ом|а)?\b|broker|"
    r"access\s+california|страховщик|"
    r"требуется|ваканси|ищем\s+(?:сотрудник|работник|мастер)|"
    r"автомеханик|автоэлектрик|кузовн|frame\s+machine|стапель|"
    r"scottish\s+fold|kitten|available\s+\d+\s+weeks|boy\s+available|girl\s+available"
    r")"
)
# Compact tip: phone then a person name (Наргиза / Надя / Евгения).
PHONE_NAME_RE = re.compile(
    r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}[ \t]+"
    r"([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{2,40}"
    r"(?:[ \t]+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’\-]{2,40}){0,2})",
)
SHORT_REPLY_MAX = 180

CITY_AFTER_COMMA_RE = re.compile(
    r",\s*([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё .'\-]{2,40})\s*$",
    re.U,
)

BAD_SUBJECT_RE = re.compile(
    r"(?i)(?:подробн|ссылк|разбер|девушк|привет|здравствуй|приглаш|"
    r"аренда|кабинет|прода|отдам|вебинар|занятие|встречу|"
    r"whatsapp|email|telegram|instagram|пожалуйста|the\b|best\b|"
    r"access|please|http|www|phone|call|text)"
)


def _norm(value: str | None) -> str:
    return re.sub(r"[^a-z0-9а-яё]+", "", (value or "").lower())


def _as_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str) and raw.strip():
        # Postgres array text dump «{+1…}»
        s = raw.strip()
        if s.startswith("{") and s.endswith("}"):
            inner = s[1:-1]
            if not inner:
                return []
            return [p.strip().strip('"') for p in inner.split(",") if p.strip()]
        return [s]
    return []


def _first_phone(phones: list[str]) -> str | None:
    for p in phones:
        n = normalize_phone(p)
        if n:
            return n
    return None


def _contacts_from_item(item: dict[str, Any]) -> dict[str, list[str]]:
    phones: list[str] = []
    for p in _as_list(item.get("phone")):
        n = normalize_phone(p)
        if n and n not in phones:
            phones.append(n)
    igs: list[str] = []
    for raw in _as_list(item.get("instagram")):
        h = normalize_instagram(raw)
        if h and h not in igs:
            igs.append(h)
    websites: list[str] = []
    for w in _as_list(item.get("website")):
        w = str(w).strip()
        if w and w not in websites:
            websites.append(w[:300])
    tg = item.get("telegram_username")
    if tg:
        h = normalize_telegram_username(str(tg))
        if h:
            websites.append(f"https://t.me/{h}")
    return {"phones": phones, "instagram": igs, "websites": websites}


def _cluster_key(contacts: dict[str, list[str]]) -> str | None:
    if contacts.get("phones"):
        # Match telegram extractor / existing rows: phone:+1XXXXXXXXXX
        return f"phone:{contacts['phones'][0]}"
    if contacts.get("instagram"):
        return f"ig:{contacts['instagram'][0].lower()}"
    for w in contacts.get("websites") or []:
        if "t.me/" in w.lower():
            handle = w.rstrip("/").split("/")[-1]
            tg = normalize_telegram_username(handle)
            if tg:
                return f"tg:{tg.lower()}"
    return None


def _names_overlap(a: str | None, b: str | None) -> bool:
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    return na in nb or nb in na


def _infer_city(text: str, item: dict[str, Any]) -> str | None:
    city = (item.get("city") or "").strip() or None
    if city:
        return city[:80]
    m = CITY_AFTER_COMMA_RE.search((text or "").strip())
    if m:
        cand = m.group(1).strip(" .")
        if len(cand) >= 3 and not re.search(r"\d", cand):
            return cand[:80]
    return None


def _looks_like_person(name: str | None) -> bool:
    if not name:
        return False
    value = re.sub(r"\s+", " ", name).strip(" -–—,.;:")
    if BAD_SUBJECT_RE.search(value):
        return False
    parts = [p for p in value.split(" ") if p]
    if not 1 <= len(parts) <= 3:
        return False
    if any(len(p) < 2 or re.search(r"\d", p) for p in parts):
        return False
    if not all(re.match(r"^[A-ZА-ЯЁ]", p) for p in parts):
        return False
    return True


def _has_identity_contact(contacts: dict[str, list[str]]) -> bool:
    """Phone or Instagram — websites alone (Jotform etc.) are not enough."""
    return bool(contacts.get("phones") or contacts.get("instagram"))


def classify_item(item: dict[str, Any]) -> dict[str, Any] | None:
    """Return candidate payload or None if this is not a third-party rec."""
    text = (item.get("source_text") or item.get("description") or "").strip()
    if not text or len(text) > 4000:
        return None
    if SELF_AD_RE.search(text) or NOT_REC_RE.search(text):
        return None

    contacts = _contacts_from_item(item)
    if not _has_identity_contact(contacts):
        return None

    author = (item.get("source_author_display_name") or "").strip() or None
    person = (item.get("person_name") or "").strip() or None
    business = (item.get("business_name") or "").strip() or None

    phone_name = None
    m = PHONE_NAME_RE.search(text)
    if m:
        phone_name = m.group(1).strip(" ,.;")
        if not _looks_like_person(phone_name):
            phone_name = None

    subject = phone_name or recommended_subject_name(text)
    if subject and not _looks_like_person(subject):
        subject = None

    author_is_person = bool(author and person and _names_overlap(author, person))
    subject_is_author = bool(subject and author and _names_overlap(subject, author))

    has_rec_signal = bool(REC_SIGNAL_RE.search(text))
    short_reply = len(text) <= SHORT_REPLY_MAX

    is_rec = False
    reason = ""

    # Strongest: compact «+1 … Наргиза, Ирвайн» tip (not a long self-ad with a phone).
    if phone_name and not subject_is_author and (short_reply or has_rec_signal):
        is_rec = True
        reason = "phone_name_line"
        subject = phone_name
    elif subject and not subject_is_author and has_rec_signal and short_reply:
        is_rec = True
        reason = "rec_signal_subject"
    elif (
        subject
        and not subject_is_author
        and short_reply
        and author_is_person
        and contacts.get("phones")
        and has_rec_signal
    ):
        is_rec = True
        reason = "short_reply_other_name"
    elif has_rec_signal and short_reply and (contacts.get("phones") or contacts.get("instagram")):
        # «Советую @handle» / «советую вот номер» without parseable name
        is_rec = True
        reason = "rec_signal_contact_only"
        subject = None
    else:
        return None

    city = _infer_city(text, item)
    display = subject if _looks_like_person(subject) else None
    clarity = "card_ready" if display else "contact_only"

    key = _cluster_key(contacts)
    if not key:
        return None

    return {
        "import_id": item["id"],
        "reason": reason,
        "clarity": clarity,
        "cluster_key": key,
        "display_name": display,
        "recommender": author,
        "city": city,
        "phones": contacts["phones"],
        "instagram": contacts["instagram"],
        "websites": contacts["websites"],
        "source_text": text[:500],
        "source_url": item.get("source_url"),
        "source_group": item.get("source_group"),
        "source_posted_at": item.get("source_posted_at"),
        "person_name_was": person,
        "business_name_was": business,
        "entity_type_was": item.get("entity_type"),
    }


def fetch_pending(client: SupabaseRest, *, limit: int | None) -> list[dict[str, Any]]:
    select = (
        "id,review_status,entity_type,person_name,business_name,title,"
        "phone,instagram,website,telegram_username,city,"
        "source_text,description,source_url,source_group,"
        "source_author_display_name,source_posted_at"
    )
    rows: list[dict[str, Any]] = []
    offset = 0
    page = 200
    while True:
        batch = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": select,
                    "review_status": "eq.pending",
                    "order": "created_at.asc",
                    "offset": str(offset),
                    "limit": str(page),
                },
            )
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        if limit is not None and len(rows) >= limit * 5:
            # Over-fetch then classify; hard stop below.
            break
        if len(batch) < page:
            break
    return rows


def upsert_recommendation(client: SupabaseRest, cand: dict[str, Any]) -> str | None:
    """Insert or merge into import_comment_recommendations. Returns row id."""
    notes = (
        f"clarity:{cand['clarity']}; "
        f"from_import_review:{cand['import_id']}; "
        f"detect:{cand['reason']}"
    )
    existing = (
        client._request(
            "GET",
            "/import_comment_recommendations",
            params={
                "select": "id,comment_texts,recommender_names,source_post_urls,"
                "source_groups,third_party_mention_count,mention_count,notes,"
                "display_name,city,status",
                "source_channel": "eq.telegram",
                "cluster_key": f"eq.{cand['cluster_key']}",
                "limit": "1",
            },
        )
        or []
    )
    snippet = cand["source_text"]
    if existing:
        row = existing[0]
        comments = list(row.get("comment_texts") or [])
        if snippet and snippet not in comments:
            comments = ([snippet] + comments)[:12]
        recommenders = list(row.get("recommender_names") or [])
        if cand.get("recommender") and cand["recommender"] not in recommenders:
            recommenders = ([cand["recommender"]] + recommenders)[:12]
        urls = list(row.get("source_post_urls") or [])
        if cand.get("source_url") and cand["source_url"] not in urls:
            urls = ([cand["source_url"]] + urls)[:12]
        groups = list(row.get("source_groups") or [])
        if cand.get("source_group") and cand["source_group"] not in groups:
            groups.append(cand["source_group"])
        patch: dict[str, Any] = {
            "comment_texts": comments,
            "recommender_names": recommenders,
            "source_post_urls": urls,
            "source_groups": groups,
            "mention_count": int(row.get("mention_count") or 0) + 1,
            "third_party_mention_count": int(row.get("third_party_mention_count") or 0)
            + 1,
            "notes": notes
            if not row.get("notes")
            else f"{row.get('notes')}; {notes}"[:500],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if cand.get("display_name") and not (row.get("display_name") or "").strip():
            patch["display_name"] = cand["display_name"]
        if cand.get("city") and not (row.get("city") or "").strip():
            patch["city"] = cand["city"]
        # Keep pending if still open; don't reopen merged/rejected.
        if row.get("status") in (None, "pending", "suspected_duplicate"):
            patch["status"] = "pending"
        client._request(
            "PATCH",
            "/import_comment_recommendations",
            params={"id": f"eq.{row['id']}"},
            body=patch,
            prefer="return=minimal",
        )
        return str(row["id"])

    body = {
        "cluster_key": cand["cluster_key"],
        "kind": "profi",
        "display_name": cand.get("display_name"),
        "phones": cand.get("phones") or [],
        "instagram": cand.get("instagram") or [],
        "websites": cand.get("websites") or [],
        "mention_count": 1,
        "third_party_mention_count": 1,
        "self_ad_mention_count": 0,
        "comment_texts": [snippet] if snippet else [],
        "request_snippets": [],
        "source_post_urls": [cand["source_url"]] if cand.get("source_url") else [],
        "source_groups": [cand["source_group"]] if cand.get("source_group") else [],
        "category_guess": "услуга / специалист",
        "recommender_names": [cand["recommender"]] if cand.get("recommender") else [],
        "last_posted_at": cand.get("source_posted_at"),
        "source_channel": "telegram",
        "status": "pending",
        "notes": notes,
        "city": cand.get("city"),
        "target_bucket": "professional" if cand["clarity"] == "card_ready" else "unclassified",
    }
    created = client._request(
        "POST",
        "/import_comment_recommendations",
        body=body,
        prefer="return=representation",
    )
    if isinstance(created, list) and created:
        return str(created[0].get("id"))
    if isinstance(created, dict) and created.get("id"):
        return str(created["id"])
    # Fallback read
    again = (
        client._request(
            "GET",
            "/import_comment_recommendations",
            params={
                "select": "id",
                "source_channel": "eq.telegram",
                "cluster_key": f"eq.{cand['cluster_key']}",
                "limit": "1",
            },
        )
        or []
    )
    return str(again[0]["id"]) if again else None


def close_import_item(
    client: SupabaseRest,
    *,
    import_id: str,
    rec_id: str | None,
    clarity: str,
    reason: str,
) -> None:
    notes = (
        f"reclassified_as_recommendation clarity={clarity} "
        f"detect={reason} rec_id={rec_id or 'n/a'}"
    )
    body: dict[str, Any] = {
        "review_status": "rejected",
        "reject_reason": "third_party_recommendation",
        "review_notes": notes[:500],
        "classification_reason": notes[:500],
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    if rec_id:
        # Soft pointer for audits (not a published entity).
        body["duplicate_of_entity_type"] = "recommendation"
        body["duplicate_of_entity_id"] = rec_id
    client._request(
        "PATCH",
        "/import_review_items",
        params={"id": f"eq.{import_id}"},
        body=body,
        prefer="return=minimal",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--id",
        type=str,
        default=None,
        help="Single import_review item id (smoke)",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        args.dry_run = True

    load_env()
    import os

    client = SupabaseRest(
        os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    if args.id:
        rows = (
            client._request(
                "GET",
                "/import_review_items",
                params={
                    "select": (
                        "id,review_status,entity_type,person_name,business_name,title,"
                        "phone,instagram,website,telegram_username,city,"
                        "source_text,description,source_url,source_group,"
                        "source_author_display_name,source_posted_at"
                    ),
                    "id": f"eq.{args.id}",
                    "limit": "1",
                },
            )
            or []
        )
    else:
        rows = fetch_pending(client, limit=args.limit)

    candidates: list[dict[str, Any]] = []
    for item in rows:
        if item.get("review_status") and item["review_status"] != "pending" and not args.id:
            continue
        hit = classify_item(item)
        if hit:
            candidates.append(hit)

    if args.limit is not None:
        candidates = candidates[: args.limit]

    by_clarity = {"card_ready": 0, "contact_only": 0}
    by_reason: dict[str, int] = {}
    for c in candidates:
        by_clarity[c["clarity"]] = by_clarity.get(c["clarity"], 0) + 1
        by_reason[c["reason"]] = by_reason.get(c["reason"], 0) + 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "scanned": len(rows),
        "matched": len(candidates),
        "by_clarity": by_clarity,
        "by_reason": by_reason,
        "items": candidates,
    }
    out_path = OUT_DIR / f"{'apply' if args.apply else 'dry'}_{stamp}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "mode": report["mode"],
                "scanned": report["scanned"],
                "matched": report["matched"],
                "by_clarity": by_clarity,
                "by_reason": by_reason,
                "report": str(out_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    for c in candidates[:15]:
        print(
            f"- [{c['clarity']}/{c['reason']}] {c['display_name'] or '—'} "
            f"← {c.get('recommender') or '?'} | {c['phones'][:1] or c['instagram'][:1]} "
            f"| {(c['source_text'] or '')[:70]!r}"
        )

    if not args.apply:
        return 0

    ok = 0
    errors: list[str] = []
    for c in candidates:
        try:
            rec_id = upsert_recommendation(client, c)
            close_import_item(
                client,
                import_id=c["import_id"],
                rec_id=rec_id,
                clarity=c["clarity"],
                reason=c["reason"],
            )
            c["recommendation_id"] = rec_id
            ok += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{c['import_id']}: {exc}"[:300])

    report["applied"] = ok
    report["errors"] = errors
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"applied": ok, "errors": len(errors)}, ensure_ascii=False))
    for e in errors[:10]:
        print("ERR", e)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
