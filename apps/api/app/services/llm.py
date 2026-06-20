"""LLM provider abstraction.

Three real providers (OpenAI / DeepSeek / Anthropic) and one deterministic
``StubLLM`` so the pipeline can run end-to-end without API keys. The stub
returns shape-valid placeholder JSON so extraction/synthesis/quiz steps
still produce non-empty notes; output quality is obviously poor.

All providers expose two surfaces:
  - ``complete(messages, model=None)`` -> str
  - ``complete_json(messages, schema, model=None)`` -> dict, with one
    retry on a non-JSON response.
"""

from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import get_settings

logger = logging.getLogger("fieldmap.llm")


@dataclass
class LLMHTTPError(Exception):
    provider: str
    model: str
    stage: str
    status_code: int
    response_body_summary: str
    request_character_count: int
    approximate_prompt_tokens: int
    paper_id: Optional[str] = None
    paper_title: Optional[str] = None

    def __str__(self) -> str:
        target = f" paper={self.paper_id or self.paper_title or 'n/a'}"
        return (
            f"{self.provider}/{self.model} {self.stage} HTTP {self.status_code};"
            f"{target}; body={self.response_body_summary}"
        )

    def diagnostic_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "stage": self.stage,
            "status_code": self.status_code,
            "response_body_summary": self.response_body_summary,
            "request_character_count": self.request_character_count,
            "approximate_prompt_tokens": self.approximate_prompt_tokens,
            "paper_id": self.paper_id,
            "paper_title": self.paper_title,
        }


def _is_retryable_exception(exc: BaseException) -> bool:
    if isinstance(exc, LLMHTTPError):
        return exc.status_code >= 500 or exc.status_code == 429
    return True


def _retry_policy():  # type: ignore[no-untyped-def]
    return retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=15),
        retry=retry_if_exception(_is_retryable_exception),
    )


class LLMProvider(ABC):
    name: str

    @abstractmethod
    async def complete(self, messages: list[dict[str, str]], model: Optional[str] = None, **kw: Any) -> str:
        ...

    async def complete_json(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        **kw: Any,
    ) -> dict[str, Any]:
        """Ask for JSON and parse. One retry on failure with an explicit nudge."""
        kw.setdefault("response_format", {"type": "json_object"})
        raw = await self.complete(messages, model=model, **kw)
        parsed = _try_parse_json(raw)
        if parsed is not None:
            return parsed
        retry_messages = messages + [
            {"role": "assistant", "content": raw},
            {
                "role": "user",
                "content": (
                    "Your previous response was not valid JSON. Reply with ONLY a "
                    "valid JSON object, no prose, no markdown fences."
                ),
            },
        ]
        raw2 = await self.complete(retry_messages, model=model, **kw)
        parsed2 = _try_parse_json(raw2)
        if parsed2 is None:
            raise ValueError("LLM did not return valid JSON after retry")
        return parsed2


# ---------------------------------------------------------------------------
class OpenAILLM(LLMProvider):
    name = "openai"

    def __init__(self, api_key: str, default_model: str):
        self.api_key = api_key
        self.default_model = default_model

    @_retry_policy()
    async def complete(self, messages: list[dict[str, str]], model: Optional[str] = None, **kw: Any) -> str:
        resolved_model = model or self.default_model
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=_without_none(
                    {
                    "model": resolved_model,
                    "messages": messages,
                    "temperature": kw.get("temperature", 0.2),
                    "response_format": kw.get("response_format"),
                    "max_tokens": kw.get("max_tokens"),
                    }
                ),
            )
            _raise_for_status(
                r,
                provider=self.name,
                model=resolved_model,
                messages=messages,
                **_call_context(kw),
            )
            data = r.json()
            return data["choices"][0]["message"]["content"]


class DeepSeekLLM(LLMProvider):
    name = "deepseek"

    def __init__(self, api_key: str, default_model: str):
        self.api_key = api_key
        self.default_model = default_model

    @_retry_policy()
    async def complete(self, messages: list[dict[str, str]], model: Optional[str] = None, **kw: Any) -> str:
        resolved_model = model or self.default_model
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                "https://api.deepseek.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=_without_none(
                    {
                    "model": resolved_model,
                    "messages": messages,
                    "temperature": kw.get("temperature", 0.2),
                    "response_format": kw.get("response_format"),
                    "max_tokens": kw.get("max_tokens", 4096),
                    }
                ),
            )
            _raise_for_status(
                r,
                provider=self.name,
                model=resolved_model,
                messages=messages,
                **_call_context(kw),
            )
            data = r.json()
            return data["choices"][0]["message"]["content"]


class AnthropicLLM(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, default_model: str):
        self.api_key = api_key
        self.default_model = default_model

    @_retry_policy()
    async def complete(self, messages: list[dict[str, str]], model: Optional[str] = None, **kw: Any) -> str:
        # Anthropic separates system from user/assistant turns.
        resolved_model = model or self.default_model
        system_chunks = [m["content"] for m in messages if m["role"] == "system"]
        convo = [m for m in messages if m["role"] != "system"]
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": resolved_model,
                    "max_tokens": kw.get("max_tokens", 4096),
                    "system": "\n\n".join(system_chunks) or None,
                    "messages": convo,
                    "temperature": kw.get("temperature", 0.2),
                },
            )
            _raise_for_status(
                r,
                provider=self.name,
                model=resolved_model,
                messages=messages,
                **_call_context(kw),
            )
            data = r.json()
            parts = data.get("content", [])
            return "".join(p.get("text", "") for p in parts if p.get("type") == "text")


