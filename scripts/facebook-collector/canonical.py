"""Actor-agnostic Facebook post model for КРУГИ.

Only fields needed for directory ingest. Do not expand to author profiles,
comments, or member lists unless a product requirement appears later.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class FacebookAttachment:
    kind: str  # image | video | link | file | unknown
    url: str | None = None


@dataclass
class CanonicalFacebookPost:
    """Stable shape produced by every Actor adapter."""

    facebook_post_id: str
    group_id: str
    group_name: str | None
    group_url: str | None
    source_url: str | None
    published_at: str | None  # ISO-8601
    text: str
    attachments: list[FacebookAttachment] = field(default_factory=list)
    # Optional, minimal — never a profile object
    author_display_name: str | None = None
    # Opaque original row for debugging only (not written to public catalog)
    adapter_name: str = "unknown"
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d
