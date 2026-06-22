"""Sprint 4: synthesis rationales / field-structure flag, LLM-vs-heuristic edges."""
from __future__ import annotations

import asyncio

from app.services.relationships import generate_relationships
from app.services.synthesis import _deterministic_skeleton, synthesise


PAPERS = [
    {
        "paper_id": "a",
        "title": "A method",
        "category": "must-read",
        "extraction": {"contribution": "Introduces a retrieval method", "benchmarks": ["GLUE"]},
    },
    {
        "paper_id": "b",
        "title": "B method",
        "category": "skip-for-now",
        "extraction": {"benchmarks": ["GLUE"]},
    },
]


class _StubLLM:
    name = "stub"


class _FakeRelLLM:
    name = "deepseek"

    async def complete_json(self, messages, **kw):  # type: ignore[no-untyped-def]
        return {
            "edges": [
                {"source_paper_id": "a", "target_paper_id": "b", "type": "extends", "rationale": "B builds on A"},
                {"source_paper_id": "a", "target_paper_id": "zzz", "type": "extends", "rationale": "bad id"},
                {"source_paper_id": "a", "target_paper_id": "a", "type": "extends", "rationale": "self"},
            ]
        }


class _FakeSynthLLM:
    name = "deepseek"

    async def complete_json(self, messages, **kw):  # type: ignore[no-untyped-def]
        return {
            "field_structure": {
                "nodes": [{"id": "retrieval", "label": "Retrieval", "type": "concept", "importance": 0.8}],
                "edges": [],
            },
            "paper_rationales": [{"paper_id": "a", "rationale": "Read for its retrieval method."}],
        }


def test_skeleton_has_rationales_and_unflagged_structure():
    skel = _deterministic_skeleton(PAPERS)
    assert skel.field_structure_generated is False
    rationales = {r.paper_id: r.rationale for r in skel.paper_rationales}
    assert "Start here" in rationales["a"]
    assert "Lower priority" in rationales["b"]


def test_synthesise_flags_llm_authored_field_structure():
    synth = asyncio.run(synthesise(_FakeSynthLLM(), topic="retrieval", landscape_papers=PAPERS))
    assert synth.field_structure_generated is True
    assert any(n.label == "Retrieval" for n in synth.field_structure.nodes)


def test_relationships_fall_back_to_heuristic_for_stub():
    edges, method = asyncio.run(generate_relationships(_StubLLM(), PAPERS))
    assert method == "heuristic"
    # Both papers share the GLUE benchmark -> a deterministic edge exists.
    assert any(e["type"] == "uses_same_benchmark" for e in edges)


def test_llm_relationships_are_validated_and_used():
    edges, method = asyncio.run(generate_relationships(_FakeRelLLM(), PAPERS))
    assert method == "llm"
    keys = {(e["source_paper_id"], e["target_paper_id"], e["type"]) for e in edges}
    assert ("a", "b", "extends") in keys
    # Unknown target id and self-edge are dropped.
    assert all(e["target_paper_id"] != "zzz" for e in edges)
    assert all(e["source_paper_id"] != e["target_paper_id"] for e in edges)
