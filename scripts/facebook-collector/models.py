"""Facebook collector data models (Actor-agnostic)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

MediaType = Literal["image", "video", "link"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


@dataclass
class MediaItem:
    type: MediaType
    url: str
    thumbnail_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "url": self.url,
            "thumbnail_url": self.thumbnail_url,
        }


@dataclass
class NormalizedFacebookPost:
    """Stable normalized Facebook group post (pre-analyzer)."""

    source: str
    source_platform: str
    source_group_url: str | None
    source_group_name: str | None
    source_post_id: str
    source_url: str | None
    source_fingerprint: str
    author_name: str | None
    published_at: str | None
    collected_at: str
    text: str
    media: list[MediaItem] = field(default_factory=list)
    # Debug only — never publish; strip before any public table write beyond review queue.
    raw_payload: dict[str, Any] = field(default_factory=dict)
    adapter_name: str = "unknown"
    empty: bool = False

    def to_dict(self, *, include_raw: bool = True) -> dict[str, Any]:
        d: dict[str, Any] = {
            "source": self.source,
            "source_platform": self.source_platform,
            "source_group_url": self.source_group_url,
            "source_group_name": self.source_group_name,
            "source_post_id": self.source_post_id,
            "source_url": self.source_url,
            "source_fingerprint": self.source_fingerprint,
            "author_name": self.author_name,
            "published_at": self.published_at,
            "collected_at": self.collected_at,
            "text": self.text,
            "media": [m.to_dict() for m in self.media],
            "adapter_name": self.adapter_name,
            "empty": self.empty,
        }
        if include_raw:
            d["raw_payload"] = self.raw_payload
        return d


def media_from_dicts(items: list[dict[str, Any]] | None) -> list[MediaItem]:
    out: list[MediaItem] = []
    for item in items or []:
        url = (item.get("url") or "").strip()
        if not url:
            continue
        kind = str(item.get("type") or item.get("kind") or "image").lower()
        if kind in {"photo", "image", "img"}:
            mtype: MediaType = "image"
        elif kind in {"video", "reel"}:
            mtype = "video"
        elif kind in {"link", "shared_link", "url"}:
            mtype = "link"
        else:
            mtype = "image"
        out.append(
            MediaItem(
                type=mtype,
                url=url,
                thumbnail_url=(item.get("thumbnail_url") or item.get("thumbnail") or None),
            )
        )
    return out
