#!/usr/bin/env python3
"""Find cards that hold more than one advertiser, published and pending.

Three questions per card:

1. glued — does the card body carry contacts of several different advertisers
   (two identity domains, two Instagram accounts, separate contact blocks)?
   Those must be split into one card per advertiser.
2. multi_service_profile — one advertiser offering several distinct services
   from one contact set, with nothing in business_offers / professional_services?
   Those stay one card and the offers move into the services list.
3. should_be_business — a specialist card that actually fronts a named business
   with its own website? Those deserve a business card.

Usage:
  python3 scripts/import-review/audit_glued_cards.py --dry-run
  python3 scripts/import-review/audit_glued_cards.py --dry-run --scope published
  python3 scripts/import-review/audit_glued_cards.py --dry-run --scope queue
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from dedupe import SHARED_WEB_HOSTS  # noqa: E402

try:
    from channel_noise import is_subject, load_noise

    CHANNEL_NOISE = load_noise()
except Exception:  # noqa: BLE001 - the list is optional until it is built
    CHANNEL_NOISE = {"instagram": set(), "domains": set(), "phones": set()}

    def is_subject(contact: str, *names: str) -> bool:  # type: ignore[misc]
        return False

OPEN_STATUSES = ("pending", "in_review", "ready_to_publish", "needs_more_info")

FREE_MAIL = {
    "gmail.com", "yahoo.com", "mail.ru", "yandex.ru", "icloud.com", "me.com",
    "outlook.com", "hotmail.com", "live.com", "aol.com", "proton.me",
    "protonmail.com", "inbox.ru", "list.ru", "bk.ru", "ukr.net", "rambler.ru",
    "msn.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net",
}
# Booking / site-builder / marketplace SaaS: identity is the path, not the host.
SAAS_HOSTS = {
    "glossgenius.com", "vagaro.com", "styleseat.com", "calendly.com",
    "setmore.com", "acuityscheduling.com", "schedulicity.com", "fresha.com",
    "wixsite.com", "weebly.com", "wordpress.com", "blogspot.com", "webflow.io",
    "myshopify.com", "etsy.com", "ebay.com", "amazon.com", "walmart.com",
    "doordash.com", "ubereats.com", "grubhub.com", "opentable.com",
    "zocdoc.com", "healthgrades.com", "vsee.me", "venmo.com", "paypal.com",
    "cash.app", "zellepay.com", "gofundme.com", "patreon.com", "notion.site",
    "canva.site", "carrd.co", "beacons.ai", "taplink.cc", "getsquire.com",
    "sites.google.com", "drive.google.com", "apple.com", "microsoft.com",
    "mangomint.com", "boulevard.io", "square.com", "stripe.com", "toasttab.com",
    "clover.com", "wellnessliving.com", "mindbodyonline.com", "showingnew.com",
    "zillow.com", "realtor.com", "redfin.com", "compass.com", "kw.com",
    "openai.com", "chatgpt.com", "chat.openai.com", "wikipedia.org",
    "eventbrite.com", "meetup.com", "airtable.com", "typeform.com",
    "jotform.com", "surveymonkey.com", "zoom.us", "teams.microsoft.com",
}

TLDS = {
    "com", "net", "org", "io", "co", "us", "ru", "ua", "me", "biz", "info",
    "site", "shop", "store", "online", "app", "dev", "life", "club", "pro",
    "salon", "beauty", "studio", "agency", "services", "team", "art", "photo",
    "email", "link", "page", "space", "world", "today", "center", "expert",
}
URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?"
    r"((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})"
    r"(?:/[^\s,;)\]\"'<>]*)?",
    re.I,
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}")
IG_RE = re.compile(
    r"(?:instagram\.com/|@)([A-Za-z][A-Za-z0-9._]{2,29})",
    re.I,
)
BRAND_RE = re.compile(
    r"\b(llc|inc\.?|corp\.?|company|studio|salon|clinic|academy|agency|center|"
    r"boutique|bakery|market|shop|store|group|компани[яи]|студия|салон|клиника|"
    r"агентство|центр|школа|бутик|пекарня|магазин|мастерская)\b",
    re.I,
)
PRICE_LINE_RE = re.compile(
    r"^\s*[•\-–—*✔✅🔹]?\s*(.{3,80}?)\s*[—\-–:]\s*(?:от\s*)?\$?\s*\d{2,5}",
    re.M,
)
CONTACT_HINT_RE = re.compile(
    r"(?:\+?\d[\d\-\s().]{8,}\d)|@[A-Za-z][A-Za-z0-9._]{2,}|"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:https?://|www\.)",
    re.I,
)


def registrable(host: str) -> str | None:
    host = (host or "").strip().lower().rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    parts = host.split(".")
    if len(parts) < 2 or parts[-1] not in TLDS:
        return None
    base = ".".join(parts[-2:])
    if base in SHARED_WEB_HOSTS or base in FREE_MAIL or base in SAAS_HOSTS:
        return None
    shared = SHARED_WEB_HOSTS | SAAS_HOSTS
    if any(host.endswith("." + s) for s in shared):
        return None
    return base


def strip_emails(text: str) -> str:
    """Domains inside an address belong to the mailbox, not to a second advertiser."""
    return EMAIL_RE.sub(" ", text or "")


def domains(text: str) -> set[str]:
    out: set[str] = set()
    for match in URL_RE.finditer(strip_emails(text)):
        base = registrable(match.group(1))
        if base:
            out.add(base)
    return out


def phones(text: str) -> set[str]:
    out: set[str] = set()
    for raw in PHONE_RE.findall(text or ""):
        digits = re.sub(r"\D", "", raw)
        if len(digits) >= 10:
            out.add(digits[-10:])
    return out


def instagrams(text: str) -> set[str]:
    out: set[str] = set()
    for handle in IG_RE.findall(strip_emails(text)):
        value = handle.lower().strip(".")
        if "." in value and value.rsplit(".", 1)[-1] in TLDS:
            continue
        if value in {"gmail", "mail", "yahoo", "icloud", "hotmail", "outlook"}:
            continue
        out.add(value)
    return out


def emails(text: str) -> set[str]:
    return {m.lower() for m in EMAIL_RE.findall(text or "")}


def collapse_variants(values: set[str]) -> list[str]:
    """`klounailstudio` and `klounailstudio_` are one account, not two owners."""
    keys = sorted({letters(v): v for v in values}.items())
    kept: list[tuple[str, str]] = []
    for key, original in keys:
        if any(key.startswith(other) or other.startswith(key) for other, _ in kept):
            continue
        kept.append((key, original))
    return sorted(original for _, original in kept)


def contact_blocks(text: str) -> int:
    """How many paragraphs carry their own contact details."""
    blocks = [b for b in re.split(r"\n\s*\n", text or "") if b.strip()]
    return sum(1 for b in blocks if CONTACT_HINT_RE.search(b))


def diagnose_card(card: dict[str, Any], *, use_noise: bool = True) -> dict[str, Any]:
    """`use_noise=False` measures the raw corpus, which is how the list is built."""
    blob = card["blob"]
    noise_domains = CHANNEL_NOISE["domains"] if use_noise else set()
    noise_handles = CHANNEL_NOISE["instagram"] if use_noise else set()
    raw_domains = domains(blob) | {
        d for value in card["structured_urls"] for d in domains(str(value or ""))
    }
    names = (card["title"], card["slug"] or "")
    raw_domains = {
        d for d in raw_domains if d not in noise_domains or is_subject(d, *names)
    }
    brand_to_domain = {d.rsplit(".", 1)[0]: d for d in sorted(raw_domains)}
    doms = {brand_to_domain[b] for b in collapse_variants(set(brand_to_domain))}
    ph = phones(blob) | {
        p for value in card["structured_phones"] for p in phones(str(value or ""))
    }
    igs = set(
        collapse_variants(
            {
                h
                for h in instagrams(blob)
                if h not in noise_handles or is_subject(h, *names)
            }
        )
    )
    mails = emails(blob) | {
        m for value in card["structured_emails"] for m in emails(str(value or ""))
    }
    mail_domains = {
        m.split("@")[-1] for m in mails if m.split("@")[-1] not in FREE_MAIL
    }
    blocks = contact_blocks(card["body"])

    reasons: list[str] = []
    if len(doms) >= 2:
        reasons.append(f"domains:{sorted(doms)}")
    if len(igs) >= 2:
        reasons.append(f"instagram:{sorted(igs)}")
    if len(mail_domains) >= 2:
        reasons.append(f"email_domains:{sorted(mail_domains)}")
    # Several phone numbers only mean two advertisers when they sit in
    # separate contact blocks — one shop legitimately lists cell + office.
    if len(ph) >= 4 and blocks >= 3:
        reasons.append(f"phones:{len(ph)}+blocks:{blocks}")

    price_items = [m.strip() for m in PRICE_LINE_RE.findall(card["body"])]
    return {
        "domains": sorted(doms),
        "phones": sorted(ph),
        "instagram": sorted(igs),
        "emails": sorted(mails),
        "contact_blocks": blocks,
        "glue_reasons": reasons,
        "price_items": price_items[:12],
    }


def letters(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def classify(card: dict[str, Any], facts: dict[str, Any]) -> list[str]:
    verdicts: list[str] = []
    if facts["glue_reasons"]:
        verdicts.append("glued")

    single_owner = not facts["glue_reasons"]
    profile_kind = card["kind"] in {"business", "professional"} or card["kind"].startswith(
        "queue"
    )
    if (
        single_owner
        and profile_kind
        and len(facts["price_items"]) >= 3
        and card["offers_count"] == 0
    ):
        verdicts.append("multi_service_profile")

    if card["kind"] in {"professional", "queue_specialist"} and len(facts["domains"]) == 1:
        domain_brand = letters(facts["domains"][0].rsplit(".", 1)[0])
        title_key = letters(card["title"])
        # Own brand: the domain repeats the card name, or the name reads as a
        # company rather than a person.
        own_brand = bool(title_key) and (
            title_key in domain_brand or domain_brand.startswith(title_key)
        )
        if own_brand or BRAND_RE.search(card["title"]):
            verdicts.append("should_be_business")
        else:
            verdicts.append("should_be_business_check")

    return verdicts


def make_card(
    *,
    kind: str,
    row: dict[str, Any],
    title_fields: tuple[str, ...],
    body_fields: tuple[str, ...],
    url_fields: tuple[str, ...],
    phone_fields: tuple[str, ...],
    email_fields: tuple[str, ...],
    offers: list[dict[str, Any]],
) -> dict[str, Any]:
    title = next((str(row.get(f)) for f in title_fields if row.get(f)), "")
    body = "\n\n".join(str(row.get(f) or "") for f in body_fields if row.get(f))
    offer_text = "\n".join(
        f"{o.get('title') or ''} {o.get('description') or ''}" for o in offers
    )
    return {
        "kind": kind,
        "id": str(row.get("id")),
        "slug": row.get("slug"),
        "title": title,
        "status": row.get("status") or row.get("review_status"),
        "body": body,
        "blob": f"{title}\n{body}\n{offer_text}",
        "structured_urls": [row.get(f) for f in url_fields],
        "structured_phones": [row.get(f) for f in phone_fields],
        "structured_emails": [row.get(f) for f in email_fields],
        "offers_count": len(offers),
        "source_url": row.get("source_url"),
    }


def fetch_all(
    client: SupabaseRest, table: str, params: dict[str, str], page: int = 500
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        query = dict(params)
        query["limit"] = str(page)
        query["offset"] = str(offset)
        try:
            batch = client._request("GET", f"/{table}", params=query) or []
        except RuntimeError as exc:
            if "57014" in str(exc) and page > 25:
                page //= 2
                continue
            raise
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += len(batch)
    return rows


def collect(client: SupabaseRest, scope: str) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []

    if scope in {"all", "published"}:
        offers_by_business: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for offer in fetch_all(
            client, "business_offers", {"select": "business_id,title,description"}
        ):
            offers_by_business[str(offer["business_id"])].append(offer)
        services_by_pro: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for service in fetch_all(
            client, "professional_services", {"select": "professional_id,title,description"}
        ):
            services_by_pro[str(service["professional_id"])].append(service)

        for row in fetch_all(
            client,
            "businesses",
            {
                "select": (
                    "id,slug,name,description,short_description,phone,email,website,"
                    "instagram_url,telegram_url,booking_url,yelp_url,google_maps_url,"
                    "status,source_url,source_kind"
                ),
                "status": "eq.approved",
            },
        ):
            cards.append(
                make_card(
                    kind="business",
                    row=row,
                    title_fields=("name",),
                    body_fields=("short_description", "description"),
                    url_fields=("website", "instagram_url", "booking_url"),
                    phone_fields=("phone",),
                    email_fields=("email",),
                    offers=offers_by_business.get(str(row["id"]), []),
                )
            )

        for row in fetch_all(
            client,
            "professionals",
            {
                "select": (
                    "id,slug,display_name,headline,card_summary,description,"
                    "short_description,phone,email,website,instagram_url,telegram_url,"
                    "booking_url,employer_name,status,source_url,source_type"
                ),
                "status": "eq.approved",
            },
        ):
            cards.append(
                make_card(
                    kind="professional",
                    row=row,
                    title_fields=("display_name",),
                    body_fields=("headline", "short_description", "description"),
                    url_fields=("website", "instagram_url", "booking_url"),
                    phone_fields=("phone",),
                    email_fields=("email",),
                    offers=services_by_pro.get(str(row["id"]), []),
                )
            )

        for row in fetch_all(
            client,
            "listings",
            {
                "select": "id,title,description,listing_type,status,source_url,source_kind",
                "status": "eq.active",
            },
        ):
            cards.append(
                make_card(
                    kind=f"listing:{row.get('listing_type')}",
                    row=row,
                    title_fields=("title",),
                    body_fields=("description",),
                    url_fields=("source_url",),
                    phone_fields=(),
                    email_fields=(),
                    offers=[],
                )
            )

        for row in fetch_all(
            client,
            "events",
            {
                "select": (
                    "id,slug,title,description,venue_name,registration_url,"
                    "status,source_url"
                )
            },
        ):
            cards.append(
                make_card(
                    kind="event",
                    row=row,
                    title_fields=("title",),
                    body_fields=("description",),
                    url_fields=("registration_url",),
                    phone_fields=(),
                    email_fields=(),
                    offers=[],
                )
            )

    if scope in {"all", "queue"}:
        for row in fetch_all(
            client,
            "import_review_items",
            {
                "select": (
                    "id,title,business_name,person_name,description,entity_type,"
                    "target_collection,review_status,phone,email,website,instagram,"
                    "services,source_url,source_text"
                ),
                "review_status": f"in.({','.join(OPEN_STATUSES)})",
            },
            page=200,
        ):
            kind = "queue"
            if row.get("entity_type") == "private_specialist":
                kind = "queue_specialist"
            elif row.get("entity_type"):
                kind = f"queue:{row['entity_type']}"
            services = row.get("services") or []
            card = make_card(
                kind=kind,
                row=row,
                title_fields=("business_name", "title", "person_name"),
                body_fields=("description",),
                url_fields=("website",),
                phone_fields=("phone",),
                email_fields=("email",),
                offers=[{"title": s} for s in services if isinstance(s, str)],
            )
            card["structured_urls"] = [
                json.dumps(row.get("website") or [], ensure_ascii=False),
                json.dumps(row.get("instagram") or [], ensure_ascii=False),
            ]
            card["structured_phones"] = [
                json.dumps(row.get("phone") or [], ensure_ascii=False)
            ]
            card["structured_emails"] = [
                json.dumps(row.get("email") or [], ensure_ascii=False)
            ]
            cards.append(card)

    return cards


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit glued / multi-service cards")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--scope", choices=("all", "published", "queue"), default="all")
    parser.add_argument("--sample", type=int, default=12)
    args = parser.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    cards = collect(client, args.scope)
    print(f"Scanned cards: {len(cards)}")

    findings: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_kind: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    # A handle or domain riding on dozens of unrelated cards belongs to the
    # channel (ad manager, affiliate footer), not to the advertiser.
    handle_freq: dict[str, int] = defaultdict(int)
    domain_freq: dict[str, int] = defaultdict(int)
    for card in cards:
        facts = diagnose_card(card)
        for handle in facts["instagram"]:
            handle_freq[handle] += 1
        for domain in facts["domains"]:
            domain_freq[domain] += 1
        verdicts = classify(card, facts)
        if not verdicts:
            continue
        entry = {
            "kind": card["kind"],
            "id": card["id"],
            "slug": card["slug"],
            "title": card["title"][:120],
            "status": card["status"],
            "verdicts": verdicts,
            "domains": facts["domains"],
            "instagram": facts["instagram"],
            "phones": facts["phones"],
            "emails": facts["emails"],
            "contact_blocks": facts["contact_blocks"],
            "glue_reasons": facts["glue_reasons"],
            "price_items": facts["price_items"],
            "offers_count": card["offers_count"],
            "source_url": card["source_url"],
            "body": card["body"][:600],
        }
        for verdict in verdicts:
            findings[verdict].append(entry)
            by_kind[verdict][card["kind"]] += 1

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = ROOT / "docs" / "audits" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": stamp,
        "scope": args.scope,
        "cards_scanned": len(cards),
        "totals": {k: len(v) for k, v in findings.items()},
        "by_kind": {k: dict(v) for k, v in by_kind.items()},
        "channel_noise_candidates": {
            "instagram": sorted(
                ((h, n) for h, n in handle_freq.items() if n >= 5),
                key=lambda x: -x[1],
            ),
            "domains": sorted(
                ((d, n) for d, n in domain_freq.items() if n >= 5),
                key=lambda x: -x[1],
            ),
        },
        "findings": {k: v for k, v in findings.items()},
    }
    (out_dir / f"glued_cards_{args.scope}_{stamp}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / f"glued_cards_{args.scope}_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(report["totals"], ensure_ascii=False))
    print(json.dumps(report["by_kind"], ensure_ascii=False, indent=2))
    for verdict, items in findings.items():
        print(f"\n=== {verdict} ({len(items)}) ===")
        for e in items[: args.sample]:
            print(
                f"- [{e['kind']}] {e['title']!r} {e['slug'] or e['id'][:8]} "
                f"{e['glue_reasons']} domains={e['domains'][:3]} ig={e['instagram'][:3]}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
