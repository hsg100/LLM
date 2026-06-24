"""User plumbing — default single-user row + seeded login accounts.

Landscape *data* stays a single shared library owned by ``DEFAULT_USER_ID`` (the
list/scope queries are unchanged). Authentication is layered on top purely as a
spam gate: real login accounts (admin + demo) are seeded so the UI can require a
login before entry, and the admin can delete landscapes.
"""

from __future__ import annotations

import logging

from sqlmodel import Session, select

from app.config import get_settings
from app.models import User
from app.services.auth import hash_password

logger = logging.getLogger("fieldmap.users")

# Stable, well-known id so seeding is idempotent across rebuilds.
DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_USER_EMAIL = "local@fieldmap.local"
DEFAULT_USER_NAME = "Local User"

# Well-known ids for the seeded login accounts.
ADMIN_USER_ID = "00000000-0000-0000-0000-0000000000a1"
DEMO_USER_ID = "00000000-0000-0000-0000-0000000000d1"


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


def _ensure_account(
    session: Session,
    *,
    user_id: str,
    email: str,
    name: str,
    password: str,
    is_admin: bool,
) -> None:
    """Create the account if missing, or repair role/password on an existing one.

    Idempotent: re-runs keep the seeded password (from settings/.env) and the
    admin flag in sync, so rotating ADMIN_PASSWORD in the environment and
    restarting actually updates the credential.
    """
    email_l = email.strip().lower()
    row = session.get(User, user_id) or session.exec(
        select(User).where(User.email == email_l)
    ).first()
    if row is None:
        session.add(
            User(
                id=user_id,
                email=email_l,
                name=name,
                password_hash=hash_password(password),
                is_admin=is_admin,
            )
        )
        session.flush()
        logger.info("seeded account %s (admin=%s)", email_l, is_admin)
        return
    # Keep an existing account aligned with configured credentials/role.
    row.password_hash = hash_password(password)
    row.is_admin = is_admin
    if not row.name:
        row.name = name
    session.add(row)
    session.flush()


def ensure_seed_users(session: Session) -> None:
    """Seed the admin + demo login accounts from settings. Idempotent."""
    s = get_settings()
    _ensure_account(
        session,
        user_id=ADMIN_USER_ID,
        email=s.admin_email,
        name=s.admin_name,
        password=s.admin_password,
        is_admin=True,
    )
    _ensure_account(
        session,
        user_id=DEMO_USER_ID,
        email=s.demo_user_email,
        name=s.demo_user_name,
        password=s.demo_user_password,
        is_admin=False,
    )
