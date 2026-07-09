"""Sprint 6 — FSRS scheduler, review loop, and richer question types.

FSRS + generator tests are pure; the review-service tests are DB-backed and
skip cleanly without Postgres.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Flashcard, Landscape, Quiz, ReviewAttempt, ReviewState
from app.services import fsrs
from app.services.fsrs import MemoryState, Rating, schedule
from app.services.quiz_generation import _fallback_quizzes_and_flashcards
from app.services.review import ReviewError, get_queue, get_weak_areas, submit_review


# ---------------------------------------------------------------------------
# FSRS scheduler (pure)
# ---------------------------------------------------------------------------
def test_new_card_good_initialises_state():
    now = datetime(2026, 1, 1)
    out = schedule(MemoryState(), Rating.GOOD, now=now)
    assert out.state.state == "review"
    assert out.interval_days >= 1
    assert out.state.stability is not None and out.state.stability > 0
    assert 1.0 <= out.state.difficulty <= 10.0
    assert out.state.reps == 1 and out.state.lapses == 0
    assert out.state.due == now + timedelta(days=out.interval_days)


def test_better_grade_yields_longer_interval():
    now = datetime(2026, 1, 1)
    hard = schedule(MemoryState(), Rating.HARD, now=now).interval_days
    good = schedule(MemoryState(), Rating.GOOD, now=now).interval_days
    easy = schedule(MemoryState(), Rating.EASY, now=now).interval_days
    assert hard <= good <= easy
    assert easy > hard


def test_again_on_new_card_is_a_lapse():
    out = schedule(MemoryState(), Rating.AGAIN, now=datetime(2026, 1, 1))
    assert out.state.state == "relearning"
    assert out.state.lapses == 1
    assert out.interval_days >= 1


def test_lapse_on_mature_card_shrinks_stability():
    now = datetime(2026, 1, 20)
    mature = MemoryState(
        stability=20.0,
        difficulty=5.0,
        state="review",
        reps=3,
        lapses=0,
        last_review=now - timedelta(days=18),
    )
    lapsed = schedule(mature, Rating.AGAIN, now=now)
    assert lapsed.state.stability < 20.0
    assert lapsed.state.lapses == 1
    assert lapsed.state.state == "relearning"


def test_repeated_good_reviews_grow_the_interval():
    now = datetime(2026, 1, 1)
    mem = MemoryState()
    intervals = []
    for _ in range(4):
        out = schedule(mem, Rating.GOOD, now=now)
        intervals.append(out.interval_days)
        mem = out.state
        now = out.state.due
    # Stability (and therefore the interval) should trend upward as reps grow.
    assert intervals[-1] > intervals[0]
    assert mem.difficulty <= 10.0


def test_difficulty_stays_in_bounds_across_many_again():
    now = datetime(2026, 1, 1)
    mem = MemoryState()
    for _ in range(8):
        out = schedule(mem, Rating.AGAIN, now=now)
        mem = out.state
        now = mem.due
        assert 1.0 <= mem.difficulty <= 10.0


def test_rating_is_correct_maps_grades():
    assert fsrs.rating_is_correct(Rating.AGAIN) is False
    assert fsrs.rating_is_correct(Rating.HARD) is False
    assert fsrs.rating_is_correct(Rating.GOOD) is True
    assert fsrs.rating_is_correct(Rating.EASY) is True


# ---------------------------------------------------------------------------
# Richer question types (pure fallback)
# ---------------------------------------------------------------------------
def test_fallback_emits_explain_flashcards_and_valid_quizzes():
    papers = [
        {
            "paper_id": "p1",
            "title": "Paper One",
            "extraction": {
                "method": "A two-stage retriever.",
                "problem": "Retrieval is noisy.",
                "contribution": "A reusable benchmark.",
                "results": ["+5 points"],
                "limitations": ["small dataset"],
            },
        },
        {
            "paper_id": "p2",
            "title": "Paper Two",
            "extraction": {
                "method": "A reranking model.",
                "contribution": "A new metric.",
            },
        },
    ]
    quizzes, flashcards = _fallback_quizzes_and_flashcards(papers)
    assert any(f["kind"] == "explain" for f in flashcards)
    # The deprecated `compare` flashcard kind was dropped (see quiz_generation);
    # the fallback must no longer emit it.
    assert all(f["kind"] != "compare" for f in flashcards)
    # Every quiz still has a valid correct option index.
    for q in quizzes:
        assert 0 <= q["correct_index"] < len(q["options"])


# ---------------------------------------------------------------------------
# Review service (DB-backed)
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
def test_review_records_attempt_schedules_and_surfaces_queue_and_weak_areas():
    ls_id = None
    try:
        with session_scope() as s:
            ls = Landscape(topic="review loop test")
            s.add(ls)
            s.flush()
            ls_id = ls.id
            s.add(
                Quiz(
                    landscape_id=ls_id,
                    question="Q1?",
                    options=["a", "b"],
                    correct_index=0,
                    concept="retrieval",
                )
            )
            s.add(
                Flashcard(
                    landscape_id=ls_id,
                    front="F1 front",
                    back="F1 back",
                    concept="evaluation",
                    kind="recall",
                )
            )

        with session_scope() as s:
            quiz = s.exec(select(Quiz).where(Quiz.landscape_id == ls_id)).first()
            flash = s.exec(select(Flashcard).where(Flashcard.landscape_id == ls_id)).first()
            quiz_id, flash_id = quiz.id, flash.id

        # Initially everything is new and in the queue.
        with session_scope() as s:
            q = get_queue(s, landscape_id=ls_id, user_id=None)
            assert q["new_count"] == 2 and q["due_count"] == 0
            assert len(q["items"]) == 2

        # A correct (Good) quiz answer schedules it into the future; a wrong
        # (Again) flashcard answer keeps it soon and records a lapse.
        with session_scope() as s:
            good = submit_review(
                s,
                landscape_id=ls_id,
                item_kind="quiz",
                item_id=quiz_id,
                rating=int(Rating.GOOD),
            )
            assert good["interval_days"] >= 1 and good["correct"] is True
            bad = submit_review(
                s,
                landscape_id=ls_id,
                item_kind="flashcard",
                item_id=flash_id,
                rating=int(Rating.AGAIN),
            )
            assert bad["correct"] is False and bad["lapses"] == 1

        with session_scope() as s:
            attempts = s.exec(
                select(ReviewAttempt).where(ReviewAttempt.landscape_id == ls_id)
            ).all()
            assert len(attempts) == 2
            states = s.exec(
                select(ReviewState).where(ReviewState.landscape_id == ls_id)
            ).all()
            assert len(states) == 2

        # The Good quiz is now scheduled out → not due; nothing is new anymore.
        with session_scope() as s:
            q = get_queue(s, landscape_id=ls_id, user_id=None)
            assert q["new_count"] == 0
            kinds_due = {i["item_kind"] for i in q["items"]}
            assert "quiz" not in kinds_due  # scheduled into the future

        # Weak areas: the wrong flashcard's concept has 0% accuracy and sorts first.
        with session_scope() as s:
            weak = get_weak_areas(s, landscape_id=ls_id, user_id=None)
            assert weak[0]["concept"] == "evaluation"
            assert weak[0]["accuracy"] == 0.0

        # Unknown item is rejected.
        with session_scope() as s:
            with pytest.raises(ReviewError):
                submit_review(
                    s,
                    landscape_id=ls_id,
                    item_kind="quiz",
                    item_id="does-not-exist",
                    rating=3,
                )
    finally:
        if ls_id is not None:
            with session_scope() as s:
                for model in (ReviewAttempt, ReviewState, Quiz, Flashcard):
                    for row in s.exec(select(model).where(model.landscape_id == ls_id)).all():
                        s.delete(row)
                ls = s.get(Landscape, ls_id)
                if ls:
                    s.delete(ls)
