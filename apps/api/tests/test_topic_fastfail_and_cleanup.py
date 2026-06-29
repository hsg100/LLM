"""Route-level fast fail + off-topic landscape cleanup (DB-backed; skips without Postgres)."""
from __future__ import annotations

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Cluster, Flashcard, JobEvent, Landscape, Quiz, SearchJob
from app.services.landscape_cleanup import delete_landscape_cascade, find_offtopic_landscapes


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(sa_text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


def _admin_token() -> str:
    """Seed accounts and return a valid admin bearer token."""
    from app.config import get_settings
    from app.services.auth import create_token
    from app.users import ADMIN_USER_ID, ensure_seed_users

    with session_scope() as s:
        ensure_seed_users(s)
    _ = get_settings()
    return create_token(ADMIN_USER_ID)


@dbonly
def test_create_landscape_requires_auth():
    from starlette.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    r = client.post("/api/landscapes", json={"topic": "RAG evaluation"})
    assert r.status_code == 401


@dbonly
def test_create_landscape_rejects_offtopic_topic():
    from starlette.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    auth = {"Authorization": f"Bearer {_admin_token()}"}
    for bad in ("gta", "Bonnie Blue", "$$$$"):
        r = client.post("/api/landscapes", json={"topic": bad}, headers=auth)
        assert r.status_code == 422, f"{bad!r} should be rejected"
        assert "detail" in r.json()

    # And no rows leaked for the rejected topics.
    with session_scope() as s:
        assert not s.exec(select(Landscape).where(Landscape.topic == "gta")).all()


@dbonly
def test_login_and_admin_delete_landscape():
    from starlette.testclient import TestClient

    from app.config import get_settings
    from app.users import ensure_seed_users

    from app.main import app

    with session_scope() as s:
        ensure_seed_users(s)
    settings = get_settings()
    client = TestClient(app)

    # Bad password rejected.
    assert client.post(
        "/api/auth/login", json={"email": settings.admin_email, "password": "nope"}
    ).status_code == 401

    # Admin login works and reports admin.
    r = client.post(
        "/api/auth/login",
        json={"email": settings.admin_email, "password": settings.admin_password},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["is_admin"] is True
    admin_auth = {"Authorization": f"Bearer {body['token']}"}

    # Demo user is not an admin and cannot delete.
    demo = client.post(
        "/api/auth/login",
        json={"email": settings.demo_user_email, "password": settings.demo_user_password},
    ).json()
    demo_auth = {"Authorization": f"Bearer {demo['token']}"}

    ls_id = None
    try:
        # Insert directly so the test doesn't depend on Redis/the job queue.
        with session_scope() as s:
            ls = Landscape(topic="RAG evaluation")
            s.add(ls)
            s.flush()
            ls_id = ls.id

        assert client.delete(f"/api/landscapes/{ls_id}", headers=demo_auth).status_code == 403
        assert client.delete(f"/api/landscapes/{ls_id}").status_code == 401

        r = client.delete(f"/api/landscapes/{ls_id}", headers=admin_auth)
        assert r.status_code == 200 and r.json()["deleted"] is True
        with session_scope() as s:
            assert s.get(Landscape, ls_id) is None
        ls_id = None
    finally:
        if ls_id:
            from app.services.landscape_cleanup import delete_landscape_cascade

            with session_scope() as s:
                try:
                    delete_landscape_cascade(s, ls_id)
                except Exception:  # noqa: BLE001
                    pass


@dbonly
def test_cleanup_finds_and_cascade_deletes_offtopic():
    ls_id = None
    try:
        with session_scope() as s:
            ls = Landscape(topic="gta")
            s.add(ls)
            s.flush()
            ls_id = ls.id
            job = SearchJob(landscape_id=ls_id, stage="done", progress=1.0)
            s.add(job)
            s.flush()
            s.add(JobEvent(job_id=job.id, stage="done", message="x", progress=1.0))
            s.add(Cluster(landscape_id=ls_id, name="c", ordinal=0))
            s.add(Quiz(landscape_id=ls_id, question="q", options=["a"], correct_index=0))
            s.add(Flashcard(landscape_id=ls_id, front="f", back="b"))

        with session_scope() as s:
            found = {o.id for o in find_offtopic_landscapes(s)}
            assert ls_id in found

        with session_scope() as s:
            counts = delete_landscape_cascade(s, ls_id)
            assert counts.get("landscapes") == 1
            assert counts.get("search_jobs") == 1
            assert counts.get("job_events") == 1

        with session_scope() as s:
            assert s.get(Landscape, ls_id) is None
            assert not s.exec(select(SearchJob).where(SearchJob.landscape_id == ls_id)).all()
            assert not s.exec(select(Quiz).where(Quiz.landscape_id == ls_id)).all()
        ls_id = None
    finally:
        if ls_id:
            with session_scope() as s:
                try:
                    delete_landscape_cascade(s, ls_id)
                except Exception:  # noqa: BLE001
                    pass
