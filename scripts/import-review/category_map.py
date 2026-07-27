"""Map AI/import category labels onto public.categories rows.

Uses only existing platform categories. Never invents categories.
"""

from __future__ import annotations

from typing import Any

# AI label → existing categories.slug only.
AI_CATEGORY_TO_SLUG: dict[str, str] = {
    # Красота
    "beauty": "beauty",
    "salon": "beauty",
    "nails": "beauty",
    "spa": "beauty",
    "hair": "beauty",
    "barber": "beauty",
    # Образование
    "education": "education",
    "school": "education",
    "tutoring": "education",
    "childcare": "education",
    "daycare": "education",
    "nanny": "education",
    # Еда / Рестораны
    "restaurants": "restaurants",
    "restaurant": "restaurants",
    "food": "restaurants",
    "cafe": "restaurants",
    "bakery": "restaurants",
    "catering": "restaurants",
    "coffee": "restaurants",
    # Продукты
    "groceries": "groceries",
    "products": "groceries",
    "market": "groceries",
    # Авто
    "auto": "auto",
    "auto_services": "auto",
    "auto_repair": "auto",
    "car": "auto",
    "car_rental": "auto",
    "automotive": "auto",
    "tire": "auto",
    "tires": "auto",
    "body_shop": "auto",
    "mechanic": "auto",
    # Медицина
    "medical": "medical",
    "health": "medical",
    "medicine": "medical",
    "healthcare": "medical",
    "dentist": "medical",
    "dental": "medical",
    "therapy": "medical",
    "psychology": "medical",
    "psychologist": "medical",
    "massage_therapy": "medical",
    # Юристы
    "legal": "legal",
    "lawyer": "legal",
    "lawyers": "legal",
    "attorney": "legal",
    "immigration": "legal",
    "notary": "legal",
    "translation": "legal",
    "translator": "legal",
    # Недвижимость
    "real_estate": "real_estate",
    "real_estate_services": "real_estate",
    "realtor": "real_estate",
    "mortgage": "real_estate",
    "property_management": "real_estate",
    # Спорт и фитнес
    "fitness": "fitness",
    "pilates": "fitness",
    "gym": "fitness",
    "yoga": "fitness",
    "personal_training": "fitness",
    "sport": "fitness",
    "sports": "fitness",
    # Животные
    "pets": "pets",
    "pet_services": "pets",
    "pet_grooming": "pets",
    "veterinary": "pets",
    "vet": "pets",
    "dog_training": "pets",
    # Финансы и бухгалтерия
    "finance": "finance",
    "accounting": "finance",
    "tax": "finance",
    "bookkeeping": "finance",
    "payroll": "finance",
    # Страхование
    "insurance": "insurance",
    # Путешествия
    "travel": "travel",
    "tourism": "travel",
    "visa": "travel",
    "travel_agency": "travel",
    # Мероприятия
    "events": "events",
    "event": "events",
    "event_services": "events",
    "party": "events",
    "wedding": "events",
    "birthday": "events",
    # Услуги — только явные бытовые / общие сервисы
    "services": "services",
    "service": "services",
    "cleaning": "services",
    "moving": "services",
    "home_services": "services",
    "handyman": "services",
    "locksmith": "services",
    "photography_video": "services",
    "photography": "services",
    "video": "services",
    "professional_services": "services",
}

# Labels that must stay manual (no safe platform match).
UNMAPPED_SPECIALTY: frozenset[str] = frozenset(
    {
        "other",
        "unknown",
        "null",
        "none",
        "misc",
    }
)


def normalize_category_key(raw: str | None) -> str:
    if not raw:
        return ""
    return (
        str(raw)
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
    )


