"""Learner progress + checkpoint grading (design §9).

Semantics implemented here, tested in tests/test_learning_progress.py:

- Exact catalogue-hash match on every write; any mismatch is a 409
  catalogue_version_mismatch (final-approval condition 1).
- Progress PUT is a true no-op on identical input: no DB write, updated_at
  untouched, identical response. Completion is never client-writable.
- Checkpoint POST is idempotent by (user_id, client_attempt_id): the insert
  uses ON CONFLICT DO NOTHING and a race or retry returns the original
  attempt's result instead of erroring.
- Lesson/curriculum progress updates are single atomic upserts with
  monotonic expressions (GREATEST / CASE / COALESCE), in fixed lesson →
  curriculum order.
- The write transaction is wrapped in a bounded jittered retry for
  PostgreSQL deadlock (40P01) and serialization (40001) failures
  (final-approval condition 3).
"""

from __future__ import annotations

import random
import time
from datetime import datetime
from typing import Any, Callable, Optional, TypeVar

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, select

from app.db import engine
from app.models import CheckpointAttempt, CurriculumProgress, LessonProgress, _now, _uuid
from app.services.curriculum_catalog import Catalog, get_catalog

T = TypeVar("T")

RETRYABLE_SQLSTATES = {"40P01", "40001"}  # deadlock_detected, serialization_failure
MAX_TX_RETRIES = 3


class CatalogueMismatch(Exception):
    def __init__(self, client_hash: str):
        self.client_hash = client_hash
        self.api_hash = get_catalog().source_tree_hash
        super().__init__("catalogue_version_mismatch")


class LearnValidationError(Exception):
    """Maps to 422 — malformed regardless of catalogue skew."""


def _sqlstate(e: BaseException) -> Optional[str]:
    orig = getattr(e, "orig", None)
    return getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)


def run_with_tx_retry(fn: Callable[[Session], T], *, retries: int = MAX_TX_RETRIES) -> T:
    """Run fn inside its own committed session; retry deadlock/serialization
    failures with small jittered backoff. Raises the last error when the
    bound is exhausted (routes translate it to a retryable 503)."""
    attempt = 0
    while True:
        session = Session(engine)
        try:
            result = fn(session)
            session.commit()
            return result
        except DBAPIError as e:
            session.rollback()
            state = _sqlstate(e)
            if state in RETRYABLE_SQLSTATES and attempt < retries:
                attempt += 1
                time.sleep((0.05 * (2 ** (attempt - 1))) + random.uniform(0, 0.05))
                continue
            raise
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


# ---------------------------------------------------------------------------
# Validation against the catalogue
# ---------------------------------------------------------------------------
def _require_hash(catalog: Catalog, client_hash: str) -> None:
    if client_hash != catalog.source_tree_hash:
        raise CatalogueMismatch(client_hash)


def _require_lesson(catalog: Catalog, lesson_slug: str, lesson_version: int) -> dict[str, Any]:
    lesson = catalog.lesson(lesson_slug)
    if lesson is None:
        raise LearnValidationError(f"unknown lesson {lesson_slug!r}")
    if lesson["version"] != lesson_version:
        raise LearnValidationError(
            f"lesson {lesson_slug!r} version {lesson_version} is not the deployed "
            f"version ({lesson['version']})"
        )
    return lesson


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def get_learn_progress(s: Session, *, user_id: str) -> dict[str, Any]:
    catalog = get_catalog()
    curriculum_rows = s.exec(
        select(CurriculumProgress).where(CurriculumProgress.user_id == user_id)
    ).all()
    lesson_rows = s.exec(
        select(LessonProgress).where(LessonProgress.user_id == user_id)
    ).all()
    attempts = s.exec(
        select(CheckpointAttempt)
        .where(CheckpointAttempt.user_id == user_id)
        .order_by(CheckpointAttempt.created_at.desc())  # type: ignore[attr-defined]
        .limit(20)
    ).all()
    return {
        "curriculum_slug": catalog.curriculum["slug"],
        "curriculum_version": catalog.curriculum["version"],
        "catalog_hash": catalog.source_tree_hash,
        "curriculum": [r.model_dump() for r in curriculum_rows],
        "lessons": [r.model_dump() for r in lesson_rows],
        "recent_attempts": [r.model_dump() for r in attempts],
    }


