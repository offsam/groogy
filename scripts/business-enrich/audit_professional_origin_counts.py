#!/usr/bin/env python3
"""Audit approved professionals against recommendation clusters.

Matches by normalized phone / Instagram handle to
import_comment_recommendations (and local telegram cluster JSON).
Writes third_party_mention_count / self_ad_mention_count when matched;
leaves null (skipped) when no contact match is possible.

Usage:
  python3 scripts/business-enrich/audit_professional_origin_counts.py
  python3 scripts/business-enrich/audit_professional_origin_counts.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
sys.path.insert(0, str(ROOT / "scripts" / "telegram-collector"))

from common import SupabaseRest, load_env  # noqa: E402
from eligibility import normalize_instagram, normalize_phone  # noqa: E402

OUT_JSON = (
    ROOT
    / "scripts"
    / "business-enrich"
    / "data"
    / "professional_origin_audit.json"
)
TG_CLUSTERS = (
    ROOT
    / "scripts"
    / "telegram-collector"
    / "data"
    / "telegram_recommendations_clusters.json"
)


def norm_phone(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return normalize_phone(value)
    except Exception:  # noqa: BLE001
        digits = re.sub(r"\D", "", str(value))
        if len(digits) == 11 and digits.startswith("1"):
            return f"+{digits}"
        if len(digits) == 10:
            return f"+1{digits}"
        if len(digits) >= 10:
            return f"+{digits}"
        return None


def ig_handle(value: str | None) -> str | None:
    if not value:
        return None
    raw = str(value).strip()
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", raw, re.I)
    if m:
        return m.group(1).lower().rstrip(".")
    try:
        return normalize_instagram(raw)
    except Exception:  # noqa: BLE001
        handle = raw.lstrip("@").lower()
        if re.match(r"^[a-z0-9._]{3,30}$", handle):
            return handle
        return None


def fetch_all(
    client: SupabaseRest,
    path: str,
    select: str,
    extra: dict[str, str] | None = None,
    *,
    id_col: str = "id",
) -> list[dict[str, Any]]:
    """Keyset pagination — PostgREST offset drifts on large tables."""
    out: list[dict[str, Any]] = []
    last: str | None = None
    while True:
        cols = select if id_col in select.split(",") else f"{select},{id_col}"
        params: dict[str, str] = {
            "select": cols,
            "order": f"{id_col}.asc",
            "limit": "1000",
        }
        if last is not None:
            params[id_col] = f"gt.{last}"
        if extra:
            for k, v in extra.items():
                if k == "order":
                    continue
                params[k] = v
        batch = client._request("GET", path, params=params) or []
        out.extend(batch)
        if len(batch) < 1000:
            break
        cursor = batch[-1].get(id_col)
        if cursor is None:
            break
        last = str(cursor)
    return out


def is_imported_self_ad_source(source_type: str | None, source_url: str | None) -> bool:
    """Card came from a community self-post (Telegram/Facebook), not a user signup."""
    st = (source_type or "").strip().upper()
    if st in {"TELEGRAM", "FACEBOOK"}:
        return True
    if st == "IMPORT" and source_url:
        url = source_url.lower()
        if "t.me/" in url or "telegram.me/" in url or "facebook.com/" in url or "fb.com/" in url:
            return True
    return False


def name_tokens(value: str | None) -> set[str]:
    if not value:
        return set()
    cleaned = re.sub(r"[^\w\s]+", " ", value.lower(), flags=re.UNICODE)
    stop = {
        "llc",
        "inc",
        "the",
        "and",
        "для",
        "и",
        "на",
        "по",
        "studio",
        "service",
        "services",
        "law",
        "firm",
    }
    return {
        t
        for t in cleaned.split()
        if len(t) >= 3 and t not in stop and not t.isdigit()
    }


COMMON_NAME_TOKENS = {
    "anna",
    "анна",
    "maria",
    "мария",
    "marina",
    "марина",
    "olga",
    "ольга",
    "elena",
    "елена",
    "irina",
    "ирина",
    "natalia",
    "наталья",
    "наталия",
    "svetlana",
    "светлана",
    "tatiana",
    "татьяна",
    "yulia",
    "юлия",
    "julia",
    "alina",
    "алина",
    "daria",
    "дария",
    "дарья",
    "viktoria",
    "viktoriia",
    "виктория",
    "ekaterina",
    "екатерина",
    "alex",
    "alexander",
    "александр",
    "alexandra",
    "александра",
    "andrey",
    "андрей",
    "andrej",
    "dmitry",
    "дмитрий",
    "sergey",
    "сергей",
    "igor",
    "игорь",
    "ivan",
    "иван",
    "maxim",
    "максим",
    "nikita",
    "никита",
    "michael",
    "mike",
    "михаил",
    "denis",
    "денис",
    "roman",
    "роман",
    "valeria",
    "valeriia",
    "валерия",
    "angelina",
    "ангелина",
    "kristina",
    "кристина",
    "oksana",
    "оксана",
    "vera",
    "вера",
    "nina",
    "нина",
    "lilia",
    "лилия",
    "mila",
    "мила",
    "kate",
    "katya",
    "катя",
    "phone",
    "messenger",
    "realtor",
    "studio",
    "service",
    "services",
    "llc",
    "inc",
}


def names_compatible(pro_name: str | None, cluster_name: str | None) -> bool:
    a = name_tokens(pro_name)
    b = name_tokens(cluster_name)
    if not a or not b:
        return False
    shared = a & b
    if not shared:
        # substring for compound brands (Arvian / Kristina @ Arvian)
        pa = (pro_name or "").lower()
        cb = (cluster_name or "").lower()
        for token in a:
            if len(token) >= 5 and token not in COMMON_NAME_TOKENS and token in cb:
                return True
        for token in b:
            if len(token) >= 5 and token not in COMMON_NAME_TOKENS and token in pa:
                return True
        return False

    # Single shared common first name is not enough (Igor ≠ Igor Green firm).
    distinctive = {t for t in shared if t not in COMMON_NAME_TOKENS and len(t) >= 4}
    if distinctive:
        return True
    if len(shared) >= 2:
        return True
    # Both sides are single-token cards (e.g. «Амина» ↔ «Амина»).
    if len(a) == 1 and len(b) == 1 and next(iter(a)) == next(iter(b)):
        return True
    return False


def add_counts(
    phone_idx: dict[str, dict[str, dict[str, Any]]],
    ig_idx: dict[str, dict[str, dict[str, Any]]],
    *,
    cluster_key: str,
    display_name: str | None,
    phones: list[str],
    instagram: list[str],
    third: int,
    self_n: int,
) -> None:
    if third <= 0 and self_n <= 0:
        return
    payload = {
        "third": third,
        "self": self_n,
        "name": display_name,
        "ig": {ig_handle(x) for x in instagram if ig_handle(x)},
    }
    for p in phones:
        np = norm_phone(p)
        if np:
            phone_idx.setdefault(np, {})[cluster_key] = payload
    for ig in instagram:
        handle = ig_handle(ig)
        if handle:
            ig_idx.setdefault(handle, {})[cluster_key] = payload


def merge_hits_for_pro(
    *,
    pro_name: str | None,
    pro_ig: str | None,
    phone_hits: dict[str, dict[str, Any]],
    ig_hits: dict[str, dict[str, Any]],
) -> tuple[int, int, list[str]]:
    """Keep clusters only with IG identity or compatible display name.

    Phone alone is not enough — shared numbers / thread authors inflate
    self-ad counts onto the wrong professional.
    """
    merged: dict[str, dict[str, Any]] = {}
    merged.update(phone_hits)
    merged.update(ig_hits)
    kept: dict[str, dict[str, Any]] = {}
    for key, payload in merged.items():
        igs = payload.get("ig") or set()
        if pro_ig and pro_ig in igs:
            kept[key] = payload
            continue
        if names_compatible(pro_name, payload.get("name")):
            kept[key] = payload
            continue
        # Exact IG handle used as professional display_name / @handle card
        pro_as_ig = ig_handle(pro_name)
        if pro_as_ig and pro_as_ig in igs:
            kept[key] = payload
            continue
    if not kept:
        return 0, 0, []
    third = sum(int(v["third"]) for v in kept.values())
    self_n = sum(int(v["self"]) for v in kept.values())
    labels = [str(v.get("name") or key) for key, v in kept.items()]
    return third, self_n, labels


def build_indexes(client: SupabaseRest) -> tuple[
    dict[str, dict[str, dict[str, Any]]],
    dict[str, dict[str, dict[str, Any]]],
]:
    phone_idx: dict[str, dict[str, dict[str, Any]]] = {}
    ig_idx: dict[str, dict[str, dict[str, Any]]] = {}

    rows = fetch_all(
        client,
        "/import_comment_recommendations",
        "cluster_key,display_name,phones,instagram,third_party_mention_count,self_ad_mention_count,mention_count,recommender_names,source_channel",
        id_col="cluster_key",
    )
    for r in rows:
        third = int(r.get("third_party_mention_count") or 0)
        self_n = int(r.get("self_ad_mention_count") or 0)
        if third + self_n == 0:
            total = int(r.get("mention_count") or 0)
            if total <= 0:
                continue
            if r.get("recommender_names"):
                third = total
            else:
                self_n = total
        add_counts(
            phone_idx,
            ig_idx,
            cluster_key=str(r.get("cluster_key") or id(r)),
            display_name=r.get("display_name"),
            phones=list(r.get("phones") or []),
            instagram=list(r.get("instagram") or []),
            third=third,
            self_n=self_n,
        )

    if TG_CLUSTERS.exists():
        data = json.loads(TG_CLUSTERS.read_text(encoding="utf-8"))
        for r in data.get("items") or []:
            third = int(r.get("third_party_mention_count") or 0)
            self_n = int(r.get("self_ad_mention_count") or 0)
            if third + self_n == 0:
                continue
            key = str(r.get("cluster_key") or id(r))
            payload = {
                "third": third,
                "self": self_n,
                "name": r.get("display_name"),
                "ig": {
                    ig_handle(x)
                    for x in (r.get("instagram") or [])
                    if ig_handle(x)
                },
            }
            for p in r.get("phones") or []:
                np = norm_phone(p)
                if np and key not in phone_idx.get(np, {}):
                    phone_idx.setdefault(np, {})[key] = payload
            for ig in r.get("instagram") or []:
                handle = ig_handle(ig)
                if handle and key not in ig_idx.get(handle, {}):
                    ig_idx.setdefault(handle, {})[key] = payload

    return phone_idx, ig_idx


def audit(client: SupabaseRest) -> dict[str, Any]:
    phone_idx, ig_idx = build_indexes(client)
    pros = fetch_all(
        client,
        "/professionals",
        "id,display_name,slug,source_type,source_url,phone,instagram_url,website,"
        "third_party_mention_count,self_ad_mention_count",
        extra={"status": "eq.approved"},
    )

    updated: list[dict[str, Any]] = []
    cleared: list[dict[str, Any]] = []
    skipped_no_contact: list[dict[str, Any]] = []
    skipped_no_match: list[dict[str, Any]] = []
    floored_self_ad = 0
    from_cluster = 0

    for pro in pros:
        np = norm_phone(pro.get("phone"))
        handle = ig_handle(pro.get("instagram_url")) or ig_handle(pro.get("website"))
        name_as_ig = ig_handle(pro.get("display_name"))
        had_counts = (
            pro.get("third_party_mention_count") is not None
            or pro.get("self_ad_mention_count") is not None
        )
        imported_self = is_imported_self_ad_source(
            pro.get("source_type"), pro.get("source_url")
        )

        phone_hits = phone_idx.get(np or "", {}) if np else {}
        ig_hits: dict[str, dict[str, Any]] = {}
        if handle:
            ig_hits.update(ig_idx.get(handle, {}))
        if name_as_ig:
            ig_hits.update(ig_idx.get(name_as_ig, {}))

        third, self_n, labels = merge_hits_for_pro(
            pro_name=pro.get("display_name"),
            pro_ig=handle or name_as_ig,
            phone_hits=phone_hits,
            ig_hits=ig_hits,
        )
        had_cluster = third > 0 or self_n > 0
        match_via = "cluster" if had_cluster else None

        # Imported TG/FB self-posts: at least «сами ×1» even without cluster.
        if imported_self and self_n <= 0:
            self_n = 1
            if not labels:
                labels = ["source_type_self_ad_floor"]
            match_via = "cluster+source_floor" if had_cluster else "source_floor"
            floored_self_ad += 1
        if had_cluster:
            from_cluster += 1

        if third <= 0 and self_n <= 0:
            if not np and not handle and not name_as_ig:
                skipped_no_contact.append(
                    {
                        "id": pro["id"],
                        "name": pro.get("display_name"),
                        "slug": pro.get("slug"),
                        "source_type": pro.get("source_type"),
                        "reason": "no_phone_or_instagram",
                    }
                )
            else:
                skipped_no_match.append(
                    {
                        "id": pro["id"],
                        "name": pro.get("display_name"),
                        "slug": pro.get("slug"),
                        "phone": np,
                        "instagram": handle,
                        "source_type": pro.get("source_type"),
                        "reason": "no_compatible_cluster_match",
                    }
                )
            # Imported TG/FB cards keep a floor badge even when cluster evidence is gone.
            if imported_self:
                updated.append(
                    {
                        "id": pro["id"],
                        "name": pro.get("display_name"),
                        "slug": pro.get("slug"),
                        "source_type": pro.get("source_type"),
                        "third_party_mention_count": 0,
                        "self_ad_mention_count": 1,
                        "matched_clusters": ["source_type_self_ad_floor"],
                        "match_via": "source_floor",
                        "prev_third": pro.get("third_party_mention_count"),
                        "prev_self": pro.get("self_ad_mention_count"),
                    }
                )
                floored_self_ad += 1
                continue
            if had_counts and (
                int(pro.get("third_party_mention_count") or 0) > 0
                or int(pro.get("self_ad_mention_count") or 0) > 0
            ):
                cleared.append(
                    {
                        "id": pro["id"],
                        "name": pro.get("display_name"),
                        "reason": "clear_no_evidence",
                    }
                )
            continue

        updated.append(
            {
                "id": pro["id"],
                "name": pro.get("display_name"),
                "slug": pro.get("slug"),
                "source_type": pro.get("source_type"),
                "third_party_mention_count": third,
                "self_ad_mention_count": self_n,
                "matched_clusters": labels[:4],
                "match_via": match_via,
                "prev_third": pro.get("third_party_mention_count"),
                "prev_self": pro.get("self_ad_mention_count"),
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "professionals": len(pros),
            "updated": len(updated),
            "from_cluster": from_cluster,
            "floored_self_ad": floored_self_ad,
            "cleared": len(cleared),
            "skipped_no_contact": len(skipped_no_contact),
            "skipped_no_match": len(skipped_no_match),
            "with_third_party": sum(
                1 for r in updated if int(r["third_party_mention_count"]) > 0
            ),
            "with_self_ad": sum(
                1 for r in updated if int(r["self_ad_mention_count"]) > 0
            ),
            "with_both": sum(
                1
                for r in updated
                if int(r["third_party_mention_count"]) > 0
                and int(r["self_ad_mention_count"]) > 0
            ),
        },
        "updated": updated,
        "cleared": cleared,
        "skipped_no_contact": skipped_no_contact,
        "skipped_no_match": skipped_no_match,
    }


def apply_updates(client: SupabaseRest, report: dict[str, Any]) -> tuple[int, int]:
    n = 0
    for row in report.get("updated") or []:
        client._request(
            "PATCH",
            "/professionals",
            params={"id": f"eq.{row['id']}"},
            body={
                "third_party_mention_count": int(row["third_party_mention_count"]),
                "self_ad_mention_count": int(row["self_ad_mention_count"]),
            },
            prefer="return=minimal",
        )
        n += 1
        if n % 50 == 0:
            print(f"  patched {n}/{len(report['updated'])}")
    cleared_n = 0
    for row in report.get("cleared") or []:
        client._request(
            "PATCH",
            "/professionals",
            params={"id": f"eq.{row['id']}"},
            body={
                "third_party_mention_count": None,
                "self_ad_mention_count": None,
            },
            prefer="return=minimal",
        )
        cleared_n += 1
    return n, cleared_n


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_env()
    client = SupabaseRest(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    report = audit(client)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("totals:", json.dumps(report["totals"], ensure_ascii=False))
    print(f"wrote {OUT_JSON}")
    for row in report["updated"][:12]:
        print(
            f"  × чужие {row['third_party_mention_count']} / сами {row['self_ad_mention_count']}"
            f"  {row['name']}  ← {row.get('matched_clusters')}"
        )
    if report.get("cleared"):
        print("cleared examples:")
        for row in report["cleared"][:8]:
            print(f"  clear {row['name']} ({row['reason']})")

    if args.apply:
        n, cleared_n = apply_updates(client, report)
        print(f"applied {n} updates, cleared {cleared_n}")
    else:
        print("dry-run only; pass --apply to write to Supabase")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
