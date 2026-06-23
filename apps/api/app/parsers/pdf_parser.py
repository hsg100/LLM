"""PDF download + parse via PyMuPDF4LLM.

Returns parsed markdown plus best-effort sections for embedding. Parsing is
**page-aware**: we render the PDF a page at a time (``page_chunks=True``) and
record, for every character in the assembled markdown, which 1-based PDF page
it came from. Sections carry their page range and the absolute character offset
of their content, so the worker can map each derived chunk back to a page (the
vision's "page 4, chunk 12" grounding).

Network and parse failures are caught and reported so they don't kill the
larger landscape pipeline — a paper with no parsed text falls back to
title+abstract during extraction.
"""

from __future__ import annotations

import io
import re
import tempfile
from dataclasses import dataclass, field
from typing import Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings


@dataclass
class ParsedSection:
    """A heading-delimited slice of the parsed markdown.

    ``doc_offset`` is the absolute character position of ``content`` within the
    assembled document markdown; combined with ``ParsedPdf.page_spans`` it lets
    the worker resolve the page of any sub-range (e.g. a chunk).
    """

    heading: Optional[str]
    content: str
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    doc_offset: int = 0


# (page_number, char_start, char_end) over the assembled markdown. Page numbers
# are 1-based; the gaps between spans are inter-page separators owned by neither.
PageSpan = tuple[Optional[int], int, int]


@dataclass
class ParsedPdf:
    ok: bool
    markdown: str = ""
    sections: list[ParsedSection] = field(default_factory=list)
    page_spans: list[PageSpan] = field(default_factory=list)
    page_count: Optional[int] = None
    bytes_: int = 0
    error: Optional[str] = None


_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)
_PAGE_SEP = "\n\n"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
async def download_pdf(url: str, max_mb: int) -> bytes:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        async with client.stream("GET", url, headers={"User-Agent": "FieldMap/0.1"}) as r:
            r.raise_for_status()
            buf = io.BytesIO()
            limit = max_mb * 1024 * 1024
            async for chunk in r.aiter_bytes():
                buf.write(chunk)
                if buf.tell() > limit:
                    raise RuntimeError(f"pdf exceeds max size {max_mb}MB")
            return buf.getvalue()


async def parse_pdf(url: Optional[str]) -> ParsedPdf:
    if not url:
        return ParsedPdf(ok=False, error="no pdf url")
    settings = get_settings()
    try:
        data = await download_pdf(url, settings.max_pdf_mb)
    except Exception as e:  # noqa: BLE001
        return ParsedPdf(ok=False, error=f"download failed: {e!s}")

    return parse_pdf_bytes(data)


def parse_pdf_bytes(data: bytes) -> ParsedPdf:
    try:
        import pymupdf4llm  # lazy import — heavy
    except Exception as e:  # noqa: BLE001
        return ParsedPdf(ok=False, error=f"pymupdf4llm import failed: {e!s}")

    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tf:
            tf.write(data)
            tf.flush()
            result = pymupdf4llm.to_markdown(tf.name, page_chunks=True)
    except Exception as e:  # noqa: BLE001
        return ParsedPdf(ok=False, bytes_=len(data), error=f"parse failed: {e!s}")

    md, page_spans, page_count = _assemble_pages(result)
    # Chunking is owned by the worker (range-aware _chunk_text_with_ranges);
    # we only return sections + raw markdown + page map here.
    sections = _split_sections(md, page_spans)
    return ParsedPdf(
        ok=True,
        markdown=md,
        sections=sections,
        page_spans=page_spans,
        page_count=page_count,
        bytes_=len(data),
    )


def _assemble_pages(result: object) -> tuple[str, list[PageSpan], Optional[int]]:
    """Join per-page markdown into one document, tracking page char-spans.

    ``pymupdf4llm.to_markdown(..., page_chunks=True)`` returns a list of page
    dicts (``text`` + ``metadata.page_number``). Older/edge builds may return a
    plain string; we degrade gracefully to a single span-less document.
    """
    if isinstance(result, str):
        return result, [], None
    if not isinstance(result, list):
        return ("" if result is None else str(result)), [], None

    parts: list[str] = []
    page_spans: list[PageSpan] = []
    cursor = 0
    for i, page in enumerate(result):
        text = str((page or {}).get("text") or "")
        meta = (page or {}).get("metadata") or {}
        page_no = meta.get("page_number")
        if i > 0:
            parts.append(_PAGE_SEP)
            cursor += len(_PAGE_SEP)
        start = cursor
        parts.append(text)
        cursor += len(text)
        page_spans.append((page_no, start, cursor))
    page_count = None
    if result:
        page_count = ((result[0] or {}).get("metadata") or {}).get("page_count") or len(result)
    return "".join(parts), page_spans, page_count


def page_for_offset(page_spans: list[PageSpan], offset: int) -> Optional[int]:
    """Map an absolute char offset in the assembled markdown to a 1-based page.

    Offsets that land in the separator gap between two pages resolve to the
    preceding page; offsets past the end resolve to the last page.
    """
    if not page_spans:
        return None
    last_page = page_spans[0][0]
    for page_no, start, end in page_spans:
        if offset < start:
            return last_page
        if start <= offset < end:
            return page_no
        last_page = page_no
    return last_page


def _split_sections(md: str, page_spans: list[PageSpan]) -> list[ParsedSection]:
    matches = list(_HEADING_RE.finditer(md))
    if not matches:
        # No detectable headings; treat the whole doc as one section.
        stripped = md.strip()
        if not stripped:
            return []
        leading = len(md) - len(md.lstrip())
        return [
            ParsedSection(
                heading="Body",
                content=stripped,
                page_start=page_for_offset(page_spans, leading),
                page_end=page_for_offset(page_spans, max(leading, len(md.rstrip()) - 1)),
                doc_offset=leading,
            )
        ]
    sections: list[ParsedSection] = []
    for i, m in enumerate(matches):
        heading = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        raw = md[start:end]
        content = raw.strip()
        if not content:
            continue
        leading = len(raw) - len(raw.lstrip())
        content_start = start + leading
        content_end = content_start + len(content)
        sections.append(
            ParsedSection(
                heading=heading,
                content=content,
                page_start=page_for_offset(page_spans, content_start),
                page_end=page_for_offset(page_spans, max(content_start, content_end - 1)),
                doc_offset=content_start,
            )
        )
    return sections
