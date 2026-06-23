"""Active-recall review loop: record attempts, schedule with FSRS, surface a
daily queue and weak areas.

Single-user for the recovery milestone, but everything is keyed by ``user_id``
so multi-user is additive later.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session, select

from app.models import Flashcard, Quiz, ReviewAttempt, ReviewState
from app.services import fsrs

ITEM_KINDS = ("quiz", "flashcard")


class ReviewError(ValueError):
    """Raised when a review targets a missing/foreign item."""


def _load_item(s: Session, landscape_id: str, item_kind: str, item_id: str):
    if item_kind == "quiz":
        item = s.get(Quiz, item_id)
    elif item_kind == "flashcard":
        item = s.get(Flashcard, item_id)
    else:
        raise ReviewError(f"unknown item_kind '{item_kind}'")
    if item is None or item.landscape_id != landscape_id:
        raise ReviewError("item not found in this landscape")
    return item


def submit_review(
    s: Session,
    *,
    landscape_id: str,
    item_kind: str,
    item_id: str,
    rating: int,
    correct: Optional[bool] = None,
    user_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Record an attempt and advance the item's FSRS schedule."""
    now = now or datetime.utcnow()
    grade = fsrs.Rating(int(rating))  # raises ValueError on out-of-range
    _load_item(s, landscape_id, item_kind, item_id)

    if correct is None:
        correct = fsrs.rating_is_correct(grade)

    s.add(
        ReviewAttempt(
            user_id=user_id,
            landscape_id=landscape_id,
            item_kind=item_kind,
            item_id=item_id,
            correct=correct,
            rating=int(grade),
        )
    )

    state = s.exec(
        select(ReviewState).where(
            ReviewState.user_id == user_id,
            ReviewState.item_kind == item_kind,
            ReviewState.item_id == item_id,
        )
    ).first()
    if state is None:
        state = ReviewState(
            user_id=user_id,
            landscape_id=landscape_id,
            item_kind=item_kind,
            item_id=item_id,
        )

    mem = fsrs.MemoryState(
        stability=state.stability,
        difficulty=state.difficulty,
        state=state.state,
        reps=state.reps,
        lapses=state.lapses,
        last_review=state.last_review,
        due=state.due,
    )
    result = fsrs.schedule(mem, grade, now=now)
    new = result.state
    state.stability = new.stability
    state.difficulty = new.difficulty
    state.state = new.state
    state.reps = new.reps
    state.lapses = new.lapses
    state.last_review = new.last_review
    state.due = new.due
    s.add(state)

    return {
        "item_kind": item_kind,
        "item_id": item_id,
        "rating": int(grade),
        "correct": correct,
        "interval_days": result.interval_days,
        "due": new.due,
        "state": new.state,
        "reps": new.reps,
        "lapses": new.lapses,
        "stability": round(new.stability, 4) if new.stability is not None else None,
        "difficulty": round(new.difficulty, 4) if new.difficulty is not None else None,
    }


def _quiz_payload(q: Quiz) -> dict[str, Any]:
    return {
        "id": q.id,
        "question": q.question,
        "options": q.options,
        "correct_index": q.correct_index,
        "explanation": q.explanation,
        "paper_id": q.paper_id,
        "concept": q.concept,
        "difficulty": q.difficulty,
    }


def _flashcard_payload(f: Flashcard) -> dict[str, Any]:
    return {
        "id": f.id,
        "front": f.front,
        "back": f.back,
        "paper_id": f.paper_id,
        "concept": f.concept,
        "kind": f.kind,
    }


def get_queue(
    s: Session,
    *,
    landscape_id: str,
    user_id: Optional[str] = None,
    now: Optional[datetime] = None,
    limit: int = 40,
) -> dict[str, Any]:
    """Daily review queue: due (overdue first) then unseen items."""
    now = now or datetime.utcnow()
    quizzes = s.exec(select(Quiz).where(Quiz.landscape_id == landscape_id)).all()
    flashcards = s.exec(select(Flashcard).where(Flashcard.landscape_id == landscape_id)).all()

    states = {
        (st.item_kind, st.item_id): st
        for st in s.exec(
            select(ReviewState).where(
                ReviewState.landscape_id == landscape_id,
                ReviewState.user_id == user_id,
            )
        ).all()
    }

    due: list[dict[str, Any]] = []
    new: list[dict[str, Any]] = []
    for kind, item, payload in (
        *(("quiz", q, _quiz_payload(q)) for q in quizzes),
        *(("flashcard", f, _flashcard_payload(f)) for f in flashcards),
    ):
        st = states.get((kind, item.id))
        entry = {
            "item_kind": kind,
            "item_id": item.id,
            "due": st.due if st else None,
            "state": st.state if st else "new",
            "reps": st.reps if st else 0,
            "lapses": st.lapses if st else 0,
            kind: payload,
        }
        if st is None or st.due is None:
            new.append(entry)
        elif st.due <= now:
            due.append(entry)

    due.sort(key=lambda e: e["due"])
    items = (due + new)[:limit]
    return {
        "now": now,
        "due_count": len(due),
        "new_count": len(new),
        "items": items,
    }


def get_weak_areas(
    s: Session,
    *,
    landscape_id: str,
    user_id: Optional[str] = None,
    min_attempts: int = 1,
) -> list[dict[str, Any]]:
    """Accuracy per concept (lowest first) from recorded attempts."""
    attempts = s.exec(
        select(ReviewAttempt).where(
            ReviewAttempt.landscape_id == landscape_id,
            ReviewAttempt.user_id == user_id,
        )
    ).all()
    if not attempts:
        return []

    concept_by_item: dict[tuple[str, str], Optional[str]] = {}
    quiz_ids = {a.item_id for a in attempts if a.item_kind == "quiz"}
    flash_ids = {a.item_id for a in attempts if a.item_kind == "flashcard"}
    if quiz_ids:
        for q in s.exec(select(Quiz).where(Quiz.id.in_(quiz_ids))).all():
            concept_by_item[("quiz", q.id)] = q.concept
    if flash_ids:
        for f in s.exec(select(Flashcard).where(Flashcard.id.in_(flash_ids))).all():
            concept_by_item[("flashcard", f.id)] = f.concept

    agg: dict[str, dict[str, int]] = {}
    for a in attempts:
        concept = concept_by_item.get((a.item_kind, a.item_id)) or "Uncategorised"
        bucket = agg.setdefault(concept, {"total": 0, "correct": 0})
        bucket["total"] += 1
        if a.correct:
            bucket["correct"] += 1

    rows = [
        {
            "concept": concept,
            "attempts": v["total"],
            "correct": v["correct"],
            "accuracy": round(v["correct"] / v["total"], 3),
        }
        for concept, v in agg.items()
        if v["total"] >= min_attempts
    ]
    rows.sort(key=lambda r: (r["accuracy"], -r["attempts"]))
    return rows
