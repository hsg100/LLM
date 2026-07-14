"""Phase 2 — curriculum catalogue loading + learner progress/checkpoint APIs.

Covers (docs/PHASE_2_TECHNICAL_DESIGN.md §9, §12): catalogue integrity,
exact-hash 409 skew contract, true PUT idempotency, server-controlled
completion, checkpoint grading + client_attempt_id idempotency, monotonic
score/status under concurrency, user isolation, and the bounded
deadlock-retry wrapper. DB-backed tests skip cleanly without Postgres.
"""
from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import select
from starlette.testclient import TestClient

from app.db import engine, session_scope
from app.models import CheckpointAttempt, LessonProgress, User
from app.services import curriculum_catalog
from app.services.auth import create_token
from app.services.curriculum_catalog import CatalogIntegrityError, get_catalog
from app.services.learning_progress import (
    put_lesson_progress,
    record_checkpoint_attempt,
    run_with_tx_retry,
)


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")

LESSON = "tokens-and-tokenisers"


def _hash() -> str:
    return get_catalog().source_tree_hash


def _answers(lesson: str = LESSON, *, wrong: int = 0) -> dict[str, int]:
    key = dict(get_catalog().grading_for(lesson)["answer_key"])
    for qid in list(key)[:wrong]:
        key[qid] = key[qid] + 1 if key[qid] == 0 else 0
    return key


def _mk_user(s) -> str:
    u = User(email=f"learn-{uuid.uuid4().hex[:10]}@test.local")
    s.add(u)
    s.flush()
    return u.id


@pytest.fixture()
def user_id():
    with session_scope() as s:
        uid = _mk_user(s)
    return uid


# ---------------------------------------------------------------------------
# Catalogue loading + integrity
# ---------------------------------------------------------------------------
def test_committed_catalogue_loads_and_verifies():
    c = get_catalog()
    assert c.curriculum["slug"] == "llm-pathway"
    assert len(c.catalog["lessons"]) >= 4
    assert c.catalog["source_tree_hash"] == c.grading["source_tree_hash"]
    # public catalogue never contains answer keys
    assert "correct_index" not in str(c.catalog)
    assert "answer_key" in str(c.grading)


def test_corrupted_artifact_rejected(tmp_path, monkeypatch):
    import json
    import shutil

    src = curriculum_catalog._candidate_dirs()[-1]
    shutil.copy(src / "catalog.json", tmp_path / "catalog.json")
    shutil.copy(src / "catalog.grading.json", tmp_path / "catalog.grading.json")
    tampered = json.loads((tmp_path / "catalog.json").read_text())
    tampered["curriculum"]["version"] = 99  # hand-edit without rebuilding
    (tmp_path / "catalog.json").write_text(json.dumps(tampered))

    monkeypatch.setattr(curriculum_catalog, "_candidate_dirs", lambda: [tmp_path])
    curriculum_catalog.reset_catalog_cache_for_tests()
    try:
        with pytest.raises(CatalogIntegrityError, match="artifact_hash mismatch"):
            curriculum_catalog.get_catalog()
    finally:
        monkeypatch.undo()
        curriculum_catalog.reset_catalog_cache_for_tests()
        curriculum_catalog.get_catalog()  # restore the cached good catalogue


# ---------------------------------------------------------------------------
# HTTP contracts
# ---------------------------------------------------------------------------
@dbonly
def test_catalogue_info_and_progress_endpoints(user_id):
    from app.main import app

    client = TestClient(app)
    info = client.get("/api/learn/catalogue-info")
    assert info.status_code == 200
    assert info.json()["catalog_hash"] == _hash()

    headers = {"Authorization": f"Bearer {create_token(user_id)}"}
    r = client.get("/api/learn/progress", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["curriculum"] == [] and body["lessons"] == []
    assert body["catalog_hash"] == _hash()


@dbonly
def test_hash_mismatch_is_409_for_both_writes(user_id):
    from app.main import app

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_token(user_id)}"}
    put = client.put(
        f"/api/learn/lessons/{LESSON}/progress",
        json={"lesson_version": 1, "catalog_hash": "stale-hash", "last_block_id": None},
        headers=headers,
    )
    assert put.status_code == 409
    detail = put.json()["detail"]
    assert detail["error"] == "catalogue_version_mismatch"
    assert detail["api_hash"] == _hash() and detail["client_hash"] == "stale-hash"

    post = client.post(
        f"/api/learn/lessons/{LESSON}/checkpoint-attempts",
        json={
            "lesson_version": 1,
            "checkpoint_slug": "tokens-checkpoint",
            "catalog_hash": "stale-hash",
            "responses": _answers(),
            "client_attempt_id": uuid.uuid4().hex,
        },
        headers=headers,
    )
    assert post.status_code == 409
    assert post.json()["detail"]["error"] == "catalogue_version_mismatch"


