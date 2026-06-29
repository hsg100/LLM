from __future__ import annotations

import asyncio

from app.services.llm import LLMProvider
from app.services.quiz_generation import (
    _sanitize_flashcards,
    _sanitize_quizzes,
    generate_quizzes_and_flashcards,
    is_paper_attribution_stem,
)


class EmptyQuizLLM(LLMProvider):
    name = "empty"

    async def complete(self, messages, model=None, **kw):  # pragma: no cover
        raise AssertionError("complete_json should be called directly")

    async def complete_json(self, messages, model=None, **kw):
        return {"quizzes": [], "flashcards": []}


def test_empty_llm_quiz_response_falls_back_to_extracted_content():
    papers = [
        {
            "paper_id": "p1",
            "title": "RAG Evaluation Survey",
            "extraction": {
                "problem": "RAG evaluation lacks standardized methodology.",
                "method": "A systematic review categorizes datasets, retrieval, indexing, and generation evaluation.",
                "results": ["LLMs can automate several evaluation stages."],
                "limitations": ["LLM-as-judge can introduce bias."],
                "difficulty_level": 3,
            },
        },
        {
            "paper_id": "p2",
            "title": "Hallucination Detection Benchmark",
            "extraction": {
                "problem": "RAG hallucinations reduce trust.",
                "method": "A benchmark compares reference-free detectors across six RAG applications.",
                "results": ["Some detectors outperform random chance."],
                "limitations": ["Performance varies by dataset."],
                "difficulty_level": 2,
            },
        },
    ]

    quizzes, flashcards = asyncio.run(
        generate_quizzes_and_flashcards(EmptyQuizLLM(), topic="RAG evaluation", landscape_papers=papers)
    )

    assert flashcards
    assert "systematic review" in flashcards[0]["back"]
    # The fallback must not produce paper-attribution stems.
    assert not any(is_paper_attribution_stem(q["question"]) for q in quizzes)
    # And no surviving flashcard should be the deprecated `compare` kind.
    assert all(f["kind"] != "compare" for f in flashcards)


def test_is_paper_attribution_stem_matches_common_phrasings():
    assert is_paper_attribution_stem("Which paper uses this method: retrieval-augmented decoding?")
    assert is_paper_attribution_stem("What paper introduced this benchmark?")
    assert is_paper_attribution_stem("Which of these papers reports the lowest perplexity?")
    assert is_paper_attribution_stem("Which of the following papers benchmarks long-context RAG?")
    assert is_paper_attribution_stem("In which paper does the ablation appear?")
    # Negative: concept-grounded stems should pass through.
    assert not is_paper_attribution_stem("What problem does retrieval-augmented generation address?")
    assert not is_paper_attribution_stem("How does MMR balance relevance and diversity?")


def test_sanitize_quizzes_drops_paper_attribution_stems():
    raw = [
        {
            "question": "Which paper uses contrastive retrieval?",
            "options": ["A", "B", "C", "D"],
            "correct_index": 0,
        },
        {
            "question": "What problem does contrastive retrieval address?",
            "options": ["A", "B", "C", "D"],
            "correct_index": 1,
        },
    ]
    sanitized = _sanitize_quizzes(raw)
    assert len(sanitized) == 1
    assert sanitized[0]["question"].startswith("What problem")


def test_sanitize_flashcards_drops_compare_kind():
    raw = [
        {"front": "Compare A and B", "back": "...", "kind": "compare"},
        {"front": "What is MMR?", "back": "Maximal Marginal Relevance", "kind": "recall"},
    ]
    sanitized = _sanitize_flashcards(raw)
    assert len(sanitized) == 1
    assert sanitized[0]["kind"] == "recall"
