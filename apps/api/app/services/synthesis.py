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

import json
from collections import Counter
from typing import Any, Optional

from pydantic import ValidationError

from app.schemas import Synthesis
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
                "prerequisites": ext.get("prerequisites", []),
                "key_terms": ext.get("key_terms", []),
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
        raw = await llm.complete_json(messages, model=strong_model)
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
        for x in ext.get("datasets", []) or []:
            datasets_counter[x.strip()] += 1
        for x in ext.get("benchmarks", []) or []:
            datasets_counter[x.strip()] += 1

    content_quality = "ok"
    if degraded_count >= max(1, (len(landscape_papers) // 2) + 1):
        content_quality = "degraded"
    elif total_ungrounded > total_grounded:
        content_quality = "weakly_grounded"

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
    return Synthesis.model_validate(d)
