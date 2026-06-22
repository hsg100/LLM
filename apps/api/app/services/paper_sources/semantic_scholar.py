"""Semantic Scholar paper source.

Provides the citation/influence signals arXiv lacks (citation_count,
influentialCitationCount) plus open-access PDF links and DOIs for cross-source
merging. Follows the same contract as ArxivSource: ``search`` never raises —
all failures come back on the ``SearchOutcome``.
"""

from __future__ import annotations

import time
from typing import Any, Optional

import httpx
from tenacity import AsyncRetrying, RetryError, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import get_settings
from app.services.paper_sources.base import PaperCandidate, PaperSource, SearchOutcome


S2_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
_FIELDS = ",".join(
    [
        "title",
        "abstract",
        "year",
        "venue",
        "authors",
        "citationCount",
        "influentialCitationCount",
        "externalIds",
        "openAccessPdf",
        "url",
    ]
)


class _Retryable(Exception):
    pass


class SemanticScholarSource(PaperSource):
    name = "semantic_scholar"

    async def search(self, topic: str, max_results: int) -> SearchOutcome:
        settings = get_settings()
        query = (topic or "").strip()
        params = {"query": query, "fields": _FIELDS, "limit": str(min(max(1, max_results), 100))}
        outcome = SearchOutcome(source=self.name, query=query, request_url=S2_SEARCH_URL)
        headers = {"User-Agent": settings.http_user_agent}
        if settings.semantic_scholar_api_key:
            headers["x-api-key"] = settings.semantic_scholar_api_key

        start = time.monotonic()
        data: Optional[dict[str, Any]] = None
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=1, min=1, max=10),
                retry=retry_if_exception_type(_Retryable),
                reraise=True,
            ):
                with attempt:
                    async with httpx.AsyncClient(timeout=settings.arxiv_timeout_seconds, follow_redirects=True) as client:
                        r = await client.get(S2_SEARCH_URL, params=params, headers=headers)
                        outcome.status_code = r.status_code
                        outcome.request_url = str(r.url)
                        # S2 rate-limits aggressively without a key (429); 5xx are transient.
                        if r.status_code == 429 or r.status_code >= 500:
                            raise _Retryable(f"HTTP {r.status_code}")
                        r.raise_for_status()
                        data = r.json()
        except RetryError as e:
            outcome.error_type = "RetryError"
            outcome.error_message = _short(str(e.last_attempt.exception() if e.last_attempt else e))
            outcome.succeeded = False
        except httpx.HTTPStatusError as e:
            outcome.error_type = "HTTPStatusError"
            outcome.status_code = e.response.status_code if e.response is not None else outcome.status_code
            outcome.error_message = _short(str(e))
            outcome.succeeded = False
        except Exception as e:  # noqa: BLE001
            outcome.error_type = type(e).__name__
            outcome.error_message = _short(str(e))
            outcome.succeeded = False

        outcome.elapsed_ms = int((time.monotonic() - start) * 1000)
        if data is None:
            return outcome

        entries = data.get("data") or []
        outcome.raw_entry_count = len(entries)
        for entry in entries:
            cand = _entry_to_candidate(entry)
            if cand is not None:
                outcome.candidates.append(cand)

        if outcome.raw_entry_count == 0 and outcome.succeeded:
            outcome.error_type = "EmptyResults"
            outcome.error_message = "Semantic Scholar returned zero results for this query"
            outcome.succeeded = False
        return outcome


def _entry_to_candidate(entry: dict[str, Any]) -> Optional[PaperCandidate]:
    title = (entry.get("title") or "").strip()
    if not title:
        return None
    paper_id = entry.get("paperId") or ""
    external_ids = entry.get("externalIds") or {}
    pdf = entry.get("openAccessPdf") or {}
    authors = [a.get("name", "") for a in (entry.get("authors") or []) if a.get("name")]
    arxiv_id = external_ids.get("ArXiv")
    return PaperCandidate(
        source="semantic_scholar",
        external_id=str(paper_id),
        title=title,
        abstract=(entry.get("abstract") or "").strip() or None,
        authors=authors,
        year=entry.get("year"),
        venue=(entry.get("venue") or "").strip() or None,
        citation_count=entry.get("citationCount"),
        pdf_url=(pdf.get("url") or None),
        arxiv_id=str(arxiv_id) if arxiv_id else None,
        doi=external_ids.get("DOI"),
        url=entry.get("url") or (f"https://www.semanticscholar.org/paper/{paper_id}" if paper_id else None),
        metadata={
            "influential_citation_count": entry.get("influentialCitationCount"),
            "external_ids": external_ids,
        },
    )


def _short(msg: str, n: int = 240) -> str:
    msg = (msg or "").strip().replace("\n", " ")
    return msg if len(msg) <= n else msg[: n - 1] + "…"
