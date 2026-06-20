from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s]")


def normalize_title(title: str) -> str:
    t = title.lower().strip()
    t = _PUNCT.sub(" ", t)
    t = _WS.sub(" ", t)
    return t.strip()


@dataclass
class PaperCandidate:
    """Normalized paper record returned by every source."""

    source: str
    external_id: str
    title: str
    abstract: Optional[str] = None
    authors: list[str] = field(default_factory=list)
    year: Optional[int] = None
    venue: Optional[str] = None
    citation_count: Optional[int] = None
    pdf_url: Optional[str] = None
    arxiv_id: Optional[str] = None
    doi: Optional[str] = None
    url: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def title_norm(self) -> str:
        return normalize_title(self.title)


@dataclass
class SearchOutcome:
    """Result of a single paper-source search, with full diagnostics.

    Every field is JSON-serializable so the worker can drop the dict
    straight into a job event.
    """

    source: str
    query: str
    candidates: list[PaperCandidate] = field(default_factory=list)
    request_url: Optional[str] = None
    status_code: Optional[int] = None
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    raw_entry_count: int = 0
    elapsed_ms: Optional[int] = None
    succeeded: bool = True

    def diagnostic_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "query": self.query,
            "request_url": self.request_url,
            "status_code": self.status_code,
            "error_type": self.error_type,
            "error_message": self.error_message,
            "raw_entry_count": self.raw_entry_count,
            "kept_count": len(self.candidates),
            "elapsed_ms": self.elapsed_ms,
            "succeeded": self.succeeded,
        }


class PaperSource(ABC):
    name: str

    @abstractmethod
    async def search(self, topic: str, max_results: int) -> SearchOutcome:
        """Search the source. Must NEVER raise — failures are reported via
        ``SearchOutcome.error_type`` and ``error_message`` so the pipeline
        can keep moving."""


def dedupe(candidates: list[PaperCandidate]) -> list[PaperCandidate]:
    """Dedupe by (arxiv_id without version), then (source, external_id), then normalized title."""
    seen_arxiv: set[str] = set()
    seen_ext: set[tuple[str, str]] = set()
    seen_titles: set[str] = set()
    out: list[PaperCandidate] = []
    for c in candidates:
        key_arxiv = (c.arxiv_id or "").split("v")[0].strip()
        key_ext = (c.source, c.external_id)
        key_title = c.title_norm
        if key_arxiv and key_arxiv in seen_arxiv:
            continue
        if key_ext in seen_ext:
            continue
        if key_title and key_title in seen_titles:
            continue
        if key_arxiv:
            seen_arxiv.add(key_arxiv)
        seen_ext.add(key_ext)
        if key_title:
            seen_titles.add(key_title)
        out.append(c)
    return out
