"""Regression: /ready surfaces schema/migration state so drift is not invisible.

A live DB with no ``alembic_version`` (or one behind head) previously stayed
green on /ready while endpoints 500'd on missing columns. app.db now exposes
the applied-vs-head comparison and a startup status that /ready reports (503 on
drift). These checks are DB-free: they exercise the status plumbing and that the
real migration chain parses to a single resolvable head.
"""
from __future__ import annotations

from app.db import (
    alembic_current_and_head,  # noqa: F401 — imported to assert it's wired
    get_migration_status,
    set_migration_status,
)


def test_migration_status_roundtrip_and_isolation():
    set_migration_status("ok")
    assert get_migration_status() == {"status": "ok", "detail": None}

    set_migration_status("error", "UndefinedColumn: users.password_hash")
    snap = get_migration_status()
    assert snap["status"] == "error"
    assert "password_hash" in (snap["detail"] or "")

    # Returned dict is a copy — callers can't mutate internal state.
    snap["status"] = "tampered"
    assert get_migration_status()["status"] == "error"

    set_migration_status("ok")  # restore


def test_migration_chain_has_single_resolvable_head():
    """Guards against an unmergeable/branched revision history: the code head
    must resolve to exactly one revision (what /ready compares the DB against)."""
    from pathlib import Path

    from alembic.script import ScriptDirectory

    import app.db as db

    script = ScriptDirectory.from_config(db._alembic_config())
    heads = script.get_heads()
    assert len(heads) == 1, f"expected a single migration head, got {heads}"
    assert isinstance(script.get_current_head(), str)
    # Sanity: the config points at this repo's migrations dir.
    assert (Path(db._API_ROOT) / "migrations" / "versions").is_dir()
