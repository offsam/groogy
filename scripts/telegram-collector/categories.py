"""Controlled categories and false-match guards for Telegram ads."""

from __future__ import annotations

import re

CATEGORIES = [
    "beauty",
    "health",
    "fitness",
    "education",
    "childcare",
    "legal",
    "accounting",
    "insurance",
    "real_estate_services",
    "auto_services",
    "car_rental",
    "home_services",
    "cleaning",
    "moving",
    "food",
    "photography_video",
    "events",
    "travel",
    "pet_services",
    "professional_services",
    "other",
]

CATEGORY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("beauty", re.compile(
        r"\b(маникюр|педикюр|брови|ресниц|lash|brow|nail|парикмахер|колорист|"
        r"окрашиван|sugaring|шугаринг|косметолог|салон\s+красот|hair\s+extension|"
        r"наращиван\w+\s+волос|makeup|макияж)\w*",
        re.I,
    )),
    ("health", re.compile(
        r"\b(психолог|гипнотерапевт|стоматолог|dentist|массаж\s+лиц|chiropract|"
        r"терапевт|врач|доктор|clinic|клиник)\w*",
        re.I,
    )),
    ("fitness", re.compile(r"\b(тренер|фитнес|йога|yoga|pilates|пилатес|trainer)\w*", re.I)),
    ("education", re.compile(
        r"\b(репетитор|tutor|преподаватель|уроки\s+(?:англ|математи|музык)|"
        r"занятия\s+для\s+дете|школа\s+(?:языков|танц))\w*",
        re.I,
    )),
    ("childcare", re.compile(r"\b(няня|babysitter|childcare|сиделк|nanny)\w*", re.I)),
    ("legal", re.compile(r"\b(адвокат|юрист|lawyer|attorney|иммиграционн\w+\s+адвокат)\w*", re.I)),
    ("accounting", re.compile(r"\b(бухгалтер|accountant|налогов\w+\s+декларац)\w*", re.I)),
    ("insurance", re.compile(r"\b(страхов|insurance\s+agent|страховой\s+агент)\w*", re.I)),
    ("real_estate_services", re.compile(r"\b(риелтор|realtor|real\s*estate\s+agent)\w*", re.I)),
    ("auto_services", re.compile(
        r"\b(ремонт\s+авто|автосервис|mechanic|детейлинг|detailing|smog|шиномонтаж|"
        r"авто\s*мастер)\w*",
        re.I,
    )),
    ("car_rental", re.compile(r"\b(аренда\s+авто|car\s*rental|rent\s+a\s+car)\w*", re.I)),
    ("cleaning", re.compile(r"\b(клининг|уборк|cleaning\s+service|house\s*keep)\w*", re.I)),
    ("moving", re.compile(r"\b(переезд|movers?|грузоперевоз)\w*", re.I)),
    ("home_services", re.compile(
        r"\b(handyman|сантехник|электрик|плотник|маляр|ремонт\s+квартир)\w*",
        re.I,
    )),
    ("food", re.compile(
        r"\b(торты|выпечка|кейтеринг|catering|домашн\w+\s+(?:еда|выпеч)|кафе|ресторан|"
        r"доставка\s+еды)\w*",
        re.I,
    )),
    ("photography_video", re.compile(
        r"\b(фотограф|видеограф|photographer|видеосъем|фотосъем|съёмк|съемк)\w*",
        re.I,
    )),
    ("events", re.compile(r"\b(аниматор|праздник\s+под\s+ключ|event\s+planner|организатор\s+праздник)\w*", re.I)),
    ("travel", re.compile(r"\b(турагент|travel\s+agent|визов\w+\s+поддерж)\w*", re.I)),
    ("pet_services", re.compile(r"\b(груминг|dog\s*walk|pet\s*sit|выгул\s+собак|зооняня)\w*", re.I)),
    ("professional_services", re.compile(
        r"\b(переводчик|designer|дизайнер|маркетолог|smm|web\s*develop)\w*",
        re.I,
    )),
]

# Patterns that must NOT map to certain categories.
FALSE_CATEGORY_BLOCKS: list[tuple[re.Pattern[str], set[str]]] = [
    (re.compile(r"\b(обмен\s+валют|поменяю\s+\$|нужны\s+рубли|currency\s+exchange)\b", re.I), {"education"}),
    (re.compile(r"\b(ищу\s+квартир|сда[её]тся\s+(?:квартира|комната)|room\s+for\s+rent)\b", re.I), {"auto_services", "car_rental"}),
    (re.compile(r"\b(ресниц|lash|маникюр|nail|брови|brow)\b", re.I), {"health"}),
    (re.compile(r"\b(фотограф|photographer)\b", re.I), {"beauty"}),
]


def detect_category(text: str) -> tuple[str, list[str]]:
    """Return (category, warnings)."""
    warnings: list[str] = []
    blocked: set[str] = set()
    for pattern, cats in FALSE_CATEGORY_BLOCKS:
        if pattern.search(text or ""):
            blocked |= cats

    hits: list[str] = []
    for category, pattern in CATEGORY_PATTERNS:
        if category in blocked:
            continue
        if pattern.search(text or ""):
            hits.append(category)

    if not hits:
        # If blocked patterns fired and nothing else matched, force other.
        if blocked:
            warnings.append("category_ambiguous_after_false_match_guard")
            return "other", warnings
        return "other", warnings

    if len(hits) > 1:
        warnings.append(f"multiple_category_candidates:{','.join(hits)}")
        return "other", warnings

    return hits[0], warnings
