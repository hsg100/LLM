"""Sprint 7 — shared export service: write round-trip + auto-export gating."""
from __future__ import annotations

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Landscape, LandscapePaper, ObsidianExport, Paper
from app.services import export_service


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(sa_text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


def _seed(s) -> str:  # type: ignore[no-untyped-def]
    ls = Landscape(topic="export service test", synthesis={"field_overview": "An overview."})
    s.add(ls)
    s.flush()
    paper = Paper(source="test", external_id="exp-1", title="Export Paper", year=2025)
    s.add(paper)
    s.flush()
    s.add(
        LandscapePaper(
            landscape_id=ls.id,
            paper_id=paper.id,
            score=0.9,
            category="must-read",
            rationale="seed",
        )
    )
    return ls.id


def _cleanup(ls_id: str) -> None:
    with session_scope() as s:
        for row in s.exec(select(ObsidianExport).where(ObsidianExport.landscape_id == ls_id)).all():
            s.delete(row)
        for link in s.exec(select(LandscapePaper).where(LandscapePaper.landscape_id == ls_id)).all():
            pid = link.paper_id
            s.delete(link)
            p = s.get(Paper, pid)
            if p:
                s.delete(p)
        ls = s.get(Landscape, ls_id)
        if ls:
            s.delete(ls)


@dbonly
def test_write_landscape_export_writes_and_records(tmp_path):
    ls_id = None
    try:
        with session_scope() as s:
            ls_id = _seed(s)
        with session_scope() as s:
            result = export_service.write_landscape_export(
                s, ls_id, root=tmp_path, push=False, force=False
            )
            assert result["files"], "expected files written"
            assert result["pushed"] is False
        # Files landed on disk and export rows were recorded.
        assert (tmp_path / "FieldMap Research").exists()
        with session_scope() as s:
            rows = s.exec(select(ObsidianExport).where(ObsidianExport.landscape_id == ls_id)).all()
            assert len(rows) > 0
    finally:
        if ls_id:
            _cleanup(ls_id)


@dbonly
def test_auto_export_respects_setting(tmp_path, monkeypatch):
    ls_id = None
    try:
        with session_scope() as s:
            ls_id = _seed(s)

        monkeypatch.setattr(export_service, "make_repo_root", lambda: tmp_path)

        class _S:
            obsidian_auto_export = False
            obsidian_export_auto_push = False

        monkeypatch.setattr(export_service, "effective_settings", lambda s=None: _S())
        assert export_service.auto_export_landscape(ls_id) is None

        _S.obsidian_auto_export = True
        result = export_service.auto_export_landscape(ls_id)
        assert result is not None and result["files"]
    finally:
        if ls_id:
            _cleanup(ls_id)
