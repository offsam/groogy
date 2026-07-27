"""Image validation helpers for Media Pipeline v1."""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

ALLOWED_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

MIN_EDGE = 200
MAX_ASPECT = 3.5
MAX_BYTES = 5 * 1024 * 1024


@dataclass
class ValidImage:
    data: bytes
    mime_type: str
    width: int
    height: int
    sha256: str
    ext: str


def sniff_mime(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    head = data[:256].lstrip().lower()
    if (
        head.startswith(b"<")
        or b"<svg" in head
        or b"<!doctype" in head
        or b"<html" in head
    ):
        return None
    return None


def validate_image_bytes(data: bytes) -> tuple[ValidImage | None, str | None]:
    """Return (image, None) or (None, reject_reason)."""
    if not data:
        return None, "empty"
    if len(data) > MAX_BYTES:
        return None, "too_large"
    if len(data) < 100:
        return None, "too_small"

    mime = sniff_mime(data)
    if not mime or mime not in ALLOWED_MIME:
        return None, "bad_mime"

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        width, height = img.size
    except Exception:
        return None, "broken"

    if width < MIN_EDGE or height < MIN_EDGE:
        return None, "below_min_edge"

    aspect = max(width, height) / max(1, min(width, height))
    if aspect > MAX_ASPECT:
        return None, "extreme_aspect"

    sha = hashlib.sha256(data).hexdigest()
    return (
        ValidImage(
            data=data,
            mime_type=mime,
            width=width,
            height=height,
            sha256=sha,
            ext=ALLOWED_MIME[mime],
        ),
        None,
    )


def reencode_webp(data: bytes, *, max_edge: int = 1600, quality: int = 85) -> ValidImage:
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1.0:
        img = img.resize(
            (max(1, int(w * scale)), max(1, int(h * scale))),
            Image.Resampling.LANCZOS,
        )
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=6)
    out = buf.getvalue()
    return ValidImage(
        data=out,
        mime_type="image/webp",
        width=img.size[0],
        height=img.size[1],
        sha256=hashlib.sha256(out).hexdigest(),
        ext="webp",
    )


def make_category_placeholder(
    *,
    label: str,
    landscape: bool = False,
    color: tuple[int, int, int] = (30, 58, 95),
) -> ValidImage:
    """Generate a simple branded tile (no AI)."""
    w, h = (640, 480) if landscape else (640, 640)
    img = Image.new("RGB", (w, h), color)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, w, 8), fill=(37, 99, 235))
    draw.rectangle((0, h - 8, w, h), fill=(234, 88, 12))
    text = (label or "КРУГИ")[:28]
    font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((w - tw) / 2, (h - th) / 2), text, fill=(255, 255, 255), font=font)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=80, method=4)
    out = buf.getvalue()
    return ValidImage(
        data=out,
        mime_type="image/webp",
        width=w,
        height=h,
        sha256=hashlib.sha256(out).hexdigest(),
        ext="webp",
    )


CATEGORY_DEFAULT_PATHS: dict[str, str] = {
    "food": "/images/categories/restaurants.svg",
    "restaurants": "/images/categories/restaurants.svg",
    "groceries": "/images/categories/groceries.svg",
    "beauty": "/images/categories/beauty.svg",
    "auto_services": "/images/categories/auto.svg",
    "car_rental": "/images/categories/auto.svg",
    "health": "/images/categories/medical.svg",
    "medical": "/images/categories/medical.svg",
    "legal": "/images/categories/legal.svg",
    "education": "/images/categories/education.svg",
    "childcare": "/images/categories/education.svg",
    "cleaning": "/images/categories/services.svg",
    "home_services": "/images/categories/services.svg",
    "moving": "/images/categories/services.svg",
    "professional_services": "/images/categories/services.svg",
    "accounting": "/images/categories/services.svg",
    "insurance": "/images/categories/services.svg",
    "events": "/images/categories/services.svg",
    "fitness": "/images/categories/services.svg",
    "real_estate_services": "/images/categories/services.svg",
    "other": "/images/categories/services.svg",
}


def category_default_path(category: str | None) -> str:
    key = (category or "other").strip().lower()
    return CATEGORY_DEFAULT_PATHS.get(key, "/images/categories/services.svg")
