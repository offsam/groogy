"""Site photos: portrait over logo, certificates into gallery.

Keep in sync with lib/admin/website-assets.ts — one rule for Node + Python enrich.
"""

from __future__ import annotations

import re
import urllib.parse
from typing import Any

IMG_EXT_RE = re.compile(r"\.(?:jpe?g|png|webp|gif|avif)(?:$|\?)", re.I)
CERT_RE = re.compile(r"cert|diploma|certificate|notar|apostille|license|licen[cs]e", re.I)
LOGO_RE = re.compile(
    r"logo|favicon|icon|sprite|watermark|badge|button|placeholder|1x1|pixel\.gif|emoji",
    re.I,
)
DECORATIVE_RE = re.compile(r"chatgpt%20image|chatgpt-image|wix-logo|parastorage", re.I)
SKIP_HOST_RE = re.compile(
    r"googleusercontent\.com/gadgets|facebook\.com/tr|doubleclick|"
    r"gravatar\.com/avatar/000",
    re.I,
)
WIX_MEDIA_RE = re.compile(
    r"https?://static\.wixstatic\.com/media/[^\s\"'<>)]+",
    re.I,
)
CONTENT_PATH_RE = re.compile(
    r"^/(contact|contacts|contact-us|about|about-us|menu|services|service|"
    r"our-services|pricing|prices|price-list|treatments|book-online|"
    r"visit|new-here|times|service-times|schedule|ministries|ministry|"
    r"connect|location|locations)/?$",
    re.I,
)


def canonical_media_url(raw: str) -> str:
    url = (raw or "").strip().replace("&amp;", "&")
    if not url:
        return ""
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.netloc == "static.wixstatic.com":
            media = parsed.path.split("/v1/")[0] or parsed.path
            return f"{parsed.scheme}://{parsed.netloc}{media}"
        return urllib.parse.urlunparse(parsed._replace(fragment=""))
    except Exception:
        return url.split("?")[0]


def _file_hint(url: str) -> str:
    try:
        path = urllib.parse.urlparse(url).path
        return urllib.parse.unquote(path).lower()
    except Exception:
        try:
            return urllib.parse.unquote(url).lower()
        except Exception:
            return url.lower()


def _fill_size(url: str) -> tuple[int | None, int | None]:
    w = re.search(r"[?/_]w[_=](\d{2,4})", url, re.I)
    h = re.search(r"[?/_]h[_=](\d{2,4})", url, re.I)
    fill = re.search(r"/fill/w_(\d{2,4})(?:,h_(\d{2,4}))?", url, re.I)
    wix = re.search(r"w_(\d{2,4})%2Ch_(\d{2,4})", url, re.I)
    width = int((fill.group(1) if fill else None) or (wix.group(1) if wix else None) or (w.group(1) if w else 0) or 0) or None
    height = int((fill.group(2) if fill and fill.group(2) else None) or (wix.group(2) if wix else None) or (h.group(1) if h else 0) or 0) or None
    return width, height


def looks_like_logo_url(url: str | None) -> bool:
    if not url:
        return True
    hint = _file_hint(url)
    if LOGO_RE.search(hint) or hint.endswith(".svg") or hint.endswith(".ico"):
        return True
    return False


def extract_image_urls_from_html(html: str, page_url: str | None = None) -> list[str]:
    found: list[str] = []

    def push(raw: str | None) -> None:
        t = (raw or "").strip()
        if not t or t.startswith("data:"):
            return
        if not re.match(r"^https?://", t, re.I) and not t.startswith("/"):
            return
        abs_u = t
        if page_url and not re.match(r"^https?://", t, re.I):
            abs_u = urllib.parse.urljoin(page_url, t)
        if not re.match(r"^https?://", abs_u, re.I):
            return
        found.append(abs_u)

    for m in re.finditer(
        r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        re.I,
    ):
        push(m.group(1))
    for m in re.finditer(
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\']',
        html,
        re.I,
    ):
        push(m.group(1))
    for m in re.finditer(r'<img\b[^>]*\bsrc=["\']([^"\']+)["\']', html, re.I):
        push(m.group(1))
    for m in re.finditer(r'<img\b[^>]*\bsrcset=["\']([^"\']+)["\']', html, re.I):
        for part in (m.group(1) or "").split(","):
            push(part.strip().split()[0] if part.strip() else None)
    for m in WIX_MEDIA_RE.finditer(html):
        push(m.group(0).replace("&quot;", "").replace("\\u002F", "/"))

    seen: set[str] = set()
    out: list[str] = []
    for url in found:
        key = canonical_media_url(url)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(url)
    return out


