from app.services.paper_sources.arxiv import ArxivSource
from app.services.paper_sources.base import (
    PaperCandidate,
    PaperSource,
    SearchOutcome,
    dedupe,
    merge_candidates,
    normalize_title,
)
from app.services.paper_sources.semantic_scholar import SemanticScholarSource
from app.services.paper_sources.stub import StubSource

__all__ = [
    "PaperCandidate",
    "PaperSource",
    "SearchOutcome",
    "ArxivSource",
    "SemanticScholarSource",
    "StubSource",
    "dedupe",
    "merge_candidates",
    "normalize_title",
    "get_source",
]


def get_source(name: str) -> PaperSource:
    name = (name or "").lower()
    if name == "arxiv":
        return ArxivSource()
    if name in ("semantic_scholar", "semanticscholar", "s2"):
        return SemanticScholarSource()
    if name == "stub":
        return StubSource()
    raise ValueError(f"unknown paper source: {name}")
