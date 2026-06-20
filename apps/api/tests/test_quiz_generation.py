from __future__ import annotations

import asyncio

from app.services.llm import LLMProvider
from app.services.quiz_generation import generate_quizzes_and_flashcards


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

    assert quizzes
    assert flashcards
    assert "systematic review" in flashcards[0]["back"]
    assert any("Which paper uses this method" in q["question"] for q in quizzes)
