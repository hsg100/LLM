from __future__ import annotations

import asyncio

from app.schemas import Extraction
from app.services.extraction import extract_paper, select_extraction_context, validate_grounding, ExtractionContextChunk
from app.services.llm import LLMHTTPError, LLMProvider


VALID_EXTRACTION = {
    "problem": "Not reported",
    "motivation": "Not reported",
    "research_question": "Not reported",
    "method": "The paper proposes a benchmark with retrieval and answer metrics.",
    "contribution": "A reusable evaluation protocol.",
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
    "difficulty_level": 3,
    "reading_priority": "useful",
    "confidence": 0.8,
    "source_grounding": [
        {
            "field": "method",
            "section": "Experiments",
            "page": None,
            "chunk_id": "chunk-exp",
            "chunk_ordinal": 2,
            "quote": "The experiments describe RAGBench and metrics.",
            "confidence": 0.86,
        },
        {
            "field": "contribution",
            "section": "Experiments",
            "page": None,
            "chunk_id": "chunk-exp",
            "chunk_ordinal": 2,
            "quote": "The benchmark separates retrieval errors from generation errors.",
            "confidence": 0.82,
        },
    ],
}

VALID_CHUNKS = [
    {
        "chunk_id": "chunk-exp",
        "chunk_ordinal": 2,
        "section": "Experiments",
        "page": None,
        "text": "The experiments describe RAGBench and metrics. The benchmark separates retrieval errors from generation errors.",
    }
]


class FakeLLM(LLMProvider):
    name = "fake"
    default_model = "fake-json"

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def complete(self, messages, model=None, **kw):  # pragma: no cover
        raise AssertionError("complete_json should be called directly in this fake")

    async def complete_json(self, messages, model=None, **kw):
        self.calls.append((messages, kw))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def test_section_selection_prioritises_useful_sections_and_drops_references():
    context = select_extraction_context(
        sections=[
            ("References", "A very long bibliography"),
            ("Conclusion", "The conclusion explains the takeaway."),
            ("1 Introduction", "The intro states the RAG evaluation problem."),
            ("Appendix A", "Extra tables"),
            ("Experiments", "The experiments describe RAGBench and metrics."),
        ],
        paper_text=None,
        max_chars=500,
    )

    assert "The intro states" in context
    assert "The experiments describe" in context
    assert "The conclusion explains" in context
    assert "bibliography" not in context
    assert "Extra tables" not in context
    assert context.index("Introduction") < context.index("Experiments")


def test_section_selection_uses_cleaned_prefix_when_labels_unavailable():
    text = "Intro text\n\nMethod text\n\n# References\n[1] unrelated"
    context = select_extraction_context(paper_text=text, sections=None, max_chars=100)

    assert "Intro text" in context
    assert "Method text" in context
    assert "unrelated" not in context


def test_invalid_json_shape_is_validated_and_marked_degraded():
    llm = FakeLLM([{"problem": "Some signal", "results": "not a list"}])

    result = asyncio.run(
        extract_paper(
            llm,
            paper_id="paper-1",
            title="RAG Evaluation",
            abstract="A benchmark paper.",
            authors=[],
            year=2025,
            venue=None,
            paper_text="Method and experiments.",
        )
    )

    assert result.degraded is True
    assert result.fallback_reason == "validation_failed"
    assert result.data["_fieldmap"]["degraded"] is True


def test_llm_400_triggers_compact_retry():
    first_error = LLMHTTPError(
        provider="deepseek",
        model="deepseek-chat",
        stage="extraction",
        status_code=400,
        response_body_summary="prompt too long",
        request_character_count=12000,
        approximate_prompt_tokens=3000,
        paper_id="paper-2",
        paper_title="RAG Evaluation",
    )
    llm = FakeLLM([first_error, VALID_EXTRACTION])

    result = asyncio.run(
        extract_paper(
            llm,
            paper_id="paper-2",
            title="RAG Evaluation",
            abstract="A benchmark paper.",
            authors=[],
            year=2025,
            venue=None,
            paper_text="References should be removed.",
            chunks=VALID_CHUNKS,
            sections=[
                ("Introduction", "Intro " * 1000),
                ("Related Work", "Related " * 1000),
                ("Experiments", "Experiments " * 1000),
                ("References", "Reference " * 1000),
            ],
        )
    )

    assert result.degraded is False
    assert result.retry_used is True
    assert len(llm.calls) == 2
    retry_prompt = llm.calls[1][0][1]["content"]
    assert "Related Work" not in retry_prompt
    assert "References" not in retry_prompt
    assert "Experiments" in retry_prompt


def test_grounding_schema_validation_accepts_structured_grounding():
    data = Extraction.model_validate(VALID_EXTRACTION).model_dump()

    assert data["source_grounding"][0]["field"] == "method"
    assert data["source_grounding"][0]["confidence"] == 0.86


def test_invalid_chunk_ids_are_removed_and_not_reported_needs_no_grounding():
    data = {
        **VALID_EXTRACTION,
        "problem": "Not reported",
        "source_grounding": [
            {
                "field": "problem",
                "chunk_id": "missing",
                "quote": "not in context",
                "confidence": 0.9,
            }
        ],
    }
    validated, diag = validate_grounding(
        Extraction.model_validate(data).model_dump(),
        [ExtractionContextChunk("real", "Intro", None, 0, "Some source text")],
    )

    assert validated["source_grounding"] == []
    assert diag["invalid_groundings"] == 1
    assert "problem" not in diag["ungrounded_field_names"]


def test_failed_retry_returns_degraded_fallback():
    first_error = LLMHTTPError(
        provider="deepseek",
        model="deepseek-chat",
        stage="extraction",
        status_code=400,
        response_body_summary="bad request",
        request_character_count=12000,
        approximate_prompt_tokens=3000,
    )
    second_error = RuntimeError("still bad")
    llm = FakeLLM([first_error, second_error])

    result = asyncio.run(
        extract_paper(
            llm,
            title="RAG Evaluation",
            abstract="A benchmark paper.",
            authors=[],
            year=2025,
            venue=None,
            paper_text="Method and experiments.",
        )
    )

    assert result.degraded is True
    assert result.retry_used is True
    assert result.fallback_reason == "llm_400_compact_retry_failed"
    assert result.data["_fieldmap"]["fallback_reason"] == "llm_400_compact_retry_failed"
