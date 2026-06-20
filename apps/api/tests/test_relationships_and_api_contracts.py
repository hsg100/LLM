from __future__ import annotations

from app.api.routes import _normalise_extraction_payload, _normalise_job_event
from app.services.relationships import generate_paper_relationships


def test_paper_relationship_edge_generation():
    papers = [
        {
            "paper_id": "p1",
            "title": "RAG Evaluation Benchmark",
            "year": 2023,
            "score": 0.9,
            "cluster_id": "eval",
            "extraction": {
                "benchmarks": ["HotpotQA"],
                "datasets": ["RAGBench"],
                "metrics": ["faithfulness"],
                "related_papers": [],
            },
        },
        {
            "paper_id": "p2",
            "title": "Improved RAG Faithfulness Evaluation",
            "year": 2024,
            "score": 0.8,
            "cluster_id": "eval",
            "extraction": {
                "benchmarks": ["HotpotQA"],
                "baselines": ["RAG Evaluation Benchmark"],
                "related_papers": ["RAG Evaluation Benchmark"],
                "contribution": "Improves the benchmark analysis.",
            },
        },
    ]

    edges = generate_paper_relationships(papers)

    assert any(e["type"] == "baseline_for" and e["source_paper_id"] == "p1" and e["target_paper_id"] == "p2" for e in edges)
    assert any(e["type"] == "uses_same_benchmark" for e in edges)


def test_sse_event_format_normalisation():
    ev = _normalise_job_event(
        {
            "stage": "extracting",
            "progress": 0.5,
            "message": "Extracted paper",
            "meta": {"paper_id": "p1"},
        }
    )

    assert ev["ts"].endswith("Z")
    assert ev["stage"] == "extracting"
    assert ev["progress"] == 0.5
    assert ev["message"] == "Extracted paper"
    assert ev["meta"]["paper_id"] == "p1"


def test_paper_detail_payload_includes_full_extraction_fields():
    payload = _normalise_extraction_payload(
        {
            "research_question": "How should RAG be evaluated?",
            "novelty": "A new taxonomy.",
            "assumptions": ["retrieval corpus is fixed"],
            "baselines": ["BM25"],
            "metrics": ["faithfulness"],
            "mathematical_ideas": ["ranking correlation"],
            "source_grounding": [{"field": "novelty", "quote": "taxonomy", "confidence": 0.8}],
            "datasets": ["RAGBench"],
            "benchmarks": ["HotpotQA"],
            "open_questions": ["Can judges be calibrated?"],
            "project_ideas": ["Build evaluator"],
            "limitations": ["small benchmark"],
            "implementation_details": ["uses exact match"],
            "_fieldmap": {"degraded": False},
        }
    )

    assert payload is not None
    for key in [
        "research_question",
        "novelty",
        "assumptions",
        "baselines",
        "metrics",
        "mathematical_ideas",
        "source_grounding",
        "datasets",
        "benchmarks",
        "open_questions",
        "project_ideas",
        "limitations",
        "implementation_details",
    ]:
        assert key in payload
    assert payload["extra_fields"]["_fieldmap"]["degraded"] is False
