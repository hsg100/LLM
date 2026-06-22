"""User-PDF ingestion (DB-backed; skips without Postgres)."""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Chunk, LandscapePaper, Landscape, Paper, PaperPdf, PaperSection
from app.services.uploads import ingest_uploaded_pdf, looks_like_pdf, title_from_filename


def test_title_from_filename():
    assert title_from_filename("attention_is_all_you_need.pdf") == "attention is all you need"
    assert title_from_filename("/tmp/Deep_Learning.PDF") == "Deep Learning"


def test_looks_like_pdf():
    assert looks_like_pdf(b"%PDF-1.7\n...", None)
    assert looks_like_pdf(b"garbage", "paper.pdf")
    assert not looks_like_pdf(b"garbage", "notes.txt")


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


def _make_pdf() -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Introduction\nThis paper proposes a new method for testing.")
    data = doc.tobytes()
    doc.close()
    return data


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


@dbonly
def test_ingest_uploaded_pdf_creates_paper_and_link(tmp_path, monkeypatch):
    # Isolate PDF storage to a writable temp dir (the default /data isn't
    # writable on CI runners).
    import app.services.pdf_storage as ps
    from app.config import Settings

    monkeypatch.setattr(ps, "get_settings", lambda: Settings(pdf_storage_dir=str(tmp_path)))

    pdf = _make_pdf()
    paper_id = None
    with session_scope() as s:
        ls = Landscape(topic="upload ingest test")
        s.add(ls)
        s.flush()
        ls_id = ls.id

    try:
        with session_scope() as s:
            result = ingest_uploaded_pdf(s, ls_id, "my_uploaded_paper.pdf", pdf)
            paper_id = result["paper_id"]
            assert result["parsed"] is True

        with session_scope() as s:
            paper = s.get(Paper, paper_id)
            assert paper.source == "upload"
            assert paper.title == "my uploaded paper"
            pdf_row = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
            assert pdf_row.status == "ok" and pdf_row.parsed_markdown
            link = s.exec(
                select(LandscapePaper).where(
                    LandscapePaper.landscape_id == ls_id, LandscapePaper.paper_id == paper_id
                )
            ).first()
            assert link is not None and link.category == "useful"

        # Idempotent on identical bytes: same paper, no duplicate link.
        with session_scope() as s:
            again = ingest_uploaded_pdf(s, ls_id, "my_uploaded_paper.pdf", pdf)
            assert again["paper_id"] == paper_id
        with session_scope() as s:
            links = s.exec(
                select(LandscapePaper).where(LandscapePaper.paper_id == paper_id)
            ).all()
            assert len(links) == 1
    finally:
        if paper_id is None:
            with session_scope() as s:
                ls = s.get(Landscape, ls_id)
                if ls:
                    s.delete(ls)
            return
        with session_scope() as s:
            for model in (Chunk, PaperSection):
                for row in s.exec(select(model).where(model.paper_id == paper_id)).all():
                    s.delete(row)
            for row in s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).all():
                s.delete(row)
            for row in s.exec(select(LandscapePaper).where(LandscapePaper.paper_id == paper_id)).all():
                s.delete(row)
            p = s.get(Paper, paper_id)
            if p:
                s.delete(p)
            ls = s.get(Landscape, ls_id)
            if ls:
                s.delete(ls)
