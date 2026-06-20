from app.services.paper_sources.arxiv import ArxivSource
from app.services.paper_sources.base import (
    PaperCandidate,
    PaperSource,
    SearchOutcome,
    dedupe,
    normalize_title,
)
from app.services.paper_sources.stub import StubSource

__all__ = [
    "PaperCandidate",
    "PaperSource",
    "SearchOutcome",
    "ArxivSource",
    "StubSource",
    "dedupe",
    "normalize_title",
    "get_source",
]


def get_source(name: str) -> PaperSource:
    name = (name or "").lower()
    if name == "arxiv":
        return ArxivSource()
    if name == "stub":
        return StubSource()
    raise ValueError(f"unknown paper source: {name}")
