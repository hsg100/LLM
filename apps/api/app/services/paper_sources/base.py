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


def _identity_keys(c: PaperCandidate) -> list[tuple[str, str]]:
    """All identity keys a candidate carries. Two candidates are the same paper
    if they share ANY key (DOI, versionless arXiv id, or normalized title)."""
    keys: list[tuple[str, str]] = []
    if c.doi and c.doi.strip():
        keys.append(("doi", c.doi.strip().lower()))
    arxiv = (c.arxiv_id or "").split("v")[0].strip().lower()
    if arxiv:
        keys.append(("arxiv", arxiv))
    if c.title_norm:
        keys.append(("title", c.title_norm))
    if not keys:
        keys.append(("ext", f"{c.source}:{c.external_id}"))
    return keys


# Lower number = preferred identity/source when merging a duplicate group.
# Semantic Scholar / OpenAlex carry citation signal; arXiv reliably has a PDF.
_SOURCE_PRIORITY = {"semantic_scholar": 0, "openalex": 1, "crossref": 2, "arxiv": 3, "stub": 9}


def merge_candidates(group: list[PaperCandidate]) -> PaperCandidate:
    """Merge duplicates of one paper into a single richest record.

    Identity (source/external_id) is taken from the highest-priority source;
    missing scalar fields are backfilled from the rest, ``citation_count`` is the
    max seen, and ``pdf_url`` is borrowed from whichever source has one.
    """
    if len(group) == 1:
        return group[0]
    ordered = sorted(group, key=lambda c: _SOURCE_PRIORITY.get(c.source, 5))
    primary = ordered[0]

    def first(attr: str) -> Any:
        for c in ordered:
            v = getattr(c, attr)
            if v:
                return v
        return getattr(primary, attr)

    citations = [c.citation_count for c in group if c.citation_count is not None]
    authors = max((c.authors for c in ordered), key=lambda a: len(a or []), default=primary.authors)
    merged_meta: dict[str, Any] = {}
    for c in ordered:
        merged_meta.update(c.metadata or {})
    merged_meta["merged_sources"] = sorted({c.source for c in group})

    return PaperCandidate(
        source=primary.source,
        external_id=primary.external_id,
        title=primary.title or first("title"),
        abstract=first("abstract"),
        authors=authors or [],
        year=first("year"),
        venue=first("venue"),
        citation_count=max(citations) if citations else None,
        pdf_url=first("pdf_url"),
        arxiv_id=first("arxiv_id"),
        doi=first("doi"),
        url=first("url"),
        metadata=merged_meta,
    )


def dedupe(candidates: list[PaperCandidate]) -> list[PaperCandidate]:
    """Merge duplicates across sources, preserving first-seen order.

    Uses union-find over identity keys so a paper that shares *any* key with
    another (e.g. arXiv id from arXiv, DOI from Semantic Scholar) collapses into
    one merged record — even when neither source carries every identifier.
    """
    n = len(candidates)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)  # keep the earlier index as root

    key_owner: dict[tuple[str, str], int] = {}
    for i, c in enumerate(candidates):
        for key in _identity_keys(c):
            owner = key_owner.get(key)
            if owner is None:
                key_owner[key] = i
            else:
                union(i, owner)

    groups: dict[int, list[PaperCandidate]] = {}
    order: list[int] = []
    for i, c in enumerate(candidates):
        root = find(i)
        if root not in groups:
            groups[root] = []
            order.append(root)
        groups[root].append(c)
    return [merge_candidates(groups[root]) for root in order]
