"""Website image discovery: og:image → logo → favicon (max 2 HTTP requests)."""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser

USER_AGENT = (
    "Mozilla/5.0 (compatible; KrugiMediaBot/1.0; +https://krugi.local/bot)"
)
TIMEOUT = 8
MAX_BYTES = 5 * 1024 * 1024

_domain_cache: dict[str, "WebsiteDiscovery"] = {}


@dataclass
class WebsiteDiscovery:
    domain: str
    og_image: str | None = None
    logo: str | None = None
    favicon: str | None = None
    error: str | None = None
    html_fetched: bool = False


class _MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.og_image: str | None = None
        self.icons: list[str] = []
        self.logo_candidates: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            prop = (ad.get("property") or ad.get("name") or "").lower()
            if prop in {"og:image", "og:image:url", "twitter:image"} and ad.get("content"):
                if not self.og_image:
                    self.og_image = ad["content"].strip()
        if tag == "link":
            rel = (ad.get("rel") or "").lower()
            href = ad.get("href") or ""
            if href and any(x in rel for x in ("icon", "apple-touch-icon", "shortcut")):
                self.icons.append(href)
        if tag == "img":
            src = ad.get("src") or ""
            alt = (ad.get("alt") or "").lower()
            cls = (ad.get("class") or "").lower()
            if src and ("logo" in alt or "logo" in cls or "logo" in src.lower()):
                self.logo_candidates.append(src)


def _http_get(url: str, *, max_bytes: int = 512_000) -> tuple[bytes, str]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        data = resp.read(max_bytes + 1)
        if len(data) > max_bytes:
            data = data[:max_bytes]
        return data, ctype


def absolute_url(base: str, maybe: str | None) -> str | None:
    if not maybe:
        return None
    maybe = maybe.strip()
    if not maybe or maybe.startswith("data:"):
        return None
    return urllib.parse.urljoin(base, maybe)


def domain_of(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower()
    except Exception:
        return ""


def discover_website_images(website: str) -> WebsiteDiscovery:
    if not website:
        return WebsiteDiscovery(domain="", error="empty")
    raw = website.strip()
    if not raw.startswith("http"):
        raw = "https://" + raw
    domain = domain_of(raw)
    if not domain:
        return WebsiteDiscovery(domain="", error="bad_url")
    if domain in _domain_cache:
        return _domain_cache[domain]

    disc = WebsiteDiscovery(domain=domain)
    try:
        root = f"{urllib.parse.urlparse(raw).scheme}://{domain}/"
        html_bytes, ctype = _http_get(root, max_bytes=400_000)
        disc.html_fetched = True
        text = html_bytes.decode("utf-8", errors="ignore")
        parser = _MetaParser()
        try:
            parser.feed(text)
        except Exception:
            pass
        disc.og_image = absolute_url(root, parser.og_image)
        if parser.logo_candidates:
            disc.logo = absolute_url(root, parser.logo_candidates[0])
        if parser.icons:
            disc.favicon = absolute_url(root, parser.icons[0])
        if not disc.favicon:
            disc.favicon = absolute_url(root, "/favicon.ico")
    except Exception as exc:
        disc.error = type(exc).__name__
    _domain_cache[domain] = disc
    return disc


def download_image(url: str, *, max_bytes: int = MAX_BYTES) -> tuple[bytes | None, str | None]:
    try:
        data, ctype = _http_get(url, max_bytes=max_bytes)
        if ctype.startswith("text/") or "html" in ctype:
            return None, "html_response"
        return data, None
    except urllib.error.HTTPError as exc:
        return None, f"http_{exc.code}"
    except Exception as exc:
        return None, type(exc).__name__