def build_category_indexes(
    categories: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_slug: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    for cat in categories:
        if cat.get("is_active") is False:
            continue
        slug = normalize_category_key(cat.get("slug"))
        name = normalize_category_key(cat.get("name"))
        if slug:
            by_slug[slug] = cat
        if name:
            by_name[name] = cat
        if cat.get("name"):
            by_name[str(cat["name"]).strip().lower()] = cat
    return by_slug, by_name


def resolve_category_id(
    ai_category: str | None,
    categories: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return {category_id, slug, name, matched_via, needs_manual, reason}."""
    by_slug, by_name = build_category_indexes(categories)
    key = normalize_category_key(ai_category)

    if not key or key in UNMAPPED_SPECIALTY:
        return {
            "category_id": None,
            "slug": None,
            "name": None,
            "matched_via": None,
            "ai_category": ai_category,
            "needs_manual": True,
            "reason": "нет однозначного соответствия (other/пусто)",
        }

    if key in by_slug:
        cat = by_slug[key]
        return {
            "category_id": cat["id"],
            "slug": cat.get("slug"),
            "name": cat.get("name"),
            "matched_via": "slug",
            "ai_category": ai_category,
            "needs_manual": False,
            "reason": None,
        }

    alias_slug = AI_CATEGORY_TO_SLUG.get(key)
    if alias_slug and alias_slug in by_slug:
        cat = by_slug[alias_slug]
        return {
            "category_id": cat["id"],
            "slug": cat.get("slug"),
            "name": cat.get("name"),
            "matched_via": f"alias:{key}->{alias_slug}",
            "ai_category": ai_category,
            "needs_manual": False,
            "reason": None,
        }

    if key in by_name:
        cat = by_name[key]
        return {
            "category_id": cat["id"],
            "slug": cat.get("slug"),
            "name": cat.get("name"),
            "matched_via": "name",
            "ai_category": ai_category,
            "needs_manual": False,
            "reason": None,
        }
    if ai_category and str(ai_category).strip().lower() in by_name:
        cat = by_name[str(ai_category).strip().lower()]
        return {
            "category_id": cat["id"],
            "slug": cat.get("slug"),
            "name": cat.get("name"),
            "matched_via": "name",
            "ai_category": ai_category,
            "needs_manual": False,
            "reason": None,
        }

    return {
        "category_id": None,
        "slug": None,
        "name": None,
        "matched_via": None,
        "ai_category": ai_category,
        "needs_manual": True,
        "reason": f"нет соответствия для AI-категории «{ai_category}»",
    }


# AI / business category → listing_categories.slug (services domain).
AI_TO_SERVICE_LISTING_SLUG: dict[str, str] = {
    "beauty": "beauty",
    "salon": "beauty",
    "nails": "beauty",
    "spa": "beauty",
    "hair": "beauty",
    "barber": "beauty",
    "cleaning": "cleaning",
    "home_services": "home-repair",
    "home_repair": "home-repair",
    "handyman": "home-repair",
    "plumbing": "home-repair",
    "electrician": "home-repair",
    "moving": "moving",
    "auto": "auto-service",
    "auto_services": "auto-service",
    "auto_repair": "auto-service",
    "car_rental": "auto-service",
    "education": "tutoring",
    "tutoring": "tutoring",
    "childcare": "tutoring",
    "daycare": "tutoring",
    "nanny": "tutoring",
    "legal": "legal",
    "lawyer": "legal",
    "immigration": "legal",
    "notary": "legal",
    "medical": "health",
    "health": "health",
    "fitness": "health",
    "massage": "health",
    "it": "it-help",
    "it_help": "it-help",
    "insurance": "other-services",
    "food": "other-services",
    "other": "other-services",
    "professional_services": "other-services",
}


def resolve_service_listing_category_id(
    ai_category: str | None,
    listing_categories: list[dict[str, Any]],
) -> dict[str, Any]:
    """Map AI category onto active service listing_categories row."""
    by_slug = {
        str(c.get("slug") or "").lower(): c
        for c in listing_categories
        if c.get("is_active") is not False
        and str(c.get("listing_type") or "") == "service"
    }
    key = (ai_category or "").strip().lower().replace(" ", "_").replace("-", "_")
    slug = AI_TO_SERVICE_LISTING_SLUG.get(key) or AI_TO_SERVICE_LISTING_SLUG.get(
        key.replace("_", "-"), None
    )
    # also try dashed form of mapped keys
    if not slug and key:
        dashed = key.replace("_", "-")
        if dashed in by_slug:
            slug = dashed
    if slug and slug in by_slug:
        cat = by_slug[slug]
        return {
            "category_id": cat.get("id"),
            "slug": cat.get("slug"),
            "name": cat.get("name_ru") or cat.get("name_en"),
            "matched_via": "ai_map",
            "ai_category": ai_category,
            "needs_manual": False,
            "reason": None,
        }
    fallback = by_slug.get("other-services") or next(iter(by_slug.values()), None)
    if fallback:
        return {
            "category_id": fallback.get("id"),
            "slug": fallback.get("slug"),
            "name": fallback.get("name_ru") or fallback.get("name_en"),
            "matched_via": "fallback",
            "ai_category": ai_category,
            "needs_manual": True,
            "reason": f"fallback other-services для «{ai_category}»",
        }
    return {
        "category_id": None,
        "slug": None,
        "name": None,
        "matched_via": None,
        "ai_category": ai_category,
        "needs_manual": True,
        "reason": "нет service listing categories",
    }
