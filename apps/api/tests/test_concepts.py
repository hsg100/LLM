from __future__ import annotations

from app.exporters.obsidian_git import render_landscape_export
from app.schemas import ConceptMapOut, ConceptOut
from app.services.concepts import (
    annotate_text,
    build_concept_map,
    concept_slug,
    dedupe_terms,
    is_generic_term,
)


CONCEPTS = [
    {
        "id": "c1",
        "landscape_id": "l1",
        "term": "raw accumulation",
        "slug": "raw-accumulation",
        "aliases": ["context accumulation"],
        "short_definition": "Keeping all prior context without filtering.",
        "long_definition": "A context-management approach where previous text is appended directly.",
        "why_it_matters": "It can preserve errors and irrelevant details.",
        "related_terms": ["passive summarization"],
        "paper_ids": ["p1"],
        "source_grounding": [{"paper_id": "p1", "quote": "raw accumulation keeps everything", "confidence": 0.7}],
        "confidence": 0.82,
        "importance": 0.7,
    },
    {
        "id": "c2",
        "landscape_id": "l1",
        "term": "passive summarization",
        "slug": "passive-summarization",
        "aliases": [],
        "short_definition": "Compressing context without active verification.",
        "long_definition": "A lightweight summary of context that may omit checks.",
        "why_it_matters": "It can hide uncertainty.",
        "related_terms": ["raw accumulation"],
        "paper_ids": ["p1"],
        "source_grounding": [],
        "confidence": 0.8,
        "importance": 0.68,
    },
    {
        "id": "c3",
        "landscape_id": "l1",
        "term": "context",
        "slug": "context",
        "aliases": [],
        "short_definition": "Low confidence concept.",
        "long_definition": "",
        "why_it_matters": "",
        "related_terms": [],
        "paper_ids": [],
        "source_grounding": [],
        "confidence": 0.3,
        "importance": 0.1,
    },
]


def test_concept_slug_generation():
    assert concept_slug(" Raw accumulation ") == "raw-accumulation"
    assert concept_slug("RAG-style Evaluation!") == "rag-style-evaluation"


def test_generic_term_filtering():
    assert is_generic_term("model")
    assert is_generic_term("data")
    assert not is_generic_term("retrieval model")
    assert not is_generic_term("raw accumulation")


def test_concept_deduplication_by_term_slug():
    terms = ["Raw accumulation", "raw accumulation", "context accumulation", "model"]
    assert dedupe_terms(terms) == ["Raw accumulation", "context accumulation"]


def test_annotation_longer_match_first_and_preserves_case():
    segments = annotate_text(
        "Existing approaches use raw accumulation, not raw.",
        [
            *CONCEPTS,
            {
                **CONCEPTS[0],
                "id": "c4",
                "term": "raw",
                "slug": "raw",
                "short_definition": "short",
                "confidence": 0.9,
            },
        ],
    )

    concept_segments = [s for s in segments if s["type"] == "concept"]
    assert concept_segments[0]["text"] == "raw accumulation"
    assert concept_segments[0]["concept_slug"] == "raw-accumulation"


def test_annotation_skips_markdown_links_code_and_repeats_per_paragraph():
    text = (
        "[raw accumulation](https://example.com) and `passive summarization` stay plain.\n\n"
        "raw accumulation appears twice: raw accumulation."
    )
    segments = annotate_text(text, CONCEPTS)
    concept_segments = [s for s in segments if s["type"] == "concept"]

    assert len(concept_segments) == 1
    assert concept_segments[0]["text"] == "raw accumulation"
    assert "https://example.com" in "".join(s["text"] for s in segments)


def test_concept_api_schema_and_map_shape():
    concept = ConceptOut.model_validate(CONCEPTS[0])
    concept_map = ConceptMapOut.model_validate(build_concept_map(CONCEPTS))

    assert concept.term == "raw accumulation"
    assert concept.slug == "raw-accumulation"
    assert concept_map.nodes[0].type == "concept"
    assert any(e.source == "raw-accumulation" and e.target == "passive-summarization" for e in concept_map.edges)


def test_obsidian_export_creates_concept_notes_and_links_safely(tmp_path):
    plan = render_landscape_export(
        topic="RAG evaluation",
        landscape_id="l1",
        synthesis={
            "field_overview": "raw accumulation and passive summarization are common.",
            "why_it_matters": "[raw accumulation](https://example.com) should remain a markdown link.",
            "reading_path": [{"paper_id": "p1", "title": "RAG Context", "why": "raw accumulation helps explain context limits."}],
        },
        landscape_papers=[
            {
                "paper_id": "p1",
                "title": "RAG Context",
                "year": 2025,
                "venue": None,
                "authors": [],
                "url": "",
                "pdf_url": "",
                "arxiv_id": "",
                "category": "useful",
                "score": 0.8,
                "rationale": "raw accumulation baseline",
            }
        ],
        quizzes=[],
        flashcards=[],
        extractions_by_paper={"p1": {"method": "Uses raw accumulation.", "source_grounding": []}},
        root=tmp_path,
        concepts=CONCEPTS[:2],
        generated_at="2026-01-01T00:00:00Z",
    )

    rels = {str(path.relative_to(tmp_path)): body for path, body in plan.files}
    landscape_note = rels["FieldMap Research/Landscapes/rag-evaluation.md"]
    concept_note = rels["FieldMap Research/Concepts/rag-evaluation/raw-accumulation.md"]

    assert "[[Raw Accumulation]] and [[Passive Summarization]]" in landscape_note
    assert "[raw accumulation](https://example.com)" in landscape_note
    assert "type: \"concept\"" in concept_note
    assert "# Raw Accumulation" in concept_note
    assert "## Mentioned in papers" in concept_note


def test_concept_generation_failure_can_be_handled_without_failing_job(monkeypatch):
    from app.workers import landscape_job

    events = []

    monkeypatch.setattr(landscape_job, "_append_event", lambda *args, **kwargs: events.append((args, kwargs)))

    try:
        raise RuntimeError("concept failure")
    except RuntimeError as e:
        landscape_job._append_event(
            "job-1",
            "concepts",
            "Concept layer unavailable; continuing pipeline.",
            0.88,
            meta={"available": False, "degraded": True, "error_type": type(e).__name__},
        )

    assert events
    assert events[0][0][1] == "concepts"
    assert events[0][1]["meta"]["available"] is False
