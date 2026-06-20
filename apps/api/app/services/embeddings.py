"""Embedding provider abstraction.

The deterministic stub is intentionally available for local/offline
development. Real providers must return plain ``list[float]`` values and
must match ``Settings.embedding_dim`` because the pgvector columns are
created with a fixed dimension.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from abc import ABC, abstractmethod
from typing import Any, Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import Settings, get_settings


_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9\-]+")
logger = logging.getLogger("fieldmap.embeddings")


OPENAI_MODEL_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}
DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
OPENAI_DIMENSIONS_PARAM_MODELS = {"text-embedding-3-small", "text-embedding-3-large"}


class EmbeddingProviderError(RuntimeError):
    """Base error for embedding provider failures."""


class EmbeddingProviderConfigError(EmbeddingProviderError):
    """Raised when the configured embedding provider cannot be built."""


class EmbeddingDimensionError(EmbeddingProviderError):
    """Raised when returned vectors do not match the configured dimension."""


class EmbeddingProvider(ABC):
    dim: int
    name: str
    model: str
    configured_provider: str
    fallback_reason: str | None

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    @property
    def is_fallback(self) -> bool:
        return self.fallback_reason is not None


class StubEmbeddings(EmbeddingProvider):
    """Deterministic feature-hashed embedding for offline development."""

    name = "stub"

    def __init__(
        self,
        dim: int,
        model: str = "stub",
        configured_provider: str = "stub",
        fallback_reason: str | None = None,
    ):
        self.dim = dim
        self.model = model
        self.configured_provider = configured_provider
        self.fallback_reason = fallback_reason

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        toks = _TOKEN.findall(text.lower())
        for tok in toks:
            h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=8).digest(), "big")
            idx = h % self.dim
            sign = 1.0 if (h >> 63) & 1 == 0 else -1.0
            vec[idx] += sign
        return _l2_normalize(vec)


class OpenAIEmbeddings(EmbeddingProvider):
    def __init__(self, api_key: str, model: str, dim: int):
        if not api_key:
            raise EmbeddingProviderConfigError("OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai")
        self.api_key = api_key
        self.model = model
        self.dim = dim
        self.name = "openai"
        self.configured_provider = "openai"
        self.fallback_reason = None

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def _request(self, batch: list[str]) -> list[list[float]]:
        payload: dict[str, Any] = {
            "model": self.model,
            "input": batch,
            "encoding_format": "float",
        }
        if self.model in OPENAI_DIMENSIONS_PARAM_MODELS:
            payload["dimensions"] = self.dim
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            r.raise_for_status()
            data = r.json()["data"]
            data = sorted(data, key=lambda d: d.get("index", 0))
            vectors = [_plain_vector(d["embedding"]) for d in data]
            _validate_embedding_batch(vectors, expected_count=len(batch), dim=self.dim)
            return vectors

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for chunk in _batched(texts, 64):
            out.extend(await self._request(list(chunk)))
        _validate_embedding_batch(out, expected_count=len(texts), dim=self.dim)
        return out


def get_embedding_provider() -> EmbeddingProvider:
    s = get_settings()
    provider = (s.embedding_provider or "stub").lower().strip()
    if provider == "stub":
        return StubEmbeddings(s.embedding_dim, model=s.embedding_model or "stub")
    if provider == "openai" and s.openai_api_key:
        validate_embedding_configuration(s)
        return OpenAIEmbeddings(s.openai_api_key, _model_for_provider(s), s.embedding_dim)
    if provider == "openai":
        reason = "OPENAI_API_KEY is not set"
        if embedding_fallback_allowed(s):
            logger.warning("embedding provider openai unavailable: %s; falling back to stub", reason)
            return fallback_stub_provider(reason, s)
        raise EmbeddingProviderConfigError(reason)
    raise EmbeddingProviderConfigError(f"unsupported EMBEDDING_PROVIDER={s.embedding_provider!r}")


def fallback_stub_provider(reason: str, settings: Settings | None = None) -> StubEmbeddings:
    s = settings or get_settings()
    return StubEmbeddings(
        s.embedding_dim,
        model="stub",
        configured_provider=(s.embedding_provider or "unknown").lower().strip(),
        fallback_reason=reason,
    )


def embedding_fallback_allowed(settings: Settings | None = None) -> bool:
    s = settings or get_settings()
    if s.is_development:
        return bool(s.enable_embedding_dev_fallback)
    return bool(s.allow_embedding_fallback_in_production)


def embedding_metadata(
    provider: EmbeddingProvider,
    *,
    candidate_count: int | None = None,
    ranked_count: int | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "embedding_provider": provider.name,
        "embedding_model": provider.model,
        "embedding_dim": provider.dim,
        "configured_embedding_provider": provider.configured_provider,
        "embedding_fallback": provider.is_fallback,
    }
    if provider.fallback_reason:
        meta["embedding_fallback_reason"] = provider.fallback_reason
    if candidate_count is not None:
        meta["candidate_count"] = candidate_count
    if ranked_count is not None:
        meta["ranked_count"] = ranked_count
    return meta


def validate_embedding_configuration(settings: Settings | None = None) -> None:
    s = settings or get_settings()
    provider = (s.embedding_provider or "stub").lower().strip()
    if s.embedding_dim <= 0:
        raise EmbeddingProviderConfigError("EMBEDDING_DIM must be a positive integer")
    if provider == "stub":
        return
    if provider != "openai":
        raise EmbeddingProviderConfigError(f"unsupported EMBEDDING_PROVIDER={s.embedding_provider!r}")

    model = _model_for_provider(s)
    if not model:
        raise EmbeddingProviderConfigError("EMBEDDING_MODEL is required for EMBEDDING_PROVIDER=openai")
    max_dim = OPENAI_MODEL_DIMS.get(model)
    if max_dim is not None:
        if model in OPENAI_DIMENSIONS_PARAM_MODELS:
            if s.embedding_dim > max_dim:
                raise EmbeddingProviderConfigError(
                    f"EMBEDDING_DIM={s.embedding_dim} exceeds {model}'s maximum dimension {max_dim}"
                )
        elif s.embedding_dim != max_dim:
            raise EmbeddingProviderConfigError(
                f"{model} returns {max_dim}-d vectors; set EMBEDDING_DIM={max_dim}"
            )
    if not s.openai_api_key and not embedding_fallback_allowed(s):
        raise EmbeddingProviderConfigError("OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai")


def _model_for_provider(settings: Settings) -> str:
    model = (settings.embedding_model or "").strip()
    provider = (settings.embedding_provider or "stub").lower().strip()
    if provider == "openai" and (not model or model == "stub"):
        return DEFAULT_OPENAI_EMBEDDING_MODEL
    return model


def _plain_vector(value: Any) -> list[float]:
    if value is None:
        raise EmbeddingDimensionError("embedding response contained null vector")
    if hasattr(value, "tolist"):
        value = value.tolist()
    return [float(x) for x in list(value)]


def _validate_embedding_batch(vectors: list[list[float]], *, expected_count: int, dim: int) -> None:
    if len(vectors) != expected_count:
        raise EmbeddingDimensionError(f"expected {expected_count} embeddings, got {len(vectors)}")
    for i, vector in enumerate(vectors):
        if len(vector) != dim:
            raise EmbeddingDimensionError(
                f"embedding {i} has dimension {len(vector)}; expected EMBEDDING_DIM={dim}"
            )


# ---------------------------------------------------------------------------
# Vector math
# ---------------------------------------------------------------------------
def cosine(a, b) -> float:  # type: ignore[no-untyped-def]
    """Cosine similarity that accepts list, tuple, or numpy ndarray inputs.

    Never uses ``if a:`` on a vector — numpy raises on that. We materialise
    to plain Python floats so the math is identical regardless of input type.
    """
    from app.services.vectors import iter_floats

    if a is None or b is None:
        return 0.0
    av = iter_floats(a)
    bv = iter_floats(b)
    if len(av) == 0 or len(bv) == 0:
        return 0.0
    dot = sum(x * y for x, y in zip(av, bv))
    na = math.sqrt(sum(x * x for x in av)) or 1.0
    nb = math.sqrt(sum(x * x for x in bv)) or 1.0
    return dot / (na * nb)


def _l2_normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _batched(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]
