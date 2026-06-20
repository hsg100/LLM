from __future__ import annotations

import asyncio

import pytest

from app.config import Settings
from app.services.embeddings import (
    EmbeddingDimensionError,
    EmbeddingProvider,
    StubEmbeddings,
    validate_embedding_configuration,
)
from app.services.paper_sources.base import PaperCandidate
from app.services.ranking import rank_papers


def test_stub_embeddings_are_plain_float_lists_with_configured_dimension():
    provider = StubEmbeddings(dim=8)

    vectors = asyncio.run(provider.embed(["RAG evaluation"]))

    assert len(vectors) == 1
    assert len(vectors[0]) == 8
    assert isinstance(vectors[0], list)
    assert all(isinstance(x, float) for x in vectors[0])


def test_openai_provider_defaults_stub_model_to_text_embedding_3_small():
    settings = Settings(
        embedding_provider="openai",
        embedding_model="stub",
        embedding_dim=1536,
        openai_api_key="sk-test",
    )

    validate_embedding_configuration(settings)


def test_openai_provider_rejects_dimension_larger_than_model_supports():
    settings = Settings(
        embedding_provider="openai",
        embedding_model="text-embedding-3-small",
        embedding_dim=4096,
        openai_api_key="sk-test",
    )

    with pytest.raises(Exception, match="maximum dimension 1536"):
        validate_embedding_configuration(settings)


class BadDimEmbeddings(EmbeddingProvider):
    name = "bad"
    model = "bad"
    dim = 3
    configured_provider = "bad"
    fallback_reason = None

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.0, 1.0] for _ in texts]


def test_ranking_rejects_wrong_dimension_vectors():
    candidates = [
        PaperCandidate(source="stub", external_id="1", title="RAG evaluation benchmark"),
    ]

    with pytest.raises(EmbeddingDimensionError, match="expected EMBEDDING_DIM=3"):
        asyncio.run(rank_papers("RAG evaluation", candidates, BadDimEmbeddings(), max_papers=1))
