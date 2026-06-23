"""Runtime-editable settings layered on top of the env-based defaults.

A single ``runtime_settings`` row holds a JSONB map of overrides for a small
whitelist of fields. ``effective_settings()`` returns a Settings copy with those
overrides applied, so changes take effect without a redeploy. Secrets and
schema-coupled values (DB/Redis URLs, embedding dim/provider) stay env-only.

Editable now: LLM provider + model tiers, max papers per landscape, Obsidian
auto-push. (Obsidian repo path and default sources remain env-only for now.)
"""

from __future__ import annotations

from typing import Any, Callable

from app.config import Settings, get_settings
from app.db import session_scope
from app.models import RuntimeSettings

_SINGLETON = "singleton"


def _coerce_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in {"1", "true", "yes", "on"}


def _coerce_provider(v: Any) -> str:
    s = str(v).strip().lower()
    if s not in {"openai", "deepseek", "anthropic"}:
        raise ValueError(f"unsupported llm_provider {v!r}")
    return s


def _coerce_max_papers(v: Any) -> int:
    n = int(v)
    if n < 1:
        raise ValueError("max_papers_per_landscape must be >= 1")
    return min(n, 500)


def _coerce_model(v: Any) -> str:
    s = str(v).strip()
    if not s:
        raise ValueError("model id must be non-empty")
    return s


# field name -> coercion/validation function
EDITABLE_FIELDS: dict[str, Callable[[Any], Any]] = {
    "llm_provider": _coerce_provider,
    "llm_model_fast": _coerce_model,
    "llm_model_strong": _coerce_model,
    "max_papers_per_landscape": _coerce_max_papers,
    "obsidian_export_auto_push": _coerce_bool,
    "obsidian_auto_export": _coerce_bool,
}


def get_overrides(session=None) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    def _read(s) -> dict[str, Any]:  # type: ignore[no-untyped-def]
        row = s.get(RuntimeSettings, _SINGLETON)
        return dict(row.overrides) if row and row.overrides else {}

    if session is not None:
        return _read(session)
    with session_scope() as s:
        return _read(s)


def set_overrides(patch: dict[str, Any]) -> dict[str, Any]:
    """Validate + persist a partial override map; returns the merged overrides.

    Unknown keys are rejected; ``None`` values are ignored (leave unchanged).
    """
    clean: dict[str, Any] = {}
    for key, value in (patch or {}).items():
        if value is None:
            continue
        if key not in EDITABLE_FIELDS:
            raise ValueError(f"{key!r} is not a runtime-editable setting")
        clean[key] = EDITABLE_FIELDS[key](value)

    with session_scope() as s:
        row = s.get(RuntimeSettings, _SINGLETON)
        if row is None:
            row = RuntimeSettings(id=_SINGLETON, overrides={})
        merged = {**(row.overrides or {}), **clean}
        row.overrides = merged
        s.add(row)
    return merged


def effective_settings(session=None) -> Settings:  # type: ignore[no-untyped-def]
    """Env-based Settings with persisted overrides applied (whitelist only)."""
    base = get_settings()
    overrides = {k: v for k, v in get_overrides(session).items() if k in EDITABLE_FIELDS}
    if not overrides:
        return base
    return base.model_copy(update=overrides)
