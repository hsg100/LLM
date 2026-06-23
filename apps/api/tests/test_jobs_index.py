"""Sprint 8 — global jobs index endpoint (DB-backed; skips without Postgres)."""
from __future__ import annotations

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Cluster, Landscape, LandscapePaper, Paper, SearchJob


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


@dbonly
def test_papers_and_graph_include_cluster_display_metadata():
    from starlette.testclient import TestClient

    from app.main import app

    ls_id = None
    paper_id = None
    cluster_id = None
    try:
        with session_scope() as s:
            ls = Landscape(topic="cluster metadata test")
            s.add(ls)
            s.flush()
            ls_id = ls.id
            paper = Paper(
                source="test",
                external_id=f"cluster-meta-{ls_id}",
                title="Readable Cluster Paper",
                title_norm="readable-cluster-paper",
            )
            s.add(paper)
            s.flush()
            paper_id = paper.id
            cluster = Cluster(
                landscape_id=ls_id,
                name="Retrieval Evaluation",
                summary="Papers that compare evaluation methods.",
                ordinal=2,
            )
            s.add(cluster)
            s.flush()
            cluster_id = cluster.id
            s.add(
                LandscapePaper(
                    landscape_id=ls_id,
                    paper_id=paper_id,
                    score=0.8,
                    category="useful",
                    cluster_id=cluster_id,
                )
            )

        client = TestClient(app)
        papers = client.get(f"/api/landscapes/{ls_id}/papers").json()
        assert papers[0]["cluster_id"] == cluster_id
        assert papers[0]["cluster_name"] == "Retrieval Evaluation"
        assert papers[0]["cluster_summary"] == "Papers that compare evaluation methods."
        assert papers[0]["cluster_ordinal"] == 2

        graph = client.get(f"/api/landscapes/{ls_id}/graph").json()
        assert graph["nodes"][0]["cluster_id"] == cluster_id
        assert graph["nodes"][0]["cluster_name"] == "Retrieval Evaluation"
        assert graph["nodes"][0]["cluster_ordinal"] == 2
    finally:
        if ls_id:
            with session_scope() as s:
                for lp in s.exec(select(LandscapePaper).where(LandscapePaper.landscape_id == ls_id)).all():
                    s.delete(lp)
                if cluster_id:
                    cluster = s.get(Cluster, cluster_id)
                    if cluster:
                        s.delete(cluster)
                if paper_id:
                    paper = s.get(Paper, paper_id)
                    if paper:
                        s.delete(paper)
                lsr = s.get(Landscape, ls_id)
                if lsr:
                    s.delete(lsr)
