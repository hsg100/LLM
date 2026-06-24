"""Unit tests for the deterministic topic guard (no DB / network required)."""
from __future__ import annotations

import pytest

from app.services.topic_guard import (
    CATEGORY_GIBBERISH,
    CATEGORY_NO_LETTERS,
    CATEGORY_TOO_SHORT,
    evaluate_topic,
    is_offtopic,
    normalize_topic,
)

# The live UI suggestions — every one must pass the guard.
UI_SUGGESTIONS = [
    "Mechanistic interpretability",
    "Long-context LLMs",
    "RAG evaluation",
    "LLM agents for science",
    "Test-time compute scaling",
    "Multimodal reasoning",
    "Reward modeling & RLHF",
    "Model merging",
    "World models",
    "Agentic web browsing",
    "Speculative decoding",
    "Diffusion language models",
]

LEGIT_TOPICS = UI_SUGGESTIONS + [
    "GPT-4",
    "RAG",
    "C++ compilers for ML kernels",
    "reinforcement learning in Minecraft environments",
    "procedural game level generation with GANs",
    "protein structure prediction",
    "quantum error correction",
]


@pytest.mark.parametrize("topic", LEGIT_TOPICS)
def test_legit_topics_pass(topic):
    verdict = evaluate_topic(topic)
    assert verdict.ok, f"expected ok for {topic!r}, got {verdict.category}: {verdict.reason}"


@pytest.mark.parametrize(
    "topic",
    [
        "gta",
        "GTA",
        "Grand Theft Auto",
        "bonnie blue",
        "Bonnie Blue",
        "fortnite",
        "minecraft",
        "taylor swift",
        "premier league",
        "onlyfans",
    ],
)
def test_offtopic_spam_rejected(topic):
    verdict = evaluate_topic(topic)
    assert not verdict.ok
    assert verdict.category.startswith("offtopic")


def test_research_framing_overrides_blocklist():
    # A denylisted noun inside genuine research framing is allowed.
    assert evaluate_topic("reinforcement learning in Minecraft").ok
    assert evaluate_topic("GAN models for FIFA gameplay video synthesis").ok


@pytest.mark.parametrize(
    "topic,category",
    [
        ("", CATEGORY_TOO_SHORT),
        (" ", CATEGORY_TOO_SHORT),
        ("a", CATEGORY_TOO_SHORT),
        ("123456", CATEGORY_NO_LETTERS),
        ("$$$$", CATEGORY_NO_LETTERS),
        ("aaaaaa", CATEGORY_GIBBERISH),
        ("!!!!", CATEGORY_NO_LETTERS),
        ("12a34", CATEGORY_GIBBERISH),
    ],
)
def test_structural_rejections(topic, category):
    verdict = evaluate_topic(topic)
    assert not verdict.ok
    assert verdict.category == category


def test_normalize_collapses_whitespace():
    assert normalize_topic("  RAG   evaluation\n") == "RAG evaluation"


def test_normalized_topic_returned_for_persistence():
    verdict = evaluate_topic("   Long-context   LLMs  ")
    assert verdict.ok
    assert verdict.normalized == "Long-context LLMs"


def test_is_offtopic_predicate():
    assert is_offtopic("gta") is True
    assert is_offtopic("RAG evaluation") is False