class StubLLM(LLMProvider):
    """Deterministic offline provider.

    Returns shape-valid JSON for extraction/synthesis/quiz prompts so the
    pipeline finishes without external dependencies. Output is intentionally
    spartan and uses "Not reported" / "(stub)" markers.
    """

    name = "stub"
    default_model = "stub"

    async def complete(self, messages: list[dict[str, str]], model: Optional[str] = None, **kw: Any) -> str:
        prompt = "\n\n".join(m["content"] for m in messages)
        return _stub_response(prompt)


# ---------------------------------------------------------------------------
def get_llm(strong: bool = False) -> LLMProvider:
    s = get_settings()
    provider = s.llm_provider.lower()
    model = s.llm_model_strong if strong else s.llm_model_fast
    if provider == "openai" and s.openai_api_key:
        return OpenAILLM(s.openai_api_key, model)
    if provider == "deepseek" and s.deepseek_api_key:
        return DeepSeekLLM(s.deepseek_api_key, model)
    if provider == "anthropic" and s.anthropic_api_key:
        return AnthropicLLM(s.anthropic_api_key, model)
    return StubLLM()


# ---------------------------------------------------------------------------
def _without_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in payload.items() if v is not None}


def _call_context(kw: dict[str, Any]) -> dict[str, Optional[str]]:
    return {
        "stage": str(kw.get("stage") or "unknown"),
        "paper_id": kw.get("paper_id"),
        "paper_title": kw.get("paper_title"),
    }


def _message_char_count(messages: list[dict[str, str]]) -> int:
    return sum(len(m.get("content") or "") for m in messages)


def _response_summary(response: httpx.Response, limit: int = 400) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, dict):
                msg = err.get("message") or err.get("type") or json.dumps(err, ensure_ascii=False)
                return str(msg)[:limit]
            return json.dumps(data, ensure_ascii=False)[:limit]
    except Exception:  # noqa: BLE001
        pass
    return (response.text or "").replace("\n", " ")[:limit]


def _raise_for_status(
    response: httpx.Response,
    *,
    provider: str,
    model: str,
    messages: list[dict[str, str]],
    stage: str,
    paper_id: Optional[str],
    paper_title: Optional[str],
) -> None:
    if response.status_code < 400:
        return
    request_chars = _message_char_count(messages)
    err = LLMHTTPError(
        provider=provider,
        model=model,
        stage=stage,
        status_code=response.status_code,
        response_body_summary=_response_summary(response),
        request_character_count=request_chars,
        approximate_prompt_tokens=max(1, request_chars // 4),
        paper_id=paper_id,
        paper_title=paper_title,
    )
    logger.warning("llm_http_error %s", err.diagnostic_dict())
    raise err


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)
_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _try_parse_json(raw: str) -> Optional[dict[str, Any]]:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        pass
    m = _FENCE_RE.search(raw)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    m = _OBJECT_RE.search(raw)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None


def _stub_response(prompt: str) -> str:
    """Return shape-valid JSON based on prompt hints."""
    lower = prompt.lower()
    if "return valid json" in lower and "problem" in lower and "research_question" in lower:
        return json.dumps(
            {
                "problem": "Not reported",
                "motivation": "Not reported",
                "research_question": "Not reported",
                "method": "Not reported (stub run — set an LLM provider in .env)",
                "contribution": "Not reported",
                "novelty": "Not reported",
                "results": [],
                "limitations": [],
                "assumptions": [],
                "datasets": [],
                "benchmarks": [],
                "baselines": [],
                "metrics": [],
                "implementation_details": [],
                "mathematical_ideas": [],
                "prerequisites": [],
                "key_terms": [],
                "related_papers": [],
                "open_questions": [],
                "project_ideas": [],
                "difficulty_level": 2,
                "reading_priority": "optional",
                "confidence": 0.1,
                "source_grounding": [],
            }
        )
    if '"field_overview"' in lower or "synthesise the landscape" in lower:
        return json.dumps(
            {
                "field_overview": "Stub overview — configure an LLM provider for a real synthesis.",
                "why_it_matters": "Stub run.",
                "clusters": [],
                "must_read_paper_ids": [],
                "reading_path": [],
                "prerequisites": [],
                "datasets_benchmarks": [],
                "method_timeline": [],
                "tensions": [],
                "open_problems": [],
                "project_ideas": [],
                "skip_for_now": [],
            }
        )
    if '"quizzes"' in lower or "generate mcq" in lower or "active recall" in lower:
        return json.dumps(
            {
                "quizzes": [
                    {
                        "question": "(stub) Configure an LLM provider to generate real quiz items.",
                        "options": ["Set OPENAI_API_KEY", "Set DEEPSEEK_API_KEY", "Set ANTHROPIC_API_KEY", "All of the above"],
                        "correct_index": 3,
                        "explanation": "Any provider works once configured.",
                        "concept": "setup",
                        "difficulty": 1,
                    }
                ],
                "flashcards": [
                    {
                        "front": "What is FieldMap?",
                        "back": "A personal AI research and learning engine for ML/AI papers.",
                        "concept": "fieldmap",
                        "kind": "recall",
                    }
                ],
            }
        )
    return json.dumps({"stub": True, "note": "no shape matched"})