@dbonly
def test_validation_422s(user_id):
    from app.main import app

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_token(user_id)}"}
    # wrong version (hash matches, so this is a plain 422, not skew)
    r = client.put(
        f"/api/learn/lessons/{LESSON}/progress",
        json={"lesson_version": 99, "catalog_hash": _hash()},
        headers=headers,
    )
    assert r.status_code == 422
    # unknown block
    r = client.put(
        f"/api/learn/lessons/{LESSON}/progress",
        json={"lesson_version": 1, "catalog_hash": _hash(), "last_block_id": "ghost-block"},
        headers=headers,
    )
    assert r.status_code == 422
    # incomplete responses
    answers = _answers()
    answers.pop(next(iter(answers)))
    r = client.post(
        f"/api/learn/lessons/{LESSON}/checkpoint-attempts",
        json={
            "lesson_version": 1,
            "checkpoint_slug": "tokens-checkpoint",
            "catalog_hash": _hash(),
            "responses": answers,
            "client_attempt_id": uuid.uuid4().hex,
        },
        headers=headers,
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# PUT idempotency (true no-op)
# ---------------------------------------------------------------------------
@dbonly
def test_progress_put_is_true_noop_on_identical_input(user_id):
    block = get_catalog().block_ids(LESSON)[0]
    first = put_lesson_progress(
        user_id=user_id, lesson_slug=LESSON, lesson_version=1,
        catalog_hash=_hash(), last_block_id=block,
    )
    assert first["changed"] is True
    second = put_lesson_progress(
        user_id=user_id, lesson_slug=LESSON, lesson_version=1,
        catalog_hash=_hash(), last_block_id=block,
    )
    assert second["changed"] is False
    assert second["progress"] == first["progress"]  # updated_at untouched too

    third = put_lesson_progress(
        user_id=user_id, lesson_slug=LESSON, lesson_version=1,
        catalog_hash=_hash(), last_block_id=get_catalog().block_ids(LESSON)[1],
    )
    assert third["changed"] is True
    assert third["progress"]["updated_at"] > first["progress"]["updated_at"]
    assert third["progress"]["status"] == "in_progress"  # completion not PUT-writable


# ---------------------------------------------------------------------------
# Checkpoints: grading, idempotency, monotonicity
# ---------------------------------------------------------------------------
@dbonly
def test_checkpoint_grades_and_completes(user_id):
    caid = uuid.uuid4().hex
    result = record_checkpoint_attempt(
        user_id=user_id, lesson_slug=LESSON, lesson_version=1,
        checkpoint_slug="tokens-checkpoint", catalog_hash=_hash(),
        responses=_answers(), client_attempt_id=caid,
    )
    assert result["score"] == 1.0 and result["passed"] is True
    assert result["lesson_status"] == "completed"
    assert result["best_checkpoint_score"] == 1.0
    assert result["duplicate"] is False

    # retried client_attempt_id → original result, no second row
    dup = record_checkpoint_attempt(
        user_id=user_id, lesson_slug=LESSON, lesson_version=1,
        checkpoint_slug="tokens-checkpoint", catalog_hash=_hash(),
        responses=_answers(), client_attempt_id=caid,
    )
    assert dup["duplicate"] is True and dup["attempt_id"] == result["attempt_id"]
    with session_scope() as s:
        rows = s.exec(
            select(CheckpointAttempt).where(
                CheckpointAttempt.user_id == user_id,
                CheckpointAttempt.client_attempt_id == caid,
            )
        ).all()
        assert len(rows) == 1

    # a worse later attempt can't lower the best score or revert completion
    worse = record_checkpoint_attempt(
        user_id=user_id, lesson_slug=LESSON, lesson_version=1,
        checkpoint_slug="tokens-checkpoint", catalog_hash=_hash(),
        responses=_answers(wrong=3), client_attempt_id=uuid.uuid4().hex,
    )
    assert worse["passed"] is False
    assert worse["best_checkpoint_score"] == 1.0
    assert worse["lesson_status"] == "completed"


@dbonly
def test_curriculum_completes_after_all_active_lessons(user_id):
    catalog = get_catalog()
    for topic_lessons in catalog.active_topic_lessons().values():
        for lesson in topic_lessons:
            grading = catalog.grading_for(lesson)
            record_checkpoint_attempt(
                user_id=user_id, lesson_slug=lesson,
                lesson_version=catalog.lesson(lesson)["version"],
                checkpoint_slug=grading["checkpoint_slug"], catalog_hash=_hash(),
                responses=dict(grading["answer_key"]), client_attempt_id=uuid.uuid4().hex,
            )
    with session_scope() as s:
        row = s.execute(
            text("SELECT status, completed_at FROM curriculum_progress WHERE user_id = :u"),
            {"u": user_id},
        ).one()
        assert row.status == "completed" and row.completed_at is not None


# ---------------------------------------------------------------------------
# User isolation
# ---------------------------------------------------------------------------
@dbonly
def test_user_isolation(user_id):
    from app.main import app

    with session_scope() as s:
        other_id = _mk_user(s)
    put_lesson_progress(
        user_id=user_id, lesson_slug=LESSON, lesson_version=1,
        catalog_hash=_hash(), last_block_id=get_catalog().block_ids(LESSON)[0],
    )
    client = TestClient(app)
    other = client.get(
        "/api/learn/progress",
        headers={"Authorization": f"Bearer {create_token(other_id)}"},
    )
    assert other.status_code == 200
    assert other.json()["lessons"] == []
    mine = client.get(
        "/api/learn/progress",
        headers={"Authorization": f"Bearer {create_token(user_id)}"},
    )
    assert len(mine.json()["lessons"]) == 1


@dbonly
def test_write_requires_auth_when_enforced(user_id, monkeypatch):
    from app.config import get_settings
    from app.main import app

    monkeypatch.setattr(get_settings(), "require_auth", True)
    client = TestClient(app)
    r = client.put(
        f"/api/learn/lessons/{LESSON}/progress",
        json={"lesson_version": 1, "catalog_hash": _hash()},
    )
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Concurrency (design §9.2 tests a–c)
# ---------------------------------------------------------------------------
@dbonly
def test_concurrent_same_attempt_id_yields_one_row(user_id):
    caid = uuid.uuid4().hex

    def submit(_):
        return record_checkpoint_attempt(
            user_id=user_id, lesson_slug=LESSON, lesson_version=1,
            checkpoint_slug="tokens-checkpoint", catalog_hash=_hash(),
            responses=_answers(), client_attempt_id=caid,
        )

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(submit, range(10)))

    assert len({r["attempt_id"] for r in results}) == 1
    assert {r["score"] for r in results} == {1.0}
    assert sum(1 for r in results if not r["duplicate"]) == 1
    with session_scope() as s:
        rows = s.exec(
            select(CheckpointAttempt).where(
                CheckpointAttempt.user_id == user_id,
                CheckpointAttempt.client_attempt_id == caid,
            )
        ).all()
        assert len(rows) == 1


