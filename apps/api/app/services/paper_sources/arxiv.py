"""arXiv paper source.

Hardening notes:

- Uses HTTPS. arXiv has been redirecting plain HTTP to HTTPS for a while;
  some httpx versions don't follow redirects by default, which made
  ``http://export.arxiv.org/...`` look like an empty/HTML response and
  blow up downstream.
- Sets ``follow_redirects=True`` as belt-and-braces.
- Drops the phrase-quoted query (``all:"RAG evaluation"``) — arXiv often
  returns 4xx/empty for that. We build a clean ``all:`` query from the
  topic tokens and let the API treat spaces as AND.
- ``search()`` never raises. All failures (timeout, retry-exhausted,
  HTTP 4xx/5xx, malformed XML) come back as a ``SearchOutcome`` with
  ``error_type`` populated so the worker can log them as job events.
"""

from __future__ import annotations

import re
import time
from typing import Optional
from urllib.parse import quote_plus

import feedparser
import httpx
from tenacity import (
    AsyncRetrying,
    RetryError,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings
from app.services.paper_sources.base import (
    PaperCandidate,
    PaperSource,
    SearchOutcome,
)


ARXIV_API = "https://export.arxiv.org/api/query"


def build_query(topic: str) -> str:
    """Build an arXiv query string from a free-text topic.

    Splits on whitespace; encodes each token; joins with ``+AND+``. This
    avoids the phrase-quoted form which arXiv handles inconsistently and
    keeps multi-word topics working as conjunctions.
    """
    tokens = [t for t in re.split(r"\s+", (topic or "").strip()) if t]
    if not tokens:
        return "all:*"
    if len(tokens) == 1:
        return f"all:{quote_plus(tokens[0])}"
    return "+AND+".join(f"all:{quote_plus(t)}" for t in tokens)


def build_url(query: str, max_results: int) -> str:
    return (
        f"{ARXIV_API}?search_query={query}"
        f"&start=0&max_results={int(max_results)}"
        f"&sortBy=relevance&sortOrder=descending"
    )


class ArxivSource(PaperSource):
    name = "arxiv"

    async def search(self, topic: str, max_results: int) -> SearchOutcome:
        settings = get_settings()
        query = build_query(topic)
        url = build_url(query, max_results)
        outcome = SearchOutcome(source=self.name, query=query, request_url=url)

        start = time.monotonic()
        text: Optional[str] = None
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=1, min=1, max=10),
                reraise=True,
            ):
                with attempt:
                    async with httpx.AsyncClient(
                        timeout=settings.arxiv_timeout_seconds,
                        follow_redirects=True,
                        headers={
                            "User-Agent": settings.http_user_agent,
                            "Accept": "application/atom+xml,application/xml;q=0.9,*/*;q=0.1",
                        },
                    ) as client:
                        r = await client.get(url)
                        outcome.status_code = r.status_code
                        outcome.request_url = str(r.url)
                        # Treat 429 / 503 as retryable; everything else raises.
                        if r.status_code in (429, 503):
                            r.raise_for_status()
                        r.raise_for_status()
                        text = r.text
        except RetryError as e:
            outcome.error_type = "RetryError"
            outcome.error_message = _short(str(e.last_attempt.exception() if e.last_attempt else e))
            outcome.succeeded = False
        except httpx.HTTPStatusError as e:
            outcome.error_type = "HTTPStatusError"
            outcome.status_code = e.response.status_code if e.response is not None else outcome.status_code
            outcome.error_message = _short(str(e))
            outcome.succeeded = False
        except httpx.TimeoutException as e:
            outcome.error_type = "Timeout"
            outcome.error_message = _short(str(e))
            outcome.succeeded = False
        except httpx.HTTPError as e:
            outcome.error_type = type(e).__name__
            outcome.error_message = _short(str(e))
            outcome.succeeded = False
        except Exception as e:  # noqa: BLE001
            outcome.error_type = type(e).__name__
            outcome.error_message = _short(str(e))
            outcome.succeeded = False

        outcome.elapsed_ms = int((time.monotonic() - start) * 1000)

        if text is None:
            return outcome

        # Parse — feedparser never raises but may return a bozo feed.
        try:
            feed = feedparser.parse(text)
        except Exception as e:  # noqa: BLE001
            outcome.error_type = outcome.error_type or "MalformedFeed"
            outcome.error_message = outcome.error_message or _short(str(e))
            outcome.succeeded = False
            return outcome

        outcome.raw_entry_count = len(feed.entries or [])
        for entry in feed.entries or []:
            cand = _entry_to_candidate(entry)
            if cand is not None:
                outcome.candidates.append(cand)

        if outcome.raw_entry_count == 0 and outcome.succeeded:
            # 200 OK but empty feed — treat as soft failure so callers can decide on fallback.
            outcome.error_type = "EmptyFeed"
            outcome.error_message = "arXiv returned zero entries for this query"
            outcome.succeeded = False

        return outcome


# ---------------------------------------------------------------------------
_ARXIV_ID_RE = re.compile(r"arxiv\.org/abs/([^v\s/]+)(v\d+)?")


def _entry_to_candidate(entry) -> Optional[PaperCandidate]:  # type: ignore[no-untyped-def]
    title = (getattr(entry, "title", "") or "").strip()
    if not title:
        return None
    abstract = (getattr(entry, "summary", "") or "").strip()
    authors = [a.name for a in getattr(entry, "authors", [])] if getattr(entry, "authors", None) else []

    raw_id = getattr(entry, "id", "") or ""
    m = _ARXIV_ID_RE.search(raw_id)
    arxiv_id = m.group(1) if m else raw_id.rsplit("/", 1)[-1]
    version = (m.group(2) or "") if m else ""
    external_id = f"{arxiv_id}{version}"

    published = getattr(entry, "published", "") or ""
    year: Optional[int] = None
    if len(published) >= 4 and published[:4].isdigit():
        year = int(published[:4])

    pdf_url: Optional[str] = None
    url: Optional[str] = None
    for link in getattr(entry, "links", []):
        if getattr(link, "rel", "") == "alternate" and getattr(link, "type", "") == "text/html":
            url = link.href
        if getattr(link, "title", "") == "pdf" or getattr(link, "type", "") == "application/pdf":
            pdf_url = link.href
    if pdf_url is None and arxiv_id:
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

    primary = getattr(entry, "arxiv_primary_category", None)
    venue = primary["term"] if primary and isinstance(primary, dict) else None

    return PaperCandidate(
        source="arxiv",
        external_id=external_id,
        title=title,
        abstract=abstract,
        authors=authors,
        year=year,
        venue=venue,
        pdf_url=pdf_url,
        arxiv_id=arxiv_id,
        url=url or f"https://arxiv.org/abs/{arxiv_id}",
        metadata={"primary_category": venue},
    )


def _short(msg: str, n: int = 240) -> str:
    msg = (msg or "").strip().replace("\n", " ")
    return msg if len(msg) <= n else msg[: n - 1] + "…"
