"""Smoke test the configured LLM provider.

Run inside the API environment:

    python -m app.scripts.smoke_llm
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.config import get_settings
from app.services.llm import LLMHTTPError, StubLLM, get_llm


async def _run() -> int:
    settings = get_settings()
    llm = get_llm(strong=False)
    model = getattr(llm, "default_model", "stub")
    out: dict[str, Any] = {
        "provider": getattr(llm, "name", "unknown"),
        "model": model,
    }

    if isinstance(llm, StubLLM):
        out.update(
            {
                "ok": False,
                "error": "configured provider resolved to stub; set a matching LLM_PROVIDER and API key",
                "configured_provider": settings.llm_provider,
            }
        )
        print(json.dumps(out, indent=2))
        return 2

    messages = [
        {"role": "system", "content": "Return JSON only."},
        {
            "role": "user",
            "content": 'Return this exact JSON shape: {"ok": true, "provider": "string", "answer": 2}.',
        },
    ]
    try:
        raw = await llm.complete_json(messages, stage="llm_smoke")
    except LLMHTTPError as e:
        out.update(
            {
                "ok": False,
                "error": "provider returned an HTTP error",
                "diagnostics": e.diagnostic_dict(),
            }
        )
        print(json.dumps(out, indent=2))
        return 1
    except Exception as e:  # noqa: BLE001
        out.update(
            {
                "ok": False,
                "error": f"{type(e).__name__}: {str(e)[:240]}",
                "hint": "check model name, API key, provider base URL, and JSON-mode support",
            }
        )
        print(json.dumps(out, indent=2))
        return 1

    if not isinstance(raw, dict) or raw.get("ok") is not True:
        out.update(
            {
                "ok": False,
                "error": "LLM responded, but did not return the expected JSON object",
                "response_keys": list(raw.keys()) if isinstance(raw, dict) else [],
            }
        )
        print(json.dumps(out, indent=2))
        return 1

    out.update({"ok": True, "response_keys": list(raw.keys())})
    print(json.dumps(out, indent=2))
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
