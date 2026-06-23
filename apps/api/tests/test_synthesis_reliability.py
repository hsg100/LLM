"""Field-synthesis reliability: honest degradation + partial-field salvage.

Covers the failure taxonomy that previously collapsed silently to the
deterministic skeleton via ``synthesise()``'s catch-all ``except Exception``:
one bad nested item, JSON robustness (parse/truncation), timeout, HTTP 400
(over-long prompt) compact retry, empty output, and stub gating.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

import pytest
from sqlalchemy import text
from sqlmodel import select

from app.db import engine, session_scope
from app.models import Landscape, LandscapePaper, Paper, SearchJob
from app.services.llm import LLMHTTPError, _try_parse_json
from app.services.synthesis import (
    build_papers_json,
    synthesise,
    synthesise_with_meta,
)
from app.workers.landscape_job import _persist_synthesis


PAPERS = [
    {
        "paper_id": "a",
        "title": "A retrieval method",
        "year": 2023,
        "category": "must-read",
        "extraction": {
            "contribution": "Introduces a dense retrieval method",
            "method": "dense retrieval",
            "benchmarks": ["GLUE"],
            "key_terms": ["dense retrieval", "reranking"],
        },
    },
    {
        "paper_id": "b",
        "title": "B benchmark",
        "year": 2024,
        "category": "useful",
        "extraction": {"problem": "evaluating retrieval", "benchmarks": ["GLUE"], "key_terms": ["evaluation"]},
    },
    {
        "paper_id": "c",
        "title": "C survey",
        "year": 2022,
        "category": "skip-for-now",
        "extraction": {"contribution": "surveys the field"},
    },
]


class _LLM:
    """Programmable LLM stub driven by an async behaviour callable."""

    name = "deepseek"

    def __init__(self, behaviour):
        self._behaviour = behaviour
        self.calls: list[dict] = []

    async def complete_json(self, messages, **kw):  # type: ignore[no-untyped-def]
        self.calls.append({"messages": messages, "kw": kw})
        return await self._behaviour(self, messages, **kw)


def _good_response() -> dict:
    return {
        "field_overview": "Real overview about retrieval.",
        "why_it_matters": "It matters a lot.",
        "field_structure": {
            "nodes": [{"id": "r", "label": "Retrieval", "type": "concept", "importance": 0.8}],
            "edges": [],
        },
        "clusters": [{"name": "Good", "summary": "fine", "paper_ids": ["a", "b"]}],
        "reading_path": [{"paper_id": "a", "title": "A retrieval method", "why": "foundational", "cluster": "Good"}],
        "paper_rationales": [{"paper_id": "a", "rationale": "Read first."}],
    }


def _run(llm, **kw):
    return asyncio.run(synthesise_with_meta(llm, topic="retrieval", landscape_papers=PAPERS, **kw))


# --- JSON robustness (parser-level) ----------------------------------------
def test_json_parser_trailing_commas():
    assert _try_parse_json('{"a": 1, "b": [1, 2,],}') == {"a": 1, "b": [1, 2]}


def test_json_parser_truncated_object_keeps_valid_prefix():
    parsed = _try_parse_json('{"field_overview": "hi", "clusters": [{"name": "x", "summary": "y"')
    assert parsed is not None
    assert parsed["field_overview"] == "hi"
    assert parsed["clusters"][0]["name"] == "x"


def test_json_parser_prose_wrapper():
    assert _try_parse_json("Here is the JSON:\n{\"a\": 1}\nDone.") == {"a": 1}


def test_json_parser_rejects_garbage():
    assert _try_parse_json("totally not json") is None


# --- Partial-field salvage --------------------------------------------------
def test_one_bad_cluster_does_not_sink_synthesis():
    async def behaviour(self, m, **kw):
        resp = _good_response()
        resp["clusters"].append({"name": "Bad", "paper_ids": ["c"]})  # missing 'summary'
        return resp

    res = _run(_LLM(behaviour))
    assert res.cause == "real"
    assert res.degraded is False
    # The good cluster survives; the malformed one is dropped.
    assert [c.name for c in res.synthesis.clusters] == ["Good"]
    assert res.synthesis.field_overview == "Real overview about retrieval."
    assert "clusters" in res.salvaged_fields


def test_one_bad_reading_step_dropped_not_whole():
    async def behaviour(self, m, **kw):
        resp = _good_response()
        resp["reading_path"].append({"paper_id": "b", "title": "B"})  # missing 'why'
        return resp

    res = _run(_LLM(behaviour))
    assert res.cause == "real"
    assert [s.paper_id for s in res.synthesis.reading_path] == ["a"]


def test_bad_field_structure_node_salvaged():
    async def behaviour(self, m, **kw):
        resp = _good_response()
        resp["field_structure"]["nodes"].append({"id": "x", "label": "Bad", "importance": 5.0})  # >1
        return resp

    res = _run(_LLM(behaviour))
    assert res.cause == "real"
    assert res.synthesis.field_structure_generated is True
    labels = {n.label for n in res.synthesis.field_structure.nodes}
    assert "Retrieval" in labels
    assert "Bad" not in labels


def test_all_field_structure_nodes_invalid_is_not_flagged_generated():
    """When every LLM node is invalid, we fall back to the deterministic
    outline — which must NOT be reported as an LLM-authored DAG."""
    async def behaviour(self, m, **kw):
        return {
            "field_overview": "Real overview.",
            "why_it_matters": "Matters.",
            "field_structure": {"nodes": [{"id": "x", "importance": 9.0}], "edges": []},  # no label, bad importance
            "clusters": [{"name": "C", "summary": "s", "paper_ids": ["a"]}],
        }

    res = _run(_LLM(behaviour))
    assert res.cause == "real"  # overview + cluster survived
    assert res.synthesis.field_structure_generated is False
    assert len(res.synthesis.field_structure.nodes) > 0  # deterministic fallback present


def test_bad_edge_type_dropped_nodes_kept():
    async def behaviour(self, m, **kw):
        return {
            **_good_response(),
            "field_structure": {
                "nodes": [{"id": "r", "label": "Retrieval"}, {"id": "e", "label": "Eval"}],
                "edges": [{"source": "r", "target": "e", "type": "NONSENSE", "label": "x"}],
            },
        }

    res = _run(_LLM(behaviour))
    assert res.cause == "real"
    assert len(res.synthesis.field_structure.nodes) == 2
    assert res.synthesis.field_structure.edges == []


# --- Honest, observable degradation ----------------------------------------
def test_timeout_degrades_honestly():
    async def behaviour(self, m, **kw):
        await asyncio.sleep(5)
        return {}

    res = _run(_LLM(behaviour), timeout_seconds=1)
    assert res.cause == "timeout"
    assert res.degraded is True
    assert res.synthesis.field_overview == ""  # honest empty, labelled skeleton
    assert res.meta()["synthesis_method"] == "deterministic"


def test_unparseable_json_degrades_with_cause():
    async def behaviour(self, m, **kw):
        raise ValueError("LLM did not return valid JSON after retry")

    res = _run(_LLM(behaviour))
    assert res.cause == "json_parse"
    assert res.degraded is True


def test_validation_failure_degrades_with_cause():
    # A fundamentally wrong shape that salvage cannot rescue (no usable content).
    async def behaviour(self, m, **kw):
        return {"clusters": "not-a-list", "reading_path": 42, "field_structure": "nope"}

    res = _run(_LLM(behaviour))
    assert res.degraded is True
    assert res.cause in {"empty_fields", "validation"}


def test_empty_fields_degrades_with_cause():
    async def behaviour(self, m, **kw):
        return {"field_overview": "", "why_it_matters": "", "clusters": [], "reading_path": []}

    res = _run(_LLM(behaviour))
    assert res.cause == "empty_fields"
    assert res.degraded is True


def test_http_400_triggers_compact_retry_then_succeeds():
    state = {"n": 0}

    async def behaviour(self, m, **kw):
        state["n"] += 1
        if state["n"] == 1:
            raise LLMHTTPError(
                provider="deepseek",
                model="x",
                stage="synthesis",
                status_code=400,
                response_body_summary="context length exceeded",
                request_character_count=999999,
                approximate_prompt_tokens=250000,
            )
        return _good_response()

    llm = _LLM(behaviour)
    res = _run(llm)
    assert res.cause == "real"
    assert res.retry_used is True
    assert state["n"] == 2
    # The retry used the compact bundle (smaller prompt).
    assert llm.calls[1]["kw"]["stage"] == "synthesis_retry_compact"


def test_http_400_retry_also_fails_degrades_as_http_400():
    async def behaviour(self, m, **kw):
        raise LLMHTTPError(
            provider="deepseek",
            model="x",
            stage="synthesis",
            status_code=400,
            response_body_summary="context length exceeded",
            request_character_count=999999,
            approximate_prompt_tokens=250000,
        )

    res = _run(_LLM(behaviour))
    assert res.cause == "http_400"
    assert res.degraded is True
    assert res.retry_used is True


def test_non_400_http_error_degrades_as_http_error():
    async def behaviour(self, m, **kw):
        raise LLMHTTPError(
            provider="deepseek",
            model="x",
            stage="synthesis",
            status_code=503,
            response_body_summary="service unavailable",
            request_character_count=10,
            approximate_prompt_tokens=3,
        )

    res = _run(_LLM(behaviour))
    assert res.cause == "http_error"
    assert res.degraded is True


# --- Stub gating & no-papers -----------------------------------------------
def test_stub_provider_is_not_real_synthesis():
    class _Stub:
        name = "stub"

    res = _run(_Stub())
    assert res.cause == "stub"
    assert res.degraded is True


def test_no_papers_degrades_cleanly():
    res = asyncio.run(synthesise_with_meta(_LLM(None), topic="x", landscape_papers=[]))
    assert res.cause == "no_papers"
    assert res.degraded is True


# --- Compact bundle is genuinely smaller -----------------------------------
def test_compact_papers_json_is_smaller():
    full = build_papers_json(PAPERS, compact=False)
    compact = build_papers_json(PAPERS, compact=True)
    assert len(compact) < len(full)
    # Compact drops bulky grounding/list fields but keeps identity + key signals.
    assert "grounded_fields" not in compact
    assert '"paper_id"' in compact


# --- Backwards-compatible wrapper still returns a Synthesis ----------------
def test_synthesise_wrapper_returns_synthesis():
    async def behaviour(self, m, **kw):
        return _good_response()

    synth = asyncio.run(synthesise(_LLM(behaviour), topic="retrieval", landscape_papers=PAPERS))
    assert synth.field_overview == "Real overview about retrieval."


# --- DB-backed: identity-resolution telemetry on persist -------------------
def _db_available() -> bool:
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


dbonly = pytest.mark.skipif(not _db_available(), reason="requires Postgres")


@dbonly
def test_persist_synthesis_records_identity_resolution():
    """References by id resolve cleanly; a title reference is counted as a
    fallback and an unknown reference as unmatched — surfaced in telemetry."""
    import uuid

    run = uuid.uuid4().hex[:8]
    landscape_id = None
    paper_ids: list[str] = []
    try:
        with session_scope() as s:
            ls = Landscape(topic=f"synth-reliability-{run}", updated_at=datetime.utcnow())
            s.add(ls)
            s.flush()
            landscape_id = ls.id
            job = SearchJob(landscape_id=landscape_id)
            s.add(job)
            s.flush()
            job_id = job.id
            for ext_id, title in [(f"id-rel-a-{run}", "Paper Alpha"), (f"id-rel-b-{run}", "Paper Beta")]:
                p = Paper(source="test", external_id=ext_id, title=title)
                s.add(p)
                s.flush()
                paper_ids.append(p.id)
                s.add(LandscapePaper(landscape_id=landscape_id, paper_id=p.id, category="must-read"))

        pid_a, pid_b = paper_ids
        bundle = [
            {"paper_id": pid_a, "title": "Paper Alpha", "category": "must-read"},
            {"paper_id": pid_b, "title": "Paper Beta", "category": "useful"},
        ]
        synthesis_dict = {
            "clusters": [
                {
                    "name": "Core",
                    "summary": "core",
                    # one exact id, one by-title (fallback), one unknown (unmatched)
                    "paper_ids": [pid_a, "Paper Beta", "ghost-paper-id"],
                }
            ],
            "reading_path": [{"paper_id": pid_a, "title": "Paper Alpha", "why": "start"}],
            "paper_rationales": [{"paper_id": pid_a, "rationale": "Read first."}],
            "synthesis_quality": {"synthesis_cause": "real"},
        }
        _persist_synthesis(job_id, synthesis_dict, bundle)

        with session_scope() as s:
            ls = s.get(Landscape, landscape_id)
            ident = (ls.synthesis or {}).get("synthesis_quality", {}).get("identity_resolution")
        assert ident is not None
        assert ident["title_fallback"] >= 1  # "Paper Beta" resolved via title
        assert ident["unmatched"] >= 1  # "ghost-paper-id" never resolved
        assert ident["id_hit"] >= 2  # pid_a referenced by id in cluster + rationale/reading
    finally:
        if landscape_id is not None:
            with session_scope() as s:
                from app.models import Cluster, ClusterPaper

                cluster_ids = [
                    c.id for c in s.exec(select(Cluster).where(Cluster.landscape_id == landscape_id)).all()
                ]
                if cluster_ids:
                    for cp in s.exec(select(ClusterPaper).where(ClusterPaper.cluster_id.in_(cluster_ids))).all():
                        s.delete(cp)
                # Null the link FK before deleting clusters, then delete links.
                for link in s.exec(
                    select(LandscapePaper).where(LandscapePaper.landscape_id == landscape_id)
                ).all():
                    link.cluster_id = None
                    s.add(link)
                s.flush()
                for model, attr in ((Cluster, "landscape_id"), (LandscapePaper, "landscape_id")):
                    for row in s.exec(select(model).where(getattr(model, attr) == landscape_id)).all():
                        s.delete(row)
                for row in s.exec(select(SearchJob).where(SearchJob.landscape_id == landscape_id)).all():
                    s.delete(row)
                for pid in paper_ids:
                    p = s.get(Paper, pid)
                    if p:
                        s.delete(p)
                ls = s.get(Landscape, landscape_id)
                if ls:
                    s.delete(ls)
