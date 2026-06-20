"""Prompt loader with minimal mustache-style substitution.

Prompts live in ``app/prompts/*.md``. We deliberately use only ``{{key}}``
substitution (no logic, no conditionals) to keep the prompts inspectable
as plain documents.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts"

_TAG = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


@lru_cache(maxsize=32)
def load(name: str) -> str:
    path = PROMPT_DIR / f"{name}.md"
    return path.read_text(encoding="utf-8")


def render(name: str, **fields: Any) -> str:
    template = load(name)

    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        v = fields.get(key, "")
        return str(v)

    return _TAG.sub(sub, template)
