"""Embedding/vector helpers.

The pgvector SQLAlchemy adapter materializes ``Vector`` columns as
``numpy.ndarray``. Anywhere we touch an embedding value that *may* have
come from the database, we must avoid ``bool(value)`` / ``if value:`` /
``value or fallback``, since numpy raises::

    ValueError: The truth value of an array with more than one element is
    ambiguous. Use a.any() or a.all()

These helpers centralise the safe checks and the list-normalisation we
use everywhere outside the ranking math.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional


def has_embedding(value: Any) -> bool:
    """True when ``value`` is a non-empty embedding (list, tuple, ndarray)."""
    if value is None:
        return False
    try:
        return len(value) > 0
    except TypeError:
        return False


def to_list(value: Any) -> Optional[list[float]]:
    """Coerce an embedding-like value to ``list[float]`` for storage / JSON.

    Accepts ``None``, lists/tuples, numpy arrays, and any iterable.
    Returns ``None`` for missing/empty values so the database gets NULL
    instead of an empty vector (which pgvector rejects).
    """
    if value is None:
        return None
    if hasattr(value, "tolist"):
        try:
            v = value.tolist()
        except Exception:  # noqa: BLE001
            v = list(value)
    elif isinstance(value, list):
        v = value
    else:
        try:
            v = list(value)
        except TypeError:
            return None
    if not v:
        return None
    return [float(x) for x in v]


def iter_floats(value: Iterable[Any]) -> list[float]:
    """Coerce any iterable to ``list[float]`` (used by the cosine helper)."""
    if value is None:
        return []
    if hasattr(value, "tolist"):
        try:
            v = value.tolist()
        except Exception:  # noqa: BLE001
            v = list(value)
    else:
        v = list(value)
    return [float(x) for x in v]
