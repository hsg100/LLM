"""Sprint 8 — global jobs index endpoint (DB-backed; skips without Postgres)."""
from __future__ import annotations

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Landscape, SearchJob


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(sa_text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


@dbonly
def test_jobs_index_lists_with_topic_and_filters_by_landscape():
    from starlette.testclient import TestClient

    from app.main import app

    ls_id = None
    try:
        with session_scope() as s:
            ls = Landscape(topic="jobs index test")
            s.add(ls)
            s.flush()
            ls_id = ls.id
            s.add(SearchJob(landscape_id=ls_id, stage="running", progress=0.4))

        client = TestClient(app)
        rows = client.get("/api/jobs").json()
        assert any(r["landscape_id"] == ls_id and r["topic"] == "jobs index test" for r in rows)
        # Newest-first ordering and the lightweight shape (no event list).
        assert "events" not in rows[0]

        scoped = client.get(f"/api/jobs?landscape_id={ls_id}").json()
        assert scoped and all(r["landscape_id"] == ls_id for r in scoped)
        assert scoped[0]["stage"] == "running"
    finally:
        if ls_id:
            with session_scope() as s:
                for j in s.exec(select(SearchJob).where(SearchJob.landscape_id == ls_id)).all():
                    s.delete(j)
                lsr = s.get(Landscape, ls_id)
                if lsr:
                    s.delete(lsr)