# ---------------------------------------------------------------------------
# Lesson progress PUT (idempotent no-op on identical input)
# ---------------------------------------------------------------------------
def put_lesson_progress(
    *,
    user_id: str,
    lesson_slug: str,
    lesson_version: int,
    catalog_hash: str,
    last_block_id: Optional[str],
) -> dict[str, Any]:
    catalog = get_catalog()
    _require_hash(catalog, catalog_hash)
    lesson = _require_lesson(catalog, lesson_slug, lesson_version)
    if last_block_id is not None and last_block_id not in catalog.block_ids(lesson_slug):
        raise LearnValidationError(
            f"unknown block {last_block_id!r} for lesson {lesson_slug!r}"
        )

    def tx(s: Session) -> dict[str, Any]:
        row = s.exec(
            select(LessonProgress).where(
                LessonProgress.user_id == user_id,
                LessonProgress.lesson_slug == lesson_slug,
                LessonProgress.lesson_version == lesson_version,
            )
        ).first()
        if row is not None and (last_block_id is None or row.last_block_id == last_block_id):
            return {"changed": False, "progress": row.model_dump()}  # true no-op

        now = _now()
        # Insert-or-update via ON CONFLICT so a concurrent first-write race
        # cannot 500; the update only moves the resume position — status,
        # completion and scores are checkpoint-owned and untouched here.
        s.execute(
            text(
                """
                INSERT INTO lesson_progress
                    (id, user_id, lesson_slug, lesson_version, status,
                     last_block_id, best_checkpoint_score, started_at,
                     completed_at, updated_at)
                VALUES (:id, :user_id, :slug, :version, 'in_progress',
                        :block, NULL, :now, NULL, :now)
                ON CONFLICT ON CONSTRAINT uq_lesson_progress DO UPDATE SET
                    last_block_id = COALESCE(EXCLUDED.last_block_id, lesson_progress.last_block_id),
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "id": _uuid(),
                "user_id": user_id,
                "slug": lesson_slug,
                "version": lesson_version,
                "block": last_block_id,
                "now": now,
            },
        )
        _upsert_curriculum_row(
            s, catalog=catalog, user_id=user_id, touched_lesson=lesson, now=now
        )
        # The upsert ran as raw SQL, so expire the identity map before
        # re-reading or the pre-update object would be returned unchanged.
        s.expire_all()
        row = s.exec(
            select(LessonProgress).where(
                LessonProgress.user_id == user_id,
                LessonProgress.lesson_slug == lesson_slug,
                LessonProgress.lesson_version == lesson_version,
            )
        ).one()
        return {"changed": True, "progress": row.model_dump()}

    return run_with_tx_retry(tx)


# ---------------------------------------------------------------------------
# Checkpoint attempts (idempotent by client_attempt_id; graded server-side)
# ---------------------------------------------------------------------------
def record_checkpoint_attempt(
    *,
    user_id: str,
    lesson_slug: str,
    lesson_version: int,
    checkpoint_slug: str,
    catalog_hash: str,
    responses: dict[str, int],
    client_attempt_id: str,
) -> dict[str, Any]:
    catalog = get_catalog()
    _require_hash(catalog, catalog_hash)
    lesson = _require_lesson(catalog, lesson_slug, lesson_version)
    grading = catalog.grading_for(lesson_slug)
    if grading is None or grading["checkpoint_slug"] != checkpoint_slug:
        raise LearnValidationError(
            f"unknown checkpoint {checkpoint_slug!r} for lesson {lesson_slug!r}"
        )
    if not client_attempt_id or len(client_attempt_id) > 128:
        raise LearnValidationError("client_attempt_id is required (max 128 chars)")

    answer_key: dict[str, int] = grading["answer_key"]
    unknown = set(responses) - set(answer_key)
    missing = set(answer_key) - set(responses)
    if unknown:
        raise LearnValidationError(f"unknown question ids: {sorted(unknown)}")
    if missing:
        raise LearnValidationError(f"missing answers for questions: {sorted(missing)}")

    per_question = {
        qid: {"answer": responses[qid], "correct": responses[qid] == answer_key[qid]}
        for qid in answer_key
    }
    score = sum(1 for v in per_question.values() if v["correct"]) / len(answer_key)
    passed = score >= grading["pass_score"]

    def tx(s: Session) -> dict[str, Any]:
        now = _now()
        inserted = s.execute(
            text(
                """
                INSERT INTO checkpoint_attempts
                    (id, user_id, lesson_slug, lesson_version, checkpoint_slug,
                     score, passed, responses, client_attempt_id, created_at)
                VALUES (:id, :user_id, :slug, :version, :cp,
                        :score, :passed, :responses, :caid, :now)
                ON CONFLICT ON CONSTRAINT uq_checkpoint_attempt_client DO NOTHING
                RETURNING id
                """
            ),
            {
                "id": _uuid(),
                "user_id": user_id,
                "slug": lesson_slug,
                "version": lesson_version,
                "cp": checkpoint_slug,
                "score": score,
                "passed": passed,
                "responses": _json(per_question),
                "caid": client_attempt_id,
                "now": now,
            },
        ).first()

        if inserted is None:
            # A previous request (or a concurrent one that won the race) owns
            # this client_attempt_id: return its original result unchanged.
            original = s.exec(
                select(CheckpointAttempt).where(
                    CheckpointAttempt.user_id == user_id,
                    CheckpointAttempt.client_attempt_id == client_attempt_id,
                )
            ).one()
            row = s.exec(
                select(LessonProgress).where(
                    LessonProgress.user_id == user_id,
                    LessonProgress.lesson_slug == original.lesson_slug,
                    LessonProgress.lesson_version == original.lesson_version,
                )
            ).first()
            return _checkpoint_result(original, row, duplicate=True)

        # Lesson progress first, curriculum second — fixed order (design §9.2).
        s.execute(
            text(
                """
                INSERT INTO lesson_progress
                    (id, user_id, lesson_slug, lesson_version, status,
                     last_block_id, best_checkpoint_score, started_at,
                     completed_at, updated_at)
                VALUES (:id, :user_id, :slug, :version,
                        CASE WHEN :passed THEN 'completed' ELSE 'in_progress' END,
                        NULL, :score, :now,
                        CASE WHEN :passed THEN :now END, :now)
                ON CONFLICT ON CONSTRAINT uq_lesson_progress DO UPDATE SET
                    best_checkpoint_score = GREATEST(
                        COALESCE(lesson_progress.best_checkpoint_score, 0), EXCLUDED.best_checkpoint_score),
                    status = CASE
                        WHEN lesson_progress.status = 'completed' OR :passed THEN 'completed'
                        ELSE lesson_progress.status END,
                    completed_at = COALESCE(
                        lesson_progress.completed_at, CASE WHEN :passed THEN :now END),
                    updated_at = :now
                """
            ),
            {
                "id": _uuid(),
                "user_id": user_id,
                "slug": lesson_slug,
                "version": lesson_version,
                "passed": passed,
                "score": score,
                "now": now,
            },
        )
        _upsert_curriculum_row(s, catalog=catalog, user_id=user_id, touched_lesson=lesson, now=now)

        s.expire_all()  # raw-SQL writes above bypass the ORM identity map
        attempt = s.exec(
            select(CheckpointAttempt).where(
                CheckpointAttempt.user_id == user_id,
                CheckpointAttempt.client_attempt_id == client_attempt_id,
            )
        ).one()
        row = s.exec(
            select(LessonProgress).where(
                LessonProgress.user_id == user_id,
                LessonProgress.lesson_slug == lesson_slug,
                LessonProgress.lesson_version == lesson_version,
            )
        ).one()
        return _checkpoint_result(attempt, row, duplicate=False)

    return run_with_tx_retry(tx)


def _checkpoint_result(
    attempt: CheckpointAttempt, progress: Optional[LessonProgress], *, duplicate: bool
) -> dict[str, Any]:
    return {
        "duplicate": duplicate,
        "score": attempt.score,
        "passed": attempt.passed,
        "per_question": attempt.responses or {},
        "best_checkpoint_score": progress.best_checkpoint_score if progress else None,
        "lesson_status": progress.status if progress else None,
        "attempt_id": attempt.id,
        "created_at": attempt.created_at,
    }


def _json(data: Any) -> str:
    import json

    return json.dumps(data)


def _upsert_curriculum_row(
    s: Session, *, catalog: Catalog, user_id: str, touched_lesson: dict[str, Any], now: datetime
) -> None:
    """Server-maintained curriculum progress (no client write surface)."""
    cur = catalog.curriculum
    s.execute(
        text(
            """
            INSERT INTO curriculum_progress
                (id, user_id, curriculum_slug, curriculum_version, status,
                 current_topic_slug, started_at, completed_at, updated_at)
            VALUES (:id, :user_id, :slug, :version, 'active', :topic, :now, NULL, :now)
            ON CONFLICT ON CONSTRAINT uq_curriculum_progress DO UPDATE SET
                current_topic_slug = EXCLUDED.current_topic_slug,
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "id": _uuid(),
            "user_id": user_id,
            "slug": cur["slug"],
            "version": cur["version"],
            "topic": touched_lesson["topic"],
            "now": now,
        },
    )
    # Completion: every lesson of every active topic completed at its
    # deployed version. Computed inside the same transaction; the update is
    # monotonic (never reverts completed → active by itself, matching the
    # additive Phase 2 semantics).
    required: list[tuple[str, int]] = []
    for _topic, lesson_slugs in catalog.active_topic_lessons().items():
        for slug in lesson_slugs:
            required.append((slug, catalog.lesson(slug)["version"]))
    if required:
        done = {
            (r.lesson_slug, r.lesson_version)
            for r in s.exec(
                select(LessonProgress).where(
                    LessonProgress.user_id == user_id,
                    LessonProgress.status == "completed",
                )
            ).all()
        }
        if all(key in done for key in required):
            s.execute(
                text(
                    """
                    UPDATE curriculum_progress
                    SET status = 'completed',
                        completed_at = COALESCE(completed_at, :now),
                        updated_at = :now
                    WHERE user_id = :user_id AND curriculum_slug = :slug
                      AND curriculum_version = :version AND status <> 'completed'
                    """
                ),
                {"now": now, "user_id": user_id, "slug": cur["slug"], "version": cur["version"]},
            )