@dbonly
def test_concurrent_mixed_scores_stay_monotonic(user_id):
    def submit(i):
        return record_checkpoint_attempt(
            user_id=user_id, lesson_slug=LESSON, lesson_version=1,
            checkpoint_slug="tokens-checkpoint", catalog_hash=_hash(),
            responses=_answers(wrong=i % 4), client_attempt_id=uuid.uuid4().hex,
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(submit, range(16)))

    with session_scope() as s:
        row = s.exec(
            select(LessonProgress).where(
                LessonProgress.user_id == user_id,
                LessonProgress.lesson_slug == LESSON,
            )
        ).one()
        assert row.best_checkpoint_score == 1.0
        assert row.status == "completed" and row.completed_at is not None


# ---------------------------------------------------------------------------
# Deadlock/serialization retry (final-approval condition 3)
# ---------------------------------------------------------------------------
class _FakeDeadlock:
    sqlstate = "40P01"


def _deadlock_error() -> DBAPIError:
    return DBAPIError("stmt", {}, _FakeDeadlock())  # type: ignore[arg-type]


@dbonly
def test_tx_retry_recovers_from_deadlock():
    calls = {"n": 0}

    def flaky(session):
        calls["n"] += 1
        if calls["n"] == 1:
            raise _deadlock_error()
        return "ok"

    assert run_with_tx_retry(flaky) == "ok"
    assert calls["n"] == 2


@dbonly
def test_tx_retry_bound_is_enforced():
    calls = {"n": 0}

    def always_deadlocks(session):
        calls["n"] += 1
        raise _deadlock_error()

    with pytest.raises(DBAPIError):
        run_with_tx_retry(always_deadlocks, retries=2)
    assert calls["n"] == 3  # initial + 2 retries


@dbonly
def test_non_retryable_dbapi_error_not_retried():
    class _FakeOther:
        sqlstate = "23505"

    calls = {"n": 0}

    def fails(session):
        calls["n"] += 1
        raise DBAPIError("stmt", {}, _FakeOther())  # type: ignore[arg-type]

    with pytest.raises(DBAPIError):
        run_with_tx_retry(fails)
    assert calls["n"] == 1


# ---------------------------------------------------------------------------
# /ready reports the catalogue
# ---------------------------------------------------------------------------
@dbonly
def test_ready_reports_curriculum():
    from app.main import app

    client = TestClient(app)
    body = client.get("/ready").json()
    assert body["curriculum"] == "ok"
    assert body["curriculum_hash"] == _hash()
    assert body["curriculum_version"] == get_catalog().curriculum["version"]
