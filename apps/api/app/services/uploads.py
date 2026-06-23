"""User-uploaded PDF ingestion ("bring your own paper").

Stores the file, parses it into sections/chunks, creates a ``source="upload"``
Paper, and links it to a landscape. Reuses the same storage/parser/chunking as
the pipeline so uploaded papers behave like discovered ones. LLM extraction +
synthesis integration happens on the next landscape run; this path is
synchronous and dependency-light (no LLM/embedding call in the request).
"""

from __future__ import annotations

import hashlib
import re
from typing import Optional

from sqlmodel import Session, select

from app.models import LandscapePaper, Paper, PaperPdf
from app.parsers.pdf_parser import parse_pdf_bytes
from app.services.paper_sources.base import normalize_title
from app.services.pdf_storage import deterministic_pdf_filename, store_pdf_bytes
from app.workers.landscape_job import _replace_sections_and_chunks

UPLOAD_SOURCE = "upload"


def title_from_filename(filename: str) -> str:
    stem = re.sub(r"\.pdf$", "", filename or "", flags=re.IGNORECASE)
    stem = stem.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = re.sub(r"[_]+", " ", stem).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:300] or "Uploaded paper"


def looks_like_pdf(data: bytes, filename: Optional[str]) -> bool:
    if data[:5] == b"%PDF-":
        return True
    return bool(filename and filename.lower().endswith(".pdf"))


def ingest_uploaded_pdf(s: Session, landscape_id: str, filename: str, data: bytes) -> dict[str, object]:
    """Store + parse + persist an uploaded PDF and link it to the landscape.

    Idempotent on content: re-uploading the same bytes updates the same Paper.
    Returns a small status dict.
    """
    digest = hashlib.sha256(data).hexdigest()
    external_id = digest[:32]
    title = title_from_filename(filename)

    paper = s.exec(
        select(Paper).where(Paper.source == UPLOAD_SOURCE, Paper.external_id == external_id)
    ).first()
    if paper is None:
        paper = Paper(
            source=UPLOAD_SOURCE,
            external_id=external_id,
            title=title,
            title_norm=normalize_title(title),
            authors=[],
            metadata_={"uploaded_filename": filename, "content_sha256": digest},
        )
        s.add(paper)
        s.flush()

    parsed = parse_pdf_bytes(data)
    storage_name = deterministic_pdf_filename(year=None, title=title, arxiv_id=None, paper_id=paper.id)
    storage_path, _path, _written = store_pdf_bytes(data, storage_name)

    pdf_row = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper.id)).first()
    if pdf_row is None:
        pdf_row = PaperPdf(paper_id=paper.id)
    pdf_row.storage_path = storage_path
    pdf_row.bytes = len(data)
    if parsed.ok:
        pdf_row.status = "ok"
        pdf_row.parsed_markdown = parsed.markdown
        pdf_row.error = None
    else:
        pdf_row.status = "failed"
        pdf_row.error = parsed.error
    s.add(pdf_row)

    if parsed.ok:
        if not paper.abstract and parsed.markdown:
            paper.abstract = parsed.markdown.strip()[:1500]
            s.add(paper)
        _replace_sections_and_chunks(s, paper.id, parsed)

    link = s.exec(
        select(LandscapePaper).where(
            LandscapePaper.landscape_id == landscape_id,
            LandscapePaper.paper_id == paper.id,
        )
    ).first()
    if link is None:
        link = LandscapePaper(
            landscape_id=landscape_id,
            paper_id=paper.id,
            score=0.5,
            category="useful",
            rationale="Uploaded by you.",
        )
        s.add(link)

    return {
        "paper_id": paper.id,
        "title": paper.title,
        "parsed": parsed.ok,
        "sections": len(parsed.sections) if parsed.ok else 0,
        "error": None if parsed.ok else parsed.error,
    }
