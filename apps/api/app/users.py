"""Single-user plumbing.

The recovery milestone runs single-user (no login), but ``user_id`` is threaded
through models and queries so multi-user becomes additive later. Everything is
owned by one fixed default user; routes stamp new landscapes with
``DEFAULT_USER_ID`` and scope list queries to it.
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.models import User

# Stable, well-known id so seeding is idempotent across rebuilds.
DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_USER_EMAIL = "local@fieldmap.local"
DEFAULT_USER_NAME = "Local User"


def ensure_default_user(session: Session) -> str:
    """Create the default user if missing; return its id. Idempotent."""
    existing = session.get(User, DEFAULT_USER_ID)
    if existing is None:
        # Guard against a pre-existing row with the same email but a different id.
        by_email = session.exec(select(User).where(User.email == DEFAULT_USER_EMAIL)).first()
        if by_email is not None:
            return by_email.id
        session.add(
            User(id=DEFAULT_USER_ID, email=DEFAULT_USER_EMAIL, name=DEFAULT_USER_NAME)
        )
        session.flush()
    return DEFAULT_USER_ID