def classify_site_image(raw_url: str) -> dict[str, Any]:
    url = canonical_media_url(raw_url)
    hint = _file_hint(raw_url)
    width, height = _fill_size(raw_url)
    max_edge = max(width or 0, height or 0)
    is_original = "/v1/" not in raw_url.lower()
    skip = {"url": url, "kind": "skip", "score": 0, "width": width, "height": height}

    if not url or SKIP_HOST_RE.search(url) or DECORATIVE_RE.search(hint):
        return skip
    if hint.endswith(".svg") or hint.endswith(".ico"):
        return skip
    if not IMG_EXT_RE.search(hint) and "wixstatic.com/media/" not in url.lower():
        return skip
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        if host != "static.wixstatic.com" and re.search(
            r"quality_auto|enc_avif|/v1/fill", hint, re.I
        ):
            return skip
    except Exception:
        return skip
    if max_edge and max_edge < 90:
        return skip
    if LOGO_RE.search(hint):
        return {
            "url": url,
            "kind": "logo",
            "score": max_edge,
            "width": width,
            "height": height,
        }
    if CERT_RE.search(hint):
        score = 80 + min(max_edge, 1600) / 20 + (10 if is_original else 0)
        return {
            "url": url,
            "kind": "certificate",
            "score": score,
            "width": width,
            "height": height,
        }

    score = 10 + min(max_edge or 400, 1600) / 16
    if re.search(r"\.jpe?g(?:$|\?)", hint, re.I):
        score += 18
    if is_original:
        score += 22
    if height and width and height / width >= 1.15:
        score += 36
    if width and height and width / height >= 1.6 and max_edge >= 800:
        score -= 12
    return {
        "url": url,
        "kind": "portrait",
        "score": score,
        "width": width,
        "height": height,
    }


def pick_site_media(urls: list[str]) -> dict[str, Any]:
    classified = [classify_site_image(u) for u in urls]
    portraits = sorted(
        [c for c in classified if c["kind"] == "portrait"],
        key=lambda c: c["score"],
        reverse=True,
    )
    certificates = sorted(
        [c for c in classified if c["kind"] == "certificate"],
        key=lambda c: c["score"],
        reverse=True,
    )
    logos = [c["url"] for c in classified if c["kind"] == "logo"]
    cert_urls: list[str] = []
    seen: set[str] = set()
    for c in certificates:
        if c["url"] in seen:
            continue
        seen.add(c["url"])
        cert_urls.append(c["url"])
        if len(cert_urls) >= 6:
            break
    return {
        "portrait": portraits[0]["url"] if portraits else None,
        "certificates": cert_urls,
        "logos": logos,
    }


def photo_from_website_profile(prof: dict[str, Any] | None) -> tuple[str | None, list[str]]:
    """Portrait + certificates from extract_website_profile output."""
    if not prof:
        return None, []
    portrait = str(prof.get("image_url") or "").strip() or None
    if portrait and looks_like_logo_url(portrait):
        portrait = None
    if not portrait:
        fallback = str(prof.get("logo") or "").strip() or None
        if fallback and not looks_like_logo_url(fallback):
            portrait = fallback
    certs: list[str] = []
    for raw in list(prof.get("gallery_urls") or []):
        u = str(raw or "").strip()
        if u.startswith("http") and u not in certs:
            certs.append(u)
    return portrait, certs[:6]


def should_replace_cover(current: str | None) -> bool:
    """Empty or logo-as-cover — a real portrait may fill this slot."""
    url = (current or "").strip()
    return (not url) or looks_like_logo_url(url)


def merge_gallery(existing: Any, extra: list[str] | None) -> list[str]:
    out: list[str] = []
    for raw in list(existing or []) + list(extra or []):
        u = str(raw or "").strip()
        if u.startswith("http") and u not in out:
            out.append(u)
        if len(out) >= 6:
            break
    return out


def linked_content_paths(html: str, page_url: str) -> list[str]:
    try:
        origin = urllib.parse.urlparse(page_url)
        origin_s = f"{origin.scheme}://{origin.netloc}"
    except Exception:
        return []
    paths: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r'href=["\']([^"\']+)["\']', html, re.I):
        href = (m.group(1) or "").strip()
        if not href or href.startswith("#") or href.lower().startswith("mailto:"):
            continue
        try:
            abs_u = urllib.parse.urljoin(page_url, href)
            parsed = urllib.parse.urlparse(abs_u)
            if f"{parsed.scheme}://{parsed.netloc}" != origin_s:
                continue
            path = (parsed.path or "/").rstrip("/") or "/"
            if path == "/":
                continue
            if CONTENT_PATH_RE.match(path) and path not in seen:
                seen.add(path)
                paths.append(path)
        except Exception:
            continue
        if len(paths) >= 8:
            break
    return paths
