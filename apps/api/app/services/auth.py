"""Authentication primitives — password hashing + signed session tokens.

Deliberately dependency-free (stdlib only): PBKDF2-HMAC-SHA256 for passwords and
an HMAC-SHA256 signed, base64url-encoded token (itsdangerous-style) for
sessions. This avoids pulling in passlib/bcrypt/pyjwt for what is a small,
single-tenant auth surface whose job is mainly to keep spammers out.

Token format:  ``<base64url(payload_json)>.<base64url(hmac_sig)>``
Payload:       ``{"uid": <user id>, "exp": <unix epoch seconds>}``
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from app.config import get_settings

# PBKDF2 parameters. 240k iterations is a reasonable 2026 default for sha256.
_PBKDF2_ITERATIONS = 240_000
_PBKDF2_ALGO = "sha256"
_SALT_BYTES = 16


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    """Return an encoded ``pbkdf2_sha256$iterations$salt_hex$hash_hex`` string."""
    salt = os.urandom(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(_PBKDF2_ALGO, password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_{_PBKDF2_ALGO}${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, encoded: str | None) -> bool:
    """Constant-time verify ``password`` against an encoded hash."""
    if not encoded:
        return False
    try:
        scheme, iterations_s, salt_hex, hash_hex = encoded.split("$")
        if not scheme.startswith("pbkdf2_"):
            return False
        algo = scheme.split("_", 1)[1]
        iterations = int(iterations_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, IndexError):
        return False
    dk = hashlib.pbkdf2_hmac(algo, password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(dk, expected)


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------
def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload_b64: str, secret: str) -> str:
    sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64encode(sig)


def create_token(user_id: str, *, ttl_hours: int | None = None) -> str:
    """Create a signed session token for ``user_id``."""
    settings = get_settings()
    ttl = settings.auth_token_ttl_hours if ttl_hours is None else ttl_hours
    payload = {"uid": user_id, "exp": int(time.time()) + ttl * 3600}
    payload_b64 = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64, settings.auth_secret)}"


def decode_token(token: str | None) -> str | None:
    """Return the user id from a valid, unexpired token, else ``None``."""
    if not token or "." not in token:
        return None
    payload_b64, sig = token.rsplit(".", 1)
    expected_sig = _sign(payload_b64, get_settings().auth_secret)
    if not hmac.compare_digest(sig, expected_sig):
        return None
    try:
        payload = json.loads(_b64decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    uid = payload.get("uid")
    return uid if isinstance(uid, str) and uid else None
