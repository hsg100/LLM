"""Sprint 5 — page-aware parsing, page grounding, and extraction refresh.

Pure-function tests run everywhere; the chunk→page persistence test is
DB-backed and skips cleanly without Postgres.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Chunk, Paper, PaperSection
from app.parsers.pdf_parser import (
    ParsedPdf,
    ParsedSection,
    _assemble_pages,
    _split_sections,
    page_for_offset,
    parse_pdf_bytes,
)
from app.services.extraction import ExtractionContextChunk, validate_grounding
from app.schemas import Extraction
from app.workers.landscape_job import (
    _extraction_needs_refresh,
    _replace_sections_and_chunks,
)


# ---------------------------------------------------------------------------
# page_for_offset
# ---------------------------------------------------------------------------
def test_page_for_offset_resolves_pages_gaps_and_bounds():
    spans = [(1, 0, 10), (2, 12, 20), (3, 22, 30)]
    assert page_for_offset(spans, 0) == 1
    assert page_for_offset(spans, 9) == 1
    # offset inside the separator gap → preceding page
    assert page_for_offset(spans, 11) == 1
    assert page_for_offset(spans, 12) == 2
    assert page_for_offset(spans, 25) == 3
    # past the end → last page
    assert page_for_offset(spans, 999) == 3
    assert page_for_offset([], 5) is None


# ---------------------------------------------------------------------------
# _assemble_pages
# ---------------------------------------------------------------------------
def test_assemble_pages_builds_contiguous_spans():
    pages = [
        {"text": "alpha", "metadata": {"page_number": 1, "page_count": 2}},
        {"text": "beta", "metadata": {"page_number": 2, "page_count": 2}},
    ]
    md, spans, count = _assemble_pages(pages)
    assert md == "alpha\n\nbeta"
    assert spans == [(1, 0, 5), (2, 7, 11)]
    assert count == 2
    # The page text round-trips at its recorded span.
    assert md[spans[0][1]:spans[0][2]] == "alpha"
    assert md[spans[1][1]:spans[1][2]] == "beta"


def test_assemble_pages_degrades_for_plain_string():
    md, spans, count = _assemble_pages("just a string")
    assert md == "just a string"
    assert spans == []
    assert count is None


# ---------------------------------------------------------------------------
# _split_sections page assignment
# ---------------------------------------------------------------------------
def test_split_sections_assigns_pages_per_section():
    intro = "# Intro\n\nAlpha body.\n\n"
    method = "# Method\n\nBeta body.\n\n"
    results = "# Results\n\nGamma body."
    md = intro + method + results
    spans = [
        (1, 0, len(intro)),
        (2, len(intro), len(intro) + len(method)),
        (3, len(intro) + len(method), len(md)),
    ]
    sections = _split_sections(md, spans)
    assert [s.heading for s in sections] == ["Intro", "Method", "Results"]
    assert sections[0].page_start == 1 and sections[0].page_end == 1
    assert sections[1].page_start == 2 and sections[1].page_end == 2
    assert sections[2].page_start == 3 and sections[2].page_end == 3


def test_split_sections_section_spanning_two_pages():
    body = "# Big\n\n" + ("x" * 50) + "PAGEBREAK" + ("y" * 50)
    cut = body.index("PAGEBREAK")
    spans = [(4, 0, cut), (5, cut, len(body))]
    sections = _split_sections(body, spans)
    assert len(sections) == 1
    assert sections[0].page_start == 4
    assert sections[0].page_end == 5


def test_split_sections_no_headings_is_single_body():
    md = "no headings here, just text spanning."
    spans = [(7, 0, len(md))]
    sections = _split_sections(md, spans)
    assert len(sections) == 1
    assert sections[0].heading == "Body"
    assert sections[0].page_start == 7 and sections[0].page_end == 7


# ---------------------------------------------------------------------------
# parse_pdf_bytes end-to-end (uses the real pymupdf4llm)
# ---------------------------------------------------------------------------
def _make_multipage_pdf(n: int = 3) -> bytes:
    import fitz

    doc = fitz.open()
    for i in range(n):
        page = doc.new_page()
        page.insert_text((72, 72), f"Section {i}\n" + ("lorem ipsum dolor sit amet " * 30))
    data = doc.tobytes()
    doc.close()
    return data


def test_parse_pdf_bytes_is_page_aware():
    parsed = parse_pdf_bytes(_make_multipage_pdf(3))
    assert parsed.ok
    assert parsed.page_count == 3
    assert len(parsed.page_spans) == 3
    assert [p for p, _s, _e in parsed.page_spans] == [1, 2, 3]
    assert parsed.sections, "expected at least one section"
    for sec in parsed.sections:
        assert sec.page_start is not None
        assert 1 <= sec.page_start <= 3
        assert sec.page_end is not None and sec.page_end >= sec.page_start


# ---------------------------------------------------------------------------
# grounding inherits the chunk's page
# ---------------------------------------------------------------------------
def test_grounding_inherits_page_from_context_chunk():
    data = {
        **Extraction().model_dump(),
        "method": "The method uses a two-stage retriever.",
        "source_grounding": [
            {
                "field": "method",
                "chunk_id": "c-7",
                "quote": "The method uses a two-stage retriever.",
                "confidence": 0.9,
            }
        ],
    }
    validated, diag = validate_grounding(
        Extraction.model_validate(data).model_dump(),
        [ExtractionContextChunk("c-7", "Method", 4, 7, "The method uses a two-stage retriever.")],
    )
    g = validated["source_grounding"][0]
    assert g["page"] == 4
    assert g["chunk_ordinal"] == 7
    assert g["section"] == "Method"
    assert diag["grounded_fields"] == 1


# ---------------------------------------------------------------------------
# _extraction_needs_refresh explicit cases
# ---------------------------------------------------------------------------
def _meta(*, degraded: bool, with_grounding: bool = True) -> dict:
    fm: dict = {"degraded": degraded, "fallback_reason": None}
    if with_grounding:
        fm["grounding"] = {"grounded_fields": 1, "ungrounded_fields": 0}
    return {"_fieldmap": fm}


def test_refresh_empty_data():
    assert _extraction_needs_refresh({}, provider_is_real=True) is True
    assert _extraction_needs_refresh(None, provider_is_real=False) is True


def test_refresh_legacy_no_meta():
    assert _extraction_needs_refresh({"problem": "x"}, provider_is_real=False) is True


def test_refresh_missing_grounding_diag():
    data = _meta(degraded=False, with_grounding=False)
    assert _extraction_needs_refresh(data, provider_is_real=False) is True


def test_refresh_degraded_invalidated_by_real_provider():
    data = {**_meta(degraded=True), "problem": "weak"}
    # The headline acceptance case: stub→real re-extracts degraded papers.
    assert _extraction_needs_refresh(data, provider_is_real=True) is True
    # On the stub, re-running can't improve it — keep the cached degraded result.
    assert _extraction_needs_refresh(data, provider_is_real=False) is False


def test_refresh_healthy_extraction_is_kept():
    data = {
        **_meta(degraded=False),
        "problem": "A real problem statement.",
        "method": "A described method.",
        "contribution": "A clear contribution.",
    }
    assert _extraction_needs_refresh(data, provider_is_real=True) is False
    assert _extraction_needs_refresh(data, provider_is_real=False) is False


def test_refresh_low_signal_only_with_real_provider():
    data = _meta(degraded=False)  # no signal fields at all
    assert _extraction_needs_refresh(data, provider_is_real=True) is True
    assert _extraction_needs_refresh(data, provider_is_real=False) is False


# ---------------------------------------------------------------------------
# DB-backed: chunk page numbers persist through _replace_sections_and_chunks
# ---------------------------------------------------------------------------
def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


@dbonly
def test_replace_sections_and_chunks_persists_pages():
    long_body = ("alpha " * 250) + "MIDPOINT" + ("omega " * 250)
    cut = len("# Big\n\n") + long_body.index("MIDPOINT")
    full = "# Big\n\n" + long_body
    parsed = ParsedPdf(
        ok=True,
        markdown=full,
        sections=[
            ParsedSection(
                heading="Big",
                content=long_body,
                page_start=2,
                page_end=3,
                doc_offset=len("# Big\n\n"),
            )
        ],
        page_spans=[(2, 0, cut), (3, cut, len(full))],
        page_count=3,
    )
    paper_id = None
    try:
        with session_scope() as s:
            paper = Paper(source="test", external_id="page-test-1", title="Page test")
            s.add(paper)
            s.flush()
            paper_id = paper.id
            _replace_sections_and_chunks(s, paper_id, parsed)

        with session_scope() as s:
            sections = s.exec(select(PaperSection).where(PaperSection.paper_id == paper_id)).all()
            assert len(sections) == 1
            assert sections[0].page_start == 2 and sections[0].page_end == 3

            chunks = s.exec(
                select(Chunk).where(Chunk.paper_id == paper_id).order_by(Chunk.ordinal)
            ).all()
            assert len(chunks) >= 2, "long body should yield multiple chunks"
            # Every chunk carries a page; the first starts on page 2, a later
            # chunk crosses into page 3.
            assert all(c.page_start is not None for c in chunks)
            assert chunks[0].page_start == 2
            assert any(c.page_start == 3 or c.page_end == 3 for c in chunks)
    finally:
        if paper_id is not None:
            with session_scope() as s:
                for model in (Chunk, PaperSection):
                    for row in s.exec(select(model).where(model.paper_id == paper_id)).all():
                        s.delete(row)
                p = s.get(Paper, paper_id)
                if p:
                    s.delete(p)
