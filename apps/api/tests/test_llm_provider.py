"""get_llm provider selection + stub gating."""
from __future__ import annotations

import pytest

from app.config import Settings
from app import runtime_settings as rs
from app.services import llm as llm_mod


def _settings(**kw):
    base = dict(env="development", llm_provider="deepseek", deepseek_api_key="")
    base.update(kw)
    return Settings(**base)


def _patch(monkeypatch, **kw):
    # get_llm resolves config via runtime_settings.effective_settings().
    monkeypatch.setattr(rs, "effective_settings", lambda *a, **k: _settings(**kw))


def test_dev_without_key_falls_back_to_stub(monkeypatch):
    _patch(monkeypatch, env="development")
    assert llm_mod.get_llm().name == "stub"


def test_production_without_key_raises(monkeypatch):
    _patch(monkeypatch, env="production")
    with pytest.raises(llm_mod.LLMConfigError):
        llm_mod.get_llm()


def test_deepseek_selected_with_tiered_models(monkeypatch):
    _patch(
        monkeypatch,
        env="production",
        deepseek_api_key="sk-test",
        llm_model_fast="deepseek-chat",
        llm_model_strong="deepseek-reasoner",
    )
    fast = llm_mod.get_llm(strong=False)
    strong = llm_mod.get_llm(strong=True)
    assert fast.name == "deepseek" and fast.default_model == "deepseek-chat"
    assert strong.name == "deepseek" and strong.default_model == "deepseek-reasoner"
