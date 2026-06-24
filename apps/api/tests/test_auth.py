"""Unit tests for password hashing + signed session tokens (no DB)."""
from __future__ import annotations

import time

from app.services.auth import (
    create_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_roundtrip():
    h = hash_password("correct horse battery staple")
    assert h.startswith("pbkdf2_sha256$")
    assert verify_password("correct horse battery staple", h)
    assert not verify_password("wrong", h)
    assert not verify_password("", h)


def test_password_salts_differ():
    assert hash_password("same") != hash_password("same")


def test_verify_handles_garbage():
    assert not verify_password("x", None)
    assert not verify_password("x", "")
    assert not verify_password("x", "not-a-real-hash")


def test_token_roundtrip():
    token = create_token("user-123")
    assert decode_token(token) == "user-123"


def test_token_rejects_tampering():
    token = create_token("user-123")
    payload, sig = token.rsplit(".", 1)
    assert decode_token(payload + "." + sig[:-1] + ("A" if sig[-1] != "A" else "B")) is None
    assert decode_token("garbage") is None
    assert decode_token("") is None
    assert decode_token(None) is None


def test_token_expiry():
    token = create_token("user-123", ttl_hours=0)
    # exp == now; allow the clock to advance one second.
    time.sleep(1.1)
    assert decode_token(token) is None
