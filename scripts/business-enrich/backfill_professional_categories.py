#!/usr/bin/env python3
"""Backfill professionals.category_id to the professional sphere taxonomy.

Usage:
  python3 scripts/business-enrich/backfill_professional_categories.py
  python3 scripts/business-enrich/backfill_professional_categories.py --apply --force
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "import-review"))
from common import SupabaseRest, load_env  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "professional_categories"
OUT.mkdir(parents=True, exist_ok=True)

DEFAULT_SLUG = "pro_other"

# Keep in sync with lib/professional/categories.ts
RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "legal",
        re.compile(
            r"юрист|адвокат|нотариус|\blawyer\b|\battorney\b|legalshield|\blegal\b|иммиграцион|" +
            r"паралегал|paralegal|убежищ|political.?asylum|\bead\b|green.?card|грин.?карт|" +
            r"ворк.?ауториз|work.?authoriz|натурализац|бизнес.?лиценз|licensing.?protection|" +
            r"adjustment.?of.?status|паспорт(а|ов)?.?рф|kalinka.?service|виза.?талант",
            re.I,
        ),
    ),
    (
        "beauty",
        re.compile(
            r"маникюр|педикюр|бровист|брови|ресниц|парикмахер|барбер|barber|визаж|макияж|" +
            r"косметолог|шугаринг|сахарн|восков(ая|ой).?депиляц|\bnails?\b|\blashes?\b|\bhair\b|" +
            r"\bmakeup\b|окрашив|стрижк|кератин|ботокс.?вол|наращиван.?вол|перманент|beauty.?room|" +
            r"эстетист|esthetician|филлер|dermal.?filler|увеличение.?губ|под.?глаз|уход.?за.?ногт|" +
            r"ногт(ями|ей|и)\b|ламинир|hair.?salon|hairsalon|russian.?manicure|skincare|" +
            r"процедур.{0,25}волос",
            re.I,
        ),
    ),
    (
        "massage_wellness",
        re.compile(
            r"массаж|\bspa\b|пилинг|ароматерап|антицеллюлит|телесно.?ориентир|\bwellness\b|" +
            r"endermolog|лимфодренаж|facial.?massage",
            re.I,
        ),
    ),
    (
        "photo_video",
        re.compile(
            r"фотограф|\bphotograph|видеограф|\bvideograph|photo.?video|фото.?съ[её]мк|" +
            r"видео.?съ[её]мк|съ[её]мк(а|и).?(фото|видео)|хедшот|\bheadshots?\b",
            re.I,
        ),
    ),
    (
        "childcare",
        re.compile(
            r"няня|сиделка|детск(ий|ого).?сад|kids.?club|\bchildcare\b|\bbabysit|присмотр.?за.?реб|" +
            r"лагерь|spring.?camp|малыш|ранн(ее|ем).?детск",
            re.I,
        ),
    ),
    (
        "real_estate",
        re.compile(
            r"риелтор|риэлтор|недвижим|\brealtor\b|real.?estate|аренда.?комнат|аренда.?дом|" +
            r"сдам.?мастер.?бэдрум|сдам.?комнат|сдаётся.?комнат|сдается.?комнат|bedroom.?for.?rent|" +
            r"room.?for.?rent|переуступка.?аренды|\bairbnb\b",
            re.I,
        ),
    ),
    (
        "auto",
        re.compile(
            r"аренда.?авто|аренда.?машин|сда(м|ю|ётся|ется).?машин|сдам.?тесл|авто.?в.?аренду|" +
            r"(toyota|lexus|tesla|camry|prius|suburban|chevrolet|shevrolet).{0,50}(в.?аренду|" +
            r"аренда)|(в.?аренду|аренда).{0,30}(toyota|lexus|tesla|camry|prius|машин|suburban)|" +
            r"автоброкер|авто.?брокер|\bauto.?broker\b|\bcar.?rental\b|\bturo\b|автопарк|" +
            r"мобильн(ый|ого).?ремонт.?авто|автосервис|автомеханик|\bmechanic\b|полировк(а|" +
            r"и).?авто|выездн(ая|ой).?диагностик|диагностик\w*.{0,8}авто|детейлинг|\bdetailing\b|" +
            r"эвакуатор|\bcdl\b|drive.?service|lease.?special|dream.?car|uber.?black|" +
            r"авто(мобил)?.{0,20}аукцион|аукцион.{0,20}(авто|манхейм|manheim)|" +
            r"прода[её]тся.?(toyota|camry|prius|honda|bmw|машин)|\bkenworth\b|\beld\b.?solution|" +
            r"tesla.?model|помог\w*.{0,20}(приобрести|купить).{0,20}(tesla|авто|машин)|" +
            r"новую.?tesla|дилерск(ий|ом).?центр|сэкономить.?тысячи",
            re.I,
        ),
    ),
    (
        "insurance",
        re.compile(
            r"страховой.?брокер|автострахов|truck.?insur|commercial.?truck|\bcargo.?insurance\b|" +
            r"\binsurance.?broker\b|\binsurance.?agent\b|\bauto.?insurance\b|страхован(ие|ия|" +
            r"ию).?(авто|жизн|здоров|бизнес|truck|cargo)|страховы(е|х).?услуг|" +
            r"застраховать.?commercial|подобрать.?coverage|авто\s*\/\s*страхование",
            re.I,
        ),
    ),
    (
        "finance",
        re.compile(
            r"бухгалтер|\baccountant\b|\bbookkeep|\bcpa\b|\bctec\b|\birs\b|налогов(ый|ая|" +
            r"ые).?(сезон|декларац|консульт)|подач(а|и).?налог|tax.?prepar|открытие.?компан|" +
            r"dot\/mc|\bmc\b.{0,12}\bdot\b|\bdot\b.{0,12}\bmc\b|кредитн(ую|ой|ая).?истори|" +
            r"credit.?score|восстановлен(ие|ием).?кредит|обмен.?рубл",
            re.I,
        ),
    ),
    (
        "home_services",
        re.compile(
            r"клининг|уборк|\bcleaning\b|чисток.?диван|чистк[аиу].{0,20}(диван|матрас|ковр)|" +
            r"ковролин|замочник|\blocksmith\b|сантехник|электрик|хендимен|\bhandyman\b|" +
            r"ремонт.?квартир|ремонт.?дом|ремонт.?ванн|генеральн.?подряд|building.?licen|" +
            r"реставрац(ия|ии).?кож|сборка.?мебел|химчистк.?диван|покр(аска|аске|аски).?(дом|жил|" +
            r"квартир)|поокраске|\bpaving\b|\bconstruction\b|home.?repair|pressure.?washing|" +
            r"мойка.?под.?давлен|бетонн|ирригац|дренаж|благоустрой|брусчатк|подпорн|\barchitect\b|" +
            r"архитектор|ремонт\s*\/\s*стройка|наводит.?чистот|консультация.?по.?ac|\bmoving\b|" +
            r"переезд|грузчик|relocation",
            re.I,
        ),
    ),
    (
        "health",
        re.compile(
            r"психолог|гипнотерапевт|психотерап|психиатр|логопед|нейропсихолог|\btherapist\b|" +
            r"стоматолог|osteopath|\bosteo\b|chiropract|dentis|\bdoctor\b|анестезиолог|" +
            r"функциональн(ый|ого).?диагност|грудн(ое|ому).?вскармлив|выездн(ой|ого).?забор.?кров|" +
            r"лабораторн(ые|ых).?анализ|пиявоч|гирудотер|semaglutide|tirzepatide|\bozempic\b|" +
            r"пептиды",
            re.I,
        ),
    ),
    (
        "fitness",
        re.compile(
            r"фитнес.?тренер|персональн(ый|ые).?трен|онлайн.?тренер|\bpersonal.?train|йог[аиуе]|" +
            r"\byoga\b|pilates|пилатес|уроки.?плаван|тренер.?по.?плаван|индивидуальн(ые|" +
            r"ых).?уроки.?плаван|\bswimming\b|волейбол|\bstretching\b|\bstretch\b|растяжк|теннис|" +
            r"фигурн(ое|ым).?катан|\bdance.?studio\b|танцев(альный|альной).?студи|спортзал|" +
            r"шведск(ая|ие).?стен|тренер.?по.?питан",
            re.I,
        ),
    ),
    (
        "education",
        re.compile(
            r"репетитор|преподаватель|учительниц|\btutor\b|учитель(?!\s*йог)|английск(ий|ого|ому|" +
            r"им)|англійськ|русск(ий|им|ому).?язык|\bmath\b.?tutor|репетитор.?по.?мат|подготовк(а|" +
            r"е).?к.?sat|автоинструктор|сдать.?на.?вожден|\bdmv\b|устн(ый|ые).?перевод|" +
            r"переводчик(?!\s*документ)|уроки.?инглиш|уроки.?англ|инглиш|\benglish\b.?(lesson|" +
            r"teacher|language|instruction)|преподаю|занятия.?по.?англий|разговорн(ый|ые).?(испан|" +
            r"англий|франц)|испанск(ий|ого)|француз(ский|ька|узьк)|уроки.?гитар|уроки.?барабан|" +
            r"занятия.?по.?барабан|занятия.?по.?гитар|музыкальн|школа.?программирован|" +
            r"онлайн.?школа.?програм|python.?·|уроки.?музык",
            re.I,
        ),
    ),
    (
        "home_food",
        re.compile(
            r"выпечк|торт|пеку|\bbake\b|\bcakes?\b|кондитер|домашн(яя|ей).?еда|пирож|кулинар|" +
            r"\bpastry\b|икра|форель|блинчик|копчён|копчен|пельмен|пасочк|халял|инжир|шоколадн(ая|" +
            r"ой).?колбас|кулич|медовик|кейтеринг|\bcatering\b|sweet.?bakery|заварной.?крем",
            re.I,
        ),
    ),
    (
        "creative",
        re.compile(
            r"иллюстратор|графическ(ий|ого).?дизайн|дизайнер|handmade|вяжу|вязан|свеч|\bcandle\b|" +
            r"\bsmm\b|тату|\btattoo\b|таргетолог|таргет(ированн|ированная)?|image.?consult|" +
            r"маркетинг|\bmarketing\b|\bcasting\b",
            re.I,
        ),
    ),
    (
        "digital",
        re.compile(
            r"создан(ие|ия).?сайт|сайт(ов)?\+|web.?design|web.?&.?seo|\bseo\b.?optim|" +
            r"автоматиз\w*.{0,20}(продаж|бизнес)|telegram.{0,30}ai|\bai\s*agent\b|разработчик|" +
            r"программист|\bit\s*specialist\b|digital.?product",
            re.I,
        ),
    ),
    (
        "pets",
        re.compile(
            r"грумер|ветеринар|dog.?walk|pet.?sit|pet.?board|животн|собак|кошк|\bzoo\b",
            re.I,
        ),
    ),
    (
        "celebrations",
        re.compile(
            r"тамада|event.?plan|декоратор|организатор.?праздн|воздушн(ые|ых).?шар|party.?decor|" +
            r"аниматор|цветочн|flower.?boutique|\bbouquet\b|kids.?party|детск(ие|их).?праздник|" +
            r"букет(ы|ов)?\b|karaoke|караоке|face.?paint|ведущ(ий|ая)|праздник",
            re.I,
        ),
    ),
    (
        "travel",
        re.compile(
            r"турагент|travel.?agent|визов(ый|ая|ые)|туризм|\bvisa\b.?serv|экскурсионн|тур(ы|" +
            r"ов).?на.?русск|рыбалк|гавай|оаху|big.?bear|частн\w*.?трансфер|премиум.?такси|" +
            r"private.?driver|школьный.?трансфер|аэропорт.?\/.?oc",
            re.I,
        ),
    ),
]


def infer_slug(*texts: str | None) -> str:
    blob = "\n".join(t for t in texts if t)
    if not blob.strip():
        return DEFAULT_SLUG
    for slug, pat in RULES:
        if pat.search(blob):
            return slug
    return DEFAULT_SLUG


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing category_id",
    )
    args = parser.parse_args()
    apply = bool(args.apply)
    only_empty = not args.force

    load_env()
    import os

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase env", file=sys.stderr)
        return 1
    client = SupabaseRest(url, key)

    cats = client._request(
        "GET",
        "/categories",
        params={"select": "id,slug,name", "is_active": "eq.true", "limit": "200"},
    )
    by_slug = {c["slug"]: c for c in (cats or []) if isinstance(c, dict)}
    if DEFAULT_SLUG not in by_slug:
        print(f"Default category {DEFAULT_SLUG!r} missing — run migration", file=sys.stderr)
        return 1

    pros: list[dict[str, Any]] = []
    offset = 0
    while True:
        chunk = client._request(
            "GET",
            "/professionals",
            params={
                "select": (
                    "id,slug,display_name,headline,short_description,description,"
                    "category_id,status,visibility"
                ),
                "status": "eq.approved",
                "order": "created_at.asc",
                "limit": "500",
                "offset": str(offset),
            },
        )
        if not isinstance(chunk, list) or not chunk:
            break
        pros.extend(chunk)
        if len(chunk) < 500:
            break
        offset += 500

    service_blob: dict[str, str] = {}
    soff = 0
    while True:
        chunk = client._request(
            "GET",
            "/professional_services",
            params={
                "select": "professional_id,title,description",
                "is_active": "eq.true",
                "limit": "1000",
                "offset": str(soff),
            },
        )
        if not isinstance(chunk, list) or not chunk:
            break
        for row in chunk:
            pid = row["professional_id"]
            part = f"{row.get('title') or ''} {row.get('description') or ''}"
            service_blob[pid] = (service_blob.get(pid) or "") + " " + part
        if len(chunk) < 1000:
            break
        soff += 1000

    planned: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    skipped = 0

    for p in pros:
        if only_empty and p.get("category_id"):
            skipped += 1
            continue
        slug = infer_slug(
            p.get("display_name"),
            p.get("headline"),
            p.get("short_description"),
            p.get("description"),
            service_blob.get(p["id"]),
        )
        cat = by_slug.get(slug) or by_slug[DEFAULT_SLUG]
        counts[cat["slug"]] += 1
        planned.append(
            {
                "id": p["id"],
                "slug": p["slug"],
                "display_name": p.get("display_name"),
                "category_slug": cat["slug"],
                "category_id": cat["id"],
                "category_name": cat["name"],
            }
        )

    if apply:
        for item in planned:
            client.patch(
                "professionals",
                {"id": f"eq.{item['id']}"},
                {"category_id": item["category_id"]},
            )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "dry-run",
        "total_approved": len(pros),
        "skipped_already_set": skipped,
        "updated": len(planned),
        "by_category": dict(counts.most_common()),
        "sample": planned[:50],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = OUT / f"{'apply' if apply else 'dry_run'}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / ("apply_latest.json" if apply else "dry_run_latest.json")).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "mode": report["mode"],
                "updated": report["updated"],
                "skipped": skipped,
                "by_category": report["by_category"],
                "report": str(path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
