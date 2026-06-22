"""PDF download + parse via PyMuPDF4LLM.

Returns parsed markdown plus best-effort sections and small chunks for
embedding. Network and parse failures are caught and reported so they
don't kill the larger landscape pipeline — a paper with no parsed text
falls back to title+abstract during extraction.
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
class ParsedPdf:
    ok: bool
    markdown: str = ""
    sections: list[tuple[str, str]] = field(default_factory=list)  # (heading, content)
    bytes_: int = 0
    error: Optional[str] = None


_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)


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
            md = pymupdf4llm.to_markdown(tf.name)
    except Exception as e:  # noqa: BLE001
        return ParsedPdf(ok=False, bytes_=len(data), error=f"parse failed: {e!s}")

    # Chunking is owned by the worker (range-aware _chunk_text_with_ranges);
    # we only return sections + raw markdown here.
    sections = _split_sections(md)
    return ParsedPdf(ok=True, markdown=md, sections=sections, bytes_=len(data))


def _split_sections(md: str) -> list[tuple[str, str]]:
    matches = list(_HEADING_RE.finditer(md))
    if not matches:
        # No detectable headings; treat the whole doc as one section.
        return [("Body", md.strip())]
    sections: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        heading = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        content = md[start:end].strip()
        if content:
            sections.append((heading, content))
    return sections


