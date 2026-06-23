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

from pydantic import BaseModel, ValidationError

from app.schemas import (
    ClusterOut,
    FieldEdge,
    FieldNode,
    FieldStructure,
    PaperRationale,
    ReadingPathStep,
    Synthesis,
)
from app.services.llm import LLMHTTPError, LLMProvider
from app.services.prompts import render


# When the full papers bundle overflows the model's context (HTTP 400) we retry
# with a compact bundle, mirroring extraction.py's compact-retry strategy.
COMPACT_PAPERS_LIMIT = 28


def build_papers_json(
    landscape_papers: list[dict[str, Any]],
    *,
    compact: bool = False,
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
    # ``compact`` caps the paper count and drops the bulkier list fields so the
    # prompt fits a smaller context window on the HTTP-400 retry.
    papers = landscape_papers[:COMPACT_PAPERS_LIMIT] if compact else landscape_papers
    trimmed = []
    for p in papers:
        ext = p.get("extraction") or {}
        grounding = (ext.get("_fieldmap") or {}).get("grounding") or {}
        row: dict[str, Any] = {
            "paper_id": p.get("paper_id"),
            "title": p.get("title"),
            "year": p.get("year"),
            "category": p.get("category"),
            "score": p.get("score"),
            "degraded": (ext.get("_fieldmap") or {}).get("degraded", False),
            "problem": ext.get("problem"),
            "method": ext.get("method"),
            "contribution": ext.get("contribution"),
            "novelty": ext.get("novelty"),
            "key_terms": ext.get("key_terms", []),
            "reading_priority": ext.get("reading_priority"),
        }
        if not compact:
            row.update(
                {
                    "fallback_reason": (ext.get("_fieldmap") or {}).get("fallback_reason"),
                    "grounded_fields": grounding.get("grounded_fields", 0),
                    "ungrounded_fields": grounding.get("ungrounded_fields", 0),
                    "average_grounding_confidence": grounding.get("average_grounding_confidence", 0.0),
                    "results": ext.get("results", [])[:4],
                    "limitations": ext.get("limitations", [])[:3],
                    "datasets": ext.get("datasets", []),
                    "benchmarks": ext.get("benchmarks", []),
                    "baselines": ext.get("baselines", []),
                    "metrics": ext.get("metrics", []),
                    "prerequisites": ext.get("prerequisites", []),
                    "related_papers": ext.get("related_papers", []),
                    "difficulty_level": ext.get("difficulty_level"),
                }
            )
        trimmed.append(row)
    indent = None if compact else 2
    return json.dumps(trimmed, ensure_ascii=False, indent=indent)


# Synthesis outcome causes surfaced to job telemetry. ``real`` = a genuine,
# LLM-authored synthesis; everything else is an honest, labelled degrade.
SYNTHESIS_CAUSES = {
    "real",  # LLM produced a usable synthesis
    "no_papers",  # nothing to synthesise
    "stub",  # offline/dev stub provider — never a real synthesis
    "json_parse",  # model returned unparseable JSON after the retry
    "validation",  # parsed JSON but the whole object failed even after salvage
    "timeout",  # exceeded synthesis_timeout_seconds
    "http_400",  # over-long prompt / bad request; compact retry also failed
    "http_error",  # other HTTP failure from the provider
    "empty_fields",  # parsed/validated but the LLM produced no usable content
    "error",  # unexpected exception
}


class SynthesisResult:
    """A synthesis plus structured telemetry about how it was produced.

    ``degraded`` is True whenever the output is not a genuine LLM synthesis, so
    callers can label the UI honestly and emit a job event naming ``cause``.
    """

    __slots__ = ("synthesis", "cause", "degraded", "salvaged_fields", "detail", "retry_used")

    def __init__(
        self,
        synthesis: Synthesis,
        *,
        cause: str,
        degraded: bool,
        salvaged_fields: Optional[list[str]] = None,
        detail: Optional[str] = None,
        retry_used: bool = False,
    ) -> None:
        self.synthesis = synthesis
        self.cause = cause
        self.degraded = degraded
        self.salvaged_fields = salvaged_fields or []
        self.detail = detail
        self.retry_used = retry_used

    def meta(self) -> dict[str, Any]:
        return {
            "synthesis_method": "deterministic" if self.degraded else "llm",
            "synthesis_cause": self.cause,
            "synthesis_degraded": self.degraded,
            "synthesis_salvaged_fields": self.salvaged_fields,
            "synthesis_retry_used": self.retry_used,
            "synthesis_detail": self.detail,
        }


async def synthesise(
    llm: LLMProvider,
    *,
    topic: str,
    landscape_papers: list[dict[str, Any]],
    strong_model: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
) -> Synthesis:
    """Backwards-compatible entry point returning just the ``Synthesis``.

    Prefer :func:`synthesise_with_meta` to obtain the quality telemetry.
    """
    result = await synthesise_with_meta(
        llm,
        topic=topic,
        landscape_papers=landscape_papers,
        strong_model=strong_model,
        timeout_seconds=timeout_seconds,
    )
    return result.synthesis


async def synthesise_with_meta(
    llm: LLMProvider,
    *,
    topic: str,
    landscape_papers: list[dict[str, Any]],
    strong_model: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
) -> SynthesisResult:
    skeleton = _deterministic_skeleton(landscape_papers)
    if not landscape_papers:
        return SynthesisResult(skeleton, cause="no_papers", degraded=True)

    # The offline stub never produces a real synthesis; degrade honestly rather
    # than dressing its placeholder JSON up as a genuine landscape.
    if getattr(llm, "name", "") == "stub":
        return SynthesisResult(skeleton, cause="stub", degraded=True)

    raw, fetch_meta = await _fetch_synthesis_json(
        llm,
        topic=topic,
        landscape_papers=landscape_papers,
        strong_model=strong_model,
        timeout_seconds=timeout_seconds,
    )
    if raw is None:
        return SynthesisResult(
            skeleton,
            cause=fetch_meta["cause"],
            degraded=True,
            detail=fetch_meta.get("detail"),
            retry_used=fetch_meta.get("retry_used", False),
        )

    synth, salvaged = _validate_with_salvage(raw, skeleton)
    if synth is None:
        return SynthesisResult(
            skeleton,
            cause="validation",
            degraded=True,
            detail="response failed validation even after partial salvage",
            retry_used=fetch_meta.get("retry_used", False),
        )

    # The DAG is "generated" only if the LLM authored at least one VALID node.
    # We read this straight off the raw response (validating nodes individually)
    # so the deterministic fallback that _merge_with_skeleton / salvage inject is
    # never mistaken for an LLM-authored structure.
    fs_raw = raw.get("field_structure") if isinstance(raw, dict) else None
    llm_authored_fs = bool(_validate_each(fs_raw.get("nodes"), FieldNode)) if isinstance(fs_raw, dict) else False

    result = _merge_with_skeleton(synth, skeleton)
    data = result.model_dump()
    data["field_structure_generated"] = llm_authored_fs and bool(
        (data.get("field_structure") or {}).get("nodes")
    )
    final = Synthesis.model_validate(data)

    # Honest "did we actually synthesise anything?" check: a real synthesis must
    # have at least overview prose OR clusters OR a reading path the LLM authored.
    has_real_content = bool(
        _clean_field(final.field_overview)
        or final.clusters
        or final.reading_path
        or data["field_structure_generated"]
    )
    if not has_real_content:
        return SynthesisResult(
            final,
            cause="empty_fields",
            degraded=True,
            salvaged_fields=salvaged,
            detail="model returned no usable overview/clusters/reading-path/structure",
            retry_used=fetch_meta.get("retry_used", False),
        )

    return SynthesisResult(
        final,
        cause="real",
        degraded=False,
        salvaged_fields=salvaged,
        retry_used=fetch_meta.get("retry_used", False),
    )


async def _fetch_synthesis_json(
    llm: LLMProvider,
    *,
    topic: str,
    landscape_papers: list[dict[str, Any]],
    strong_model: Optional[str],
    timeout_seconds: Optional[int],
) -> tuple[Optional[dict[str, Any]], dict[str, Any]]:
    """Call the LLM, with a compact retry on HTTP 400 (over-long prompt).

    Returns ``(raw_json_or_None, meta)``; ``meta['cause']`` names the failure
    when ``raw`` is None (timeout / http_400 / http_error / json_parse / error).
    """

    async def _call(compact: bool, stage: str) -> dict[str, Any]:
        user_prompt = render(
            "synthesis",
            topic=topic,
            papers_json=build_papers_json(landscape_papers, compact=compact),
        )
        messages = [
            {"role": "system", "content": "You are a research-landscape synthesiser. Output valid JSON only."},
            {"role": "user", "content": user_prompt},
        ]
        call = llm.complete_json(messages, model=strong_model, stage=stage)
        if timeout_seconds:
            return await asyncio.wait_for(call, timeout=timeout_seconds)
        return await call

    try:
        raw = await _call(compact=False, stage="synthesis")
        return raw, {"cause": "real", "retry_used": False}
    except asyncio.TimeoutError:
        return None, {"cause": "timeout", "detail": f"exceeded {timeout_seconds}s", "retry_used": False}
    except LLMHTTPError as e:
        if e.status_code == 400:
            # Over-long prompt / bad request — retry with a compact bundle.
            try:
                raw = await _call(compact=True, stage="synthesis_retry_compact")
                return raw, {"cause": "real", "retry_used": True}
            except asyncio.TimeoutError:
                return None, {"cause": "timeout", "detail": "compact retry timed out", "retry_used": True}
            except Exception as retry_e:  # noqa: BLE001
                return None, {
                    "cause": "http_400",
                    "detail": f"compact retry failed: {_safe_error(retry_e)}",
                    "retry_used": True,
                }
        return None, {"cause": "http_error", "detail": f"HTTP {e.status_code}", "retry_used": False}
    except ValueError as e:
        # complete_json raises ValueError when JSON can't be parsed after retry.
        return None, {"cause": "json_parse", "detail": _safe_error(e), "retry_used": False}
    except Exception as e:  # noqa: BLE001
        return None, {"cause": "error", "detail": _safe_error(e), "retry_used": False}


def _safe_error(e: BaseException) -> str:
    return f"{type(e).__name__}: {e}"[:300]


def _validate_each(items: Any, model: type[BaseModel]) -> list[dict[str, Any]]:
    """Validate a list item-by-item, keeping only the ones that pass.

    This is the core of partial-field salvage: one malformed cluster / reading
    step / node / edge no longer sinks the entire synthesis.
    """
    out: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return out
    for item in items:
        try:
            out.append(model.model_validate(item).model_dump())
        except ValidationError:
            continue
    return out


def _validate_with_salvage(
    raw: dict[str, Any],
    skeleton: Synthesis,
) -> tuple[Optional[Synthesis], list[str]]:
    """Validate the synthesis, salvaging good nested items if the whole fails.

    Returns ``(synthesis_or_None, salvaged_field_names)``. First tries strict
    validation; on failure, rebuilds from the skeleton, copying scalar/string
    fields wholesale and filtering each list field item-by-item so partial LLM
    output survives.
    """
    try:
        return Synthesis.model_validate(raw), []
    except ValidationError:
        pass
    if not isinstance(raw, dict):
        return None, []

    base = skeleton.model_dump()
    salvaged: list[str] = []

    # Scalar / free-text fields: copy if the LLM provided a non-empty value.
    for key in ("field_overview", "why_it_matters", "content_quality"):
        if isinstance(raw.get(key), str) and raw[key].strip():
            base[key] = raw[key]
            salvaged.append(key)

    # Plain string-list fields.
    for key in (
        "must_read_paper_ids",
        "prerequisites",
        "datasets_benchmarks",
        "tensions",
        "open_problems",
        "project_ideas",
        "skip_for_now",
    ):
        val = raw.get(key)
        if isinstance(val, list):
            cleaned = [str(x) for x in val if str(x).strip()]
            if cleaned:
                base[key] = cleaned
                salvaged.append(key)

    # Structured list fields: validate each item, drop the bad ones.
    item_models: list[tuple[str, type[BaseModel]]] = [
        ("clusters", ClusterOut),
        ("reading_path", ReadingPathStep),
        ("paper_rationales", PaperRationale),
    ]
    for key, model in item_models:
        good = _validate_each(raw.get(key), model)
        if good:
            base[key] = good
            salvaged.append(key)

    # method_timeline is a list[dict]; keep dict items as-is.
    if isinstance(raw.get("method_timeline"), list):
        tl = [x for x in raw["method_timeline"] if isinstance(x, dict)]
        if tl:
            base["method_timeline"] = tl
            salvaged.append("method_timeline")

    # field_structure: salvage nodes/edges independently.
    fs = raw.get("field_structure")
    if isinstance(fs, dict):
        nodes = _validate_each(fs.get("nodes"), FieldNode)
        node_ids = {n["id"] for n in nodes}
        edges = [
            e
            for e in _validate_each(fs.get("edges"), FieldEdge)
            if e["source"] in node_ids and e["target"] in node_ids and e["source"] != e["target"]
        ]
        if nodes:
            base["field_structure"] = {"nodes": nodes, "edges": edges}
            salvaged.append("field_structure")

    try:
        return Synthesis.model_validate(base), salvaged
    except ValidationError:
        return None, salvaged


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
        field_structure_generated=False,
        clusters=[],
        must_read_paper_ids=must_read_ids,
        reading_path=[],
        paper_rationales=_deterministic_paper_rationales(landscape_papers),
        prerequisites=[k for k, _ in prereq_counter.most_common(10)],
        datasets_benchmarks=[k for k, _ in datasets_counter.most_common(15)],
        method_timeline=[],
        tensions=[],
        open_problems=[],
        project_ideas=[],
        skip_for_now=[p["paper_id"] for p in landscape_papers if p.get("category") == "skip-for-now"],
    )


def _clean_field(value: Any) -> str:
    s = str(value or "").strip()
    return "" if s.lower() in {"", "not reported", "not reported."} else s


def _deterministic_paper_rationales(landscape_papers: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Honest, extraction-derived 'why read / why skip' per paper.

    Used without an LLM (and as backfill). The real synthesis prompt replaces
    these with grounded one-liners.
    """
    out: list[dict[str, str]] = []
    for p in landscape_papers:
        pid = p.get("paper_id")
        if not pid:
            continue
        ext = p.get("extraction") or {}
        category = p.get("category")
        focus = _clean_field(ext.get("contribution")) or _clean_field(ext.get("method")) or _clean_field(ext.get("problem"))
        focus = focus[:160]
        if category == "skip-for-now":
            rationale = "Lower priority for this topic" + (f" — centres on {focus}" if focus else ".")
        elif category == "must-read":
            rationale = ("Start here: " + focus) if focus else "Central to the topic — read early."
        else:
            rationale = focus or "Relevant supporting work for this topic."
        out.append({"paper_id": pid, "rationale": rationale})
    return out


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
