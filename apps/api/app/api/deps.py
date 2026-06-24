"""FastAPI auth dependencies.

``get_current_user`` reads a Bearer token and resolves the User. When
``settings.require_auth`` is False (tests / local single-user), it transparently
falls back to the default user so unauthenticated calls still work.
"""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from app.config import get_settings
from app.db import get_session
from app.models import User
from app.services.auth import decode_token
from app.users import DEFAULT_USER_ID, ensure_default_user


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def get_current_user(
    authorization: str | None = Header(default=None),
    s: Session = Depends(get_session),
) -> User:
    """Resolve the authenticated user, or 401."""
    settings = get_settings()
    token = _bearer(authorization)
    user_id = decode_token(token) if token else None

    if user_id is None:
        if not settings.require_auth:
            # Local/test mode: behave as the shared default user.
            ensure_default_user(s)
            user = s.get(User, DEFAULT_USER_ID)
            if user is not None:
                return user
        raise HTTPException(401, "authentication required")

    user = s.get(User, user_id)
    if user is None:
        raise HTTPException(401, "user no longer exists")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require the authenticated user to be an admin, else 403."""
    if not user.is_admin:
        raise HTTPException(403, "admin privileges required")
    return user
