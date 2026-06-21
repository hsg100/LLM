"""Runtime-editable settings overrides (DB-backed; skips without Postgres)."""
from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db import engine, session_scope
from app.models import RuntimeSettings
from app import runtime_settings as rs


def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


pytestmark = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    with session_scope() as s:
        row = s.get(RuntimeSettings, "singleton")
        if row is not None:
            row.overrides = {}
            s.add(row)


def test_set_and_effective_roundtrip():
    rs.set_overrides({"llm_provider": "openai", "max_papers_per_landscape": 7})
    eff = rs.effective_settings()
    assert eff.llm_provider == "openai"
    assert eff.max_papers_per_landscape == 7


def test_unknown_key_rejected():
    with pytest.raises(ValueError):
        rs.set_overrides({"database_url": "postgres://evil"})


def test_invalid_provider_rejected():
    with pytest.raises(ValueError):
        rs.set_overrides({"llm_provider": "not-a-provider"})


def test_none_values_ignored_and_merge_is_partial():
    rs.set_overrides({"llm_model_fast": "deepseek-chat"})
    rs.set_overrides({"llm_model_strong": "deepseek-reasoner", "llm_model_fast": None})
    merged = rs.get_overrides()
    assert merged["llm_model_fast"] == "deepseek-chat"  # preserved
    assert merged["llm_model_strong"] == "deepseek-reasoner"
