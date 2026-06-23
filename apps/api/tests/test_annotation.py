"""Sprint 7 — server-rendered concept annotation (single source of truth).

The golden fixture pins the canonical ``annotate_text`` contract that the client
consumes verbatim, so the segmentation can't silently drift.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Concept, Landscape
from app.services.concepts import annotate_text

FIXTURE = Path(__file__).parent / "fixtures" / "annotation_golden.json"


def test_annotation_matches_golden_fixture():
    fixture = json.loads(FIXTURE.read_text())
    segments = annotate_text(fixture["text"], fixture["concepts"])
    assert segments == fixture["segments"]


def test_annotation_protects_code_and_headings_and_skips_generic():
    fixture = json.loads(FIXTURE.read_text())
    segments = annotate_text(fixture["text"], fixture["concepts"])
    concept_texts = [s["text"] for s in segments if s["type"] == "concept"]
    # `RAG` in a code span and RAG in a heading must not be annotated.
    assert concept_texts.count("RAG") == 1
    # The generic term "model" is never a concept.
    assert "model" not in concept_texts
    # Round-trips losslessly back to the source text.
    assert "".join(s["text"] for s in segments) == fixture["text"]


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(sa_text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


@dbonly
def test_annotate_endpoint_returns_segments():
    from starlette.testclient import TestClient

    from app.main import app

    ls_id = None
    try:
        with session_scope() as s:
            ls = Landscape(topic="annotate endpoint test")
            s.add(ls)
            s.flush()
            ls_id = ls.id
            s.add(
                Concept(
                    landscape_id=ls_id,
                    name="faithfulness",
                    term="faithfulness",
                    slug="faithfulness",
                    short_definition="Whether an answer is supported by sources.",
                    confidence=0.8,
                )
            )

        client = TestClient(app)
        r = client.post(
            f"/api/landscapes/{ls_id}/annotate",
            json={"texts": ["faithfulness matters", "no concepts here"]},
        )
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) == 2
        assert any(seg["type"] == "concept" and seg["concept_slug"] == "faithfulness" for seg in results[0])
        assert all(seg["type"] == "text" for seg in results[1])

        missing = client.post("/api/landscapes/does-not-exist/annotate", json={"texts": ["x"]})
        assert missing.status_code == 404
    finally:
        if ls_id is not None:
            with session_scope() as s:
                for c in s.exec(select(Concept).where(Concept.landscape_id == ls_id)).all():
                    s.delete(c)
                lsr = s.get(Landscape, ls_id)
                if lsr:
                    s.delete(lsr)
