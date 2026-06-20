"""Landscape synthesis.

Consumes the per-paper extracted JSONs (not raw PDFs) and produces a
Synthesis object: overview, clusters, must-read list, reading path,
prerequisites, datasets, timeline, tensions, open problems, project
ideas, skip-for-now.

A deterministic skeleton is always computed from the extractions even
when the LLM call fails or returns garbage, so the landscape page is
never empty.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections import Counter
from typing import Any, Optional

from pydantic import ValidationError

from app.schemas import FieldStructure, Synthesis
from app.services.llm import LLMProvider
from app.services.prompts import render


def build_papers_json(
    landscape_papers: list[dict[str, Any]],
) -> str:
    """Serialize the per-paper bundle that the synthesis prompt consumes.

    ``landscape_papers`` items have shape::
        {
            "paper_id": "...",
            "title": "...",
            "year": 2024,
            "category": "must-read",
            "score": 0.83,
            "extraction": {...}  # may be partial
        }
    """
    trimmed = []
    for p in landscape_papers:
        ext = p.get("extraction") or {}
        grounding = (ext.get("_fieldmap") or {}).get("grounding") or {}
        trimmed.append(
            {
                "paper_id": p.get("paper_id"),
                "title": p.get("title"),
                "year": p.get("year"),
                "category": p.get("category"),
                "score": p.get("score"),
                "degraded": (ext.get("_fieldmap") or {}).get("degraded", False),
                "fallback_reason": (ext.get("_fieldmap") or {}).get("fallback_reason"),
                "grounded_fields": grounding.get("grounded_fields", 0),
                "ungrounded_fields": grounding.get("ungrounded_fields", 0),
                "average_grounding_confidence": grounding.get("average_grounding_confidence", 0.0),
                "problem": ext.get("problem"),
                "method": ext.get("method"),
                "contribution": ext.get("contribution"),
                "novelty": ext.get("novelty"),
                "results": ext.get("results", [])[:4],
                "limitations": ext.get("limitations", [])[:3],
                "datasets": ext.get("datasets", []),
                "benchmarks": ext.get("benchmarks", []),
                "baselines": ext.get("baselines", []),
                "metrics": ext.get("metrics", []),
                "prerequisites": ext.get("prerequisites", []),
                "key_terms": ext.get("key_terms", []),
                "related_papers": ext.get("related_papers", []),
                "reading_priority": ext.get("reading_priority"),
                "difficulty_level": ext.get("difficulty_level"),
            }
        )
    return json.dumps(trimmed, ensure_ascii=False, indent=2)


async def synthesise(
    llm: LLMProvider,
    *,
    topic: str,
    landscape_papers: list[dict[str, Any]],
    strong_model: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
) -> Synthesis:
    skeleton = _deterministic_skeleton(landscape_papers)
    if not landscape_papers:
        return skeleton

    user_prompt = render(
        "synthesis",
        topic=topic,
        papers_json=build_papers_json(landscape_papers),
    )
    messages = [
        {"role": "system", "content": "You are a research-landscape synthesiser. Output valid JSON only."},
        {"role": "user", "content": user_prompt},
    ]

    try:
        call = llm.complete_json(messages, model=strong_model, stage="synthesis")
        raw = await asyncio.wait_for(call, timeout=timeout_seconds) if timeout_seconds else await call
        try:
            synth = Synthesis.model_validate(raw)
        except ValidationError:
            merged = skeleton.model_dump()
            for k in merged.keys():
                if k in raw:
                    merged[k] = raw[k]
            synth = Synthesis.model_validate(merged)
        return _merge_with_skeleton(synth, skeleton)
    except Exception:  # noqa: BLE001
        return skeleton


def _deterministic_skeleton(landscape_papers: list[dict[str, Any]]) -> Synthesis:
    """Always produce something useful even without an LLM."""
    must_read_ids = [p["paper_id"] for p in landscape_papers if p.get("category") == "must-read"]
    prereq_counter: Counter[str] = Counter()
    key_term_counter: Counter[str] = Counter()
    datasets_counter: Counter[str] = Counter()
    total_grounded = 0
    total_ungrounded = 0
    degraded_count = 0
    for p in landscape_papers:
        ext = p.get("extraction") or {}
        meta = ext.get("_fieldmap") or {}
        grounding = meta.get("grounding") or {}
        total_grounded += int(grounding.get("grounded_fields") or 0)
        total_ungrounded += int(grounding.get("ungrounded_fields") or 0)
        degraded_count += 1 if meta.get("degraded") else 0
        for x in ext.get("prerequisites", []) or []:
            prereq_counter[x.strip()] += 1
        for x in ext.get("key_terms", []) or []:
            key_term_counter[x.strip()] += 1
        for x in ext.get("datasets", []) or []:
            datasets_counter[x.strip()] += 1
        for x in ext.get("benchmarks", []) or []:
            datasets_counter[x.strip()] += 1

    content_quality = "ok"
    if degraded_count >= max(1, (len(landscape_papers) // 2) + 1):
        content_quality = "degraded"
    elif total_ungrounded > total_grounded:
        content_quality = "weakly_grounded"

    field_structure = build_fallback_field_structure(
        landscape_papers,
        prerequisites=[k for k, _ in prereq_counter.most_common(10)],
        key_terms=[k for k, _ in key_term_counter.most_common(12)],
        datasets_benchmarks=[k for k, _ in datasets_counter.most_common(12)],
    )

    return Synthesis(
        field_overview="",
        why_it_matters="",
        content_quality=content_quality,
        extraction_quality={
            "grounded_fields": total_grounded,
            "ungrounded_fields": total_ungrounded,
            "degraded_extractions": degraded_count,
            "total_extractions": len(landscape_papers),
        },
        field_structure=field_structure,
        clusters=[],
        must_read_paper_ids=must_read_ids,
        reading_path=[],
        prerequisites=[k for k, _ in prereq_counter.most_common(10)],
        datasets_benchmarks=[k for k, _ in datasets_counter.most_common(15)],
        method_timeline=[],
        tensions=[],
        open_problems=[],
        project_ideas=[],
        skip_for_now=[p["paper_id"] for p in landscape_papers if p.get("category") == "skip-for-now"],
    )


def _merge_with_skeleton(synth: Synthesis, skel: Synthesis) -> Synthesis:
    """Backfill any empty fields in the LLM output from the deterministic skeleton."""
    d = synth.model_dump()
    s = skel.model_dump()
    for k, v in s.items():
        if not d.get(k):
            d[k] = v
    if not (d.get("field_structure") or {}).get("nodes"):
        d["field_structure"] = build_fallback_field_structure_from_synthesis(d).model_dump()
    return Synthesis.model_validate(d)


def build_fallback_field_structure_from_synthesis(synthesis: dict[str, Any]) -> FieldStructure:
    clusters = synthesis.get("clusters") or []
    pseudo_papers = []
    for c in clusters:
        pseudo_papers.append(
            {
                "paper_id": c.get("id") or c.get("name") or "cluster",
                "title": c.get("name") or "Cluster",
                "category": "useful",
                "score": 0.6,
                "extraction": {
                    "key_terms": [c.get("name")] if c.get("name") else [],
                    "prerequisites": synthesis.get("prerequisites") or [],
                    "datasets": synthesis.get("datasets_benchmarks") or [],
                    "benchmarks": [],
                },
            }
        )
    return build_fallback_field_structure(
        pseudo_papers,
        prerequisites=synthesis.get("prerequisites") or [],
        key_terms=[c.get("name") for c in clusters if c.get("name")],
        datasets_benchmarks=synthesis.get("datasets_benchmarks") or [],
    )


def build_fallback_field_structure(
    landscape_papers: list[dict[str, Any]],
    *,
    prerequisites: list[str],
    key_terms: list[str],
    datasets_benchmarks: list[str],
) -> FieldStructure:
    """Deterministic field DAG from common extracted concepts."""
    nodes_by_id: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []

    def add_node(label: str, typ: str, description: str | None = None, importance: float | None = None) -> str | None:
        clean = " ".join(str(label or "").split())
        if not clean:
            return None
        node_id = _node_id(clean)
        if node_id not in nodes_by_id:
            nodes_by_id[node_id] = {
                "id": node_id,
                "label": clean,
                "type": typ,
                "description": description,
                "importance": importance,
            }
        elif importance is not None:
            prev = nodes_by_id[node_id].get("importance")
            nodes_by_id[node_id]["importance"] = max(float(prev or 0), importance)
        return node_id

    core_id = add_node("Field foundations", "foundation", "Prerequisites and shared concepts", 1.0)
    method_id = add_node("Methods and systems", "method", "Core methods used across selected papers", 0.85)
    eval_id = add_node("Evaluation", "evaluation", "Datasets, benchmarks, metrics, and empirical comparisons", 0.8)

    for i, prereq in enumerate(prerequisites[:8]):
        nid = add_node(prereq, "prerequisite", importance=max(0.35, 0.8 - i * 0.04))
        if core_id and nid:
            edges.append(_edge(nid, core_id, "prerequisite", "prepares", "Extracted as a prerequisite."))

    for i, term in enumerate(key_terms[:10]):
        nid = add_node(term, "concept", importance=max(0.3, 0.75 - i * 0.035))
        if core_id and nid:
            edges.append(_edge(core_id, nid, "builds_to", "enables", "Core field concept from extracted key terms."))
        if method_id and nid:
            edges.append(_edge(nid, method_id, "related", "informs", "Concept appears in method-oriented paper notes."))

    for i, ds in enumerate(datasets_benchmarks[:10]):
        nid = add_node(ds, "benchmark", importance=max(0.3, 0.7 - i * 0.03))
        if method_id and eval_id:
            edges.append(_edge(method_id, eval_id, "evaluation_flow", "evaluated by", "Methods are compared through evaluation artifacts."))
        if eval_id and nid:
            edges.append(_edge(eval_id, nid, "subfield", "uses", "Extracted dataset, benchmark, or metric."))

    # Ensure every selected paper can contribute at least one method/concept node.
    for p in sorted(landscape_papers, key=lambda x: float(x.get("score") or 0), reverse=True)[:6]:
        ext = p.get("extraction") or {}
        label = (ext.get("key_terms") or [p.get("title")])[0]
        nid = add_node(str(label), "concept", description=p.get("title"), importance=min(1.0, float(p.get("score") or 0.5)))
        if method_id and nid:
            edges.append(_edge(method_id, nid, "related", "seen in", f"Representative paper: {p.get('title')}."))

    valid_ids = set(nodes_by_id)
    deduped_edges: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str, str]] = set()
    for e in edges:
        key = (e["source"], e["target"], e["type"])
        if e["source"] in valid_ids and e["target"] in valid_ids and e["source"] != e["target"] and key not in seen_edges:
            seen_edges.add(key)
            deduped_edges.append(e)

    return FieldStructure.model_validate(
        {
            "nodes": sorted(nodes_by_id.values(), key=lambda n: (str(n.get("type") or ""), str(n.get("label") or ""))),
            "edges": sorted(deduped_edges, key=lambda e: (e["source"], e["target"], e["type"])),
        }
    )


def _node_id(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return slug[:60] or "node"


def _edge(source: str, target: str, typ: str, label: str, rationale: str) -> dict[str, str]:
    return {"source": source, "target": target, "type": typ, "label": label, "rationale": rationale}
