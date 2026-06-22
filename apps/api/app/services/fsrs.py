"""FSRS-4.5 spaced-repetition scheduler (pure Python, no external deps).

Implements the Free Spaced Repetition Scheduler (FSRS) v4.5 memory model.
Each item carries a memory state — stability ``S`` (days until retrievability
falls to the target retention) and difficulty ``D`` in ``[1, 10]``. A review
with a grade in {Again, Hard, Good, Easy} updates that state and yields the
next interval for a target retention (default 0.9).

Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki

The weights are the published v4.5 defaults; they are overridable but the
scheduler is deterministic and monotonic regardless of the exact values
(better grades ⇒ longer intervals; lapses shrink stability).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import IntEnum
from typing import Optional, Sequence


class Rating(IntEnum):
    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4


# Card lifecycle states.
NEW = "new"
REVIEW = "review"
RELEARNING = "relearning"

# Published FSRS-4.5 default parameters (w0..w16).
DEFAULT_PARAMETERS: tuple[float, ...] = (
    0.4197, 1.1869, 3.0412, 15.2441, 7.1434, 0.6477, 1.0007, 0.0674,
    1.6597, 0.1712, 1.1178, 2.0225, 0.0904, 0.3025, 2.1214, 0.2498, 2.9466,
)

# Forgetting curve constants (FSRS-4.5): R(t) = (1 + FACTOR * t / S) ** DECAY.
DECAY = -0.5
FACTOR = 19.0 / 81.0  # == 0.9 ** (1 / DECAY) - 1

DEFAULT_REQUEST_RETENTION = 0.9
MAXIMUM_INTERVAL = 36500  # 100 years, in days


@dataclass
class MemoryState:
    """Per-item scheduling state. ``None`` stability/difficulty == never reviewed."""

    stability: Optional[float] = None
    difficulty: Optional[float] = None
    state: str = NEW
    reps: int = 0
    lapses: int = 0
    last_review: Optional[datetime] = None
    due: Optional[datetime] = None


@dataclass
class Scheduled:
    state: MemoryState
    interval_days: int


def retrievability(elapsed_days: float, stability: float) -> float:
    """Probability of recall after ``elapsed_days`` given ``stability``."""
    if stability <= 0:
        return 0.0
    return (1.0 + FACTOR * max(0.0, elapsed_days) / stability) ** DECAY


def interval_for_stability(
    stability: float,
    request_retention: float = DEFAULT_REQUEST_RETENTION,
    maximum_interval: int = MAXIMUM_INTERVAL,
) -> int:
    """Days until retrievability decays to ``request_retention`` (≥ 1 day)."""
    ivl = (stability / FACTOR) * (request_retention ** (1.0 / DECAY) - 1.0)
    return max(1, min(round(ivl), maximum_interval))


def _clamp_difficulty(d: float) -> float:
    return min(10.0, max(1.0, d))


def _init_stability(w: Sequence[float], rating: Rating) -> float:
    return max(0.1, w[rating - 1])


def _init_difficulty(w: Sequence[float], rating: Rating) -> float:
    return _clamp_difficulty(w[4] - math.exp(w[5] * (rating - 1)) + 1.0)


def _next_difficulty(w: Sequence[float], d: float, rating: Rating) -> float:
    delta = -w[6] * (rating - 3)
    damped = d + delta * (10.0 - d) / 9.0  # linear damping near the bounds
    # Mean-reversion toward the difficulty an "Easy" first answer would set.
    reverted = w[7] * _init_difficulty(w, Rating.EASY) + (1.0 - w[7]) * damped
    return _clamp_difficulty(reverted)


def _next_stability_recall(
    w: Sequence[float], d: float, s: float, r: float, rating: Rating
) -> float:
    hard_penalty = w[15] if rating == Rating.HARD else 1.0
    easy_bonus = w[16] if rating == Rating.EASY else 1.0
    growth = (
        math.exp(w[8])
        * (11.0 - d)
        * (s ** -w[9])
        * (math.exp(w[10] * (1.0 - r)) - 1.0)
        * hard_penalty
        * easy_bonus
    )
    return s * (1.0 + growth)


def _next_stability_forget(w: Sequence[float], d: float, s: float, r: float) -> float:
    return (
        w[11]
        * (d ** -w[12])
        * (((s + 1.0) ** w[13]) - 1.0)
        * math.exp(w[14] * (1.0 - r))
    )


def schedule(
    mem: MemoryState,
    rating: int,
    *,
    now: Optional[datetime] = None,
    parameters: Sequence[float] = DEFAULT_PARAMETERS,
    request_retention: float = DEFAULT_REQUEST_RETENTION,
    maximum_interval: int = MAXIMUM_INTERVAL,
) -> Scheduled:
    """Apply one review and return the updated state + next interval (days)."""
    w = parameters
    now = now or datetime.utcnow()
    grade = Rating(int(rating))

    first_review = mem.stability is None or mem.difficulty is None or mem.state == NEW
    if first_review:
        stability = _init_stability(w, grade)
        difficulty = _init_difficulty(w, grade)
        reps = 1
        lapses = 1 if grade == Rating.AGAIN else 0
        state = RELEARNING if grade == Rating.AGAIN else REVIEW
    else:
        elapsed = 0.0
        if mem.last_review is not None:
            elapsed = max(0.0, (now - mem.last_review).total_seconds() / 86400.0)
        r = retrievability(elapsed, mem.stability)  # type: ignore[arg-type]
        difficulty = _next_difficulty(w, mem.difficulty, grade)  # type: ignore[arg-type]
        if grade == Rating.AGAIN:
            forgot = _next_stability_forget(w, mem.difficulty, mem.stability, r)  # type: ignore[arg-type]
            # A lapse must never increase stability.
            stability = min(forgot, mem.stability)  # type: ignore[arg-type]
            lapses = mem.lapses + 1
            state = RELEARNING
        else:
            stability = _next_stability_recall(w, mem.difficulty, mem.stability, r, grade)  # type: ignore[arg-type]
            lapses = mem.lapses
            state = REVIEW
        reps = mem.reps + 1

    stability = max(0.1, stability)
    interval = interval_for_stability(stability, request_retention, maximum_interval)
    due = now + timedelta(days=interval)
    return Scheduled(
        state=MemoryState(
            stability=stability,
            difficulty=difficulty,
            state=state,
            reps=reps,
            lapses=lapses,
            last_review=now,
            due=due,
        ),
        interval_days=interval,
    )


def rating_is_correct(rating: int) -> bool:
    """Map a 4-point grade to a binary correct/incorrect for accuracy stats."""
    return Rating(int(rating)) >= Rating.GOOD
