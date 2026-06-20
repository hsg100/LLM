from __future__ import annotations

from app.exporters.obsidian_git import render_landscape_export
from app.services.synthesis import build_papers_json, _deterministic_skeleton


GROUNDED_EXTRACTION = {
    "problem": "Not reported",
    "motivation": "Not reported",
    "research_question": "Not reported",
    "method": "The paper evaluates RAG faithfulness.",
    "contribution": "It proposes an evaluation benchmark.",
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
            "chunk_id": "chunk-1",
            "chunk_ordinal": 4,
            "quote": "We evaluate RAG faithfulness using benchmark tasks.",
            "confidence": 0.86,
        }
    ],
    "_fieldmap": {
        "degraded": False,
        "fallback_reason": None,
        "grounding": {
            "grounded_fields": 1,
            "ungrounded_fields": 1,
            "claim_fields": 2,
            "invalid_groundings": 0,
            "average_grounding_confidence": 0.86,
        },
    },
}


def test_obsidian_markdown_includes_structured_grounding(tmp_path):
    plan = render_landscape_export(
        topic="RAG evaluation",
        landscape_id="landscape-1",
        synthesis={},
        landscape_papers=[
            {
                "paper_id": "paper-1",
                "title": "Grounded RAG Evaluation",
                "year": 2025,
                "venue": None,
                "authors": [],
                "url": "",
                "pdf_url": "",
                "arxiv_id": "",
                "category": "useful",
                "score": 0.8,
                "rationale": "test",
            }
        ],
        quizzes=[],
        flashcards=[],
        extractions_by_paper={"paper-1": GROUNDED_EXTRACTION},
        root=tmp_path,
        generated_at="2026-01-01T00:00:00Z",
    )

    paper_note = next(body for path, body in plan.files if path.name == "grounded-rag-evaluation.md")
    assert "## Source grounding" in paper_note
    assert "### Method" in paper_note
    assert "Experiments, chunk 4 (`chunk-1`)" in paper_note
    assert "We evaluate RAG faithfulness" in paper_note


def test_synthesis_marks_weakly_grounded_data_honestly():
    papers = [{"paper_id": "p1", "title": "A", "category": "useful", "score": 0.7, "extraction": GROUNDED_EXTRACTION}]

    packed = build_papers_json(papers)
    skeleton = _deterministic_skeleton(papers)

    assert '"grounded_fields": 1' in packed
    assert '"ungrounded_fields": 1' in packed
    assert skeleton.extraction_quality["grounded_fields"] == 1
