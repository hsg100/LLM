"""Concept glossary generation, persistence, maps, and safe text annotation."""

from __future__ import annotations

import asyncio
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from slugify import slugify
from sqlmodel import Session, select

from app.models import Concept
from app.services.llm import LLMProvider


GENERIC_TERMS = {
    "approach",
    "data",
    "dataset",
    "evaluation",
    "method",
    "model",
    "paper",
    "result",
    "results",
    "system",
    "task",
}

SOURCE_WEIGHTS = {
    "key_terms": 1.0,
    "prerequisites": 0.85,
    "mathematical_ideas": 0.9,
    "datasets": 0.7,
    "benchmarks": 0.75,
    "baselines": 0.55,
    "metrics": 0.75,
    "field_structure": 1.05,
    "clusters": 0.7,
}


@dataclass
class ConceptCandidate:
    term: str
    slug: str
    aliases: set[str] = field(default_factory=set)
    paper_ids: set[str] = field(default_factory=set)
    source_counts: Counter[str] = field(default_factory=Counter)
    snippets: list[dict[str, Any]] = field(default_factory=list)
    importance: float = 0.0


def concept_slug(term: str) -> str:
    return slugify(_clean_term(term))[:80] or "concept"


def is_generic_term(term: str) -> bool:
    clean = _clean_term(term).lower()
    if not clean:
        return True
    words = clean.split()
    if len(words) == 1 and clean in GENERIC_TERMS:
        return True
    if len(words) > 8:
        return True
    if len(clean) < 3:
        return True
    return False


def dedupe_terms(terms: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for term in terms:
        clean = _clean_term(term)
        if is_generic_term(clean):
            continue
        slug = concept_slug(clean)
        if slug in seen:
            continue
        seen.add(slug)
        out.append(clean)
    return out


async def generate_concept_glossary(
    llm: LLMProvider,
    *,
    topic: str,
    landscape_papers: list[dict[str, Any]],
    synthesis: dict[str, Any],
    max_concepts: int = 36,
    timeout_seconds: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    candidates = collect_concept_candidates(landscape_papers, synthesis, max_candidates=max_concepts)
    meta: dict[str, Any] = {
        "candidate_terms_found": len(candidates),
        "llm_definitions_used": False,
        "degraded": False,
    }
    concepts = [_fallback_definition(c, topic=topic) for c in candidates]
    if not concepts:
        return [], meta

    if getattr(llm, "name", "") == "stub":
        meta["degraded"] = True
        meta["fallback_reason"] = "stub_llm"
        return concepts, meta

    try:
        call = _define_with_llm(llm, topic=topic, concepts=concepts, landscape_papers=landscape_papers)
        definitions = await asyncio.wait_for(call, timeout=timeout_seconds) if timeout_seconds else await call
        concepts = _merge_llm_definitions(concepts, definitions)
        meta["llm_definitions_used"] = True
    except Exception as e:  # noqa: BLE001
        meta["degraded"] = True
        meta["fallback_reason"] = f"{type(e).__name__}: {str(e)[:180]}"
    return concepts, meta


def collect_concept_candidates(
    landscape_papers: list[dict[str, Any]],
    synthesis: dict[str, Any],
    *,
    max_candidates: int = 36,
) -> list[ConceptCandidate]:
    by_slug: dict[str, ConceptCandidate] = {}

    def add(term: str, source: str, paper_id: str | None = None, snippet: str | None = None, importance: float = 0.0) -> None:
        clean = _clean_term(term)
        if is_generic_term(clean):
            return
        slug = concept_slug(clean)
        cand = by_slug.get(slug)
        if cand is None:
            cand = ConceptCandidate(term=clean, slug=slug)
            by_slug[slug] = cand
        if clean.lower() != cand.term.lower():
            cand.aliases.add(clean)
        if paper_id:
            cand.paper_ids.add(paper_id)
        cand.source_counts[source] += 1
        cand.importance = max(cand.importance, importance)
        if snippet:
            cand.snippets.append(
                {
                    "paper_id": paper_id,
                    "source": source,
                    "quote": " ".join(snippet.split())[:500],
                    "confidence": 0.55,
                }
            )

    for p in landscape_papers:
        pid = p.get("paper_id")
        ext = p.get("extraction") or {}
        for source in ["key_terms", "prerequisites", "mathematical_ideas", "datasets", "benchmarks", "baselines", "metrics"]:
            for item in ext.get(source) or []:
                add(str(item), source, paper_id=pid, snippet=_snippet_for_term(str(item), ext), importance=float(p.get("score") or 0.5))

    field_structure = (synthesis or {}).get("field_structure") or {}
    for node in field_structure.get("nodes") or []:
        label = node.get("label") if isinstance(node, dict) else None
        typ = node.get("type") if isinstance(node, dict) else None
        if typ in {"concept", "foundation", "prerequisite", "method", "evaluation", "benchmark", "dataset", "metric", "subfield"}:
            add(str(label or ""), "field_structure", importance=float(node.get("importance") or 0.55))

    for c in (synthesis or {}).get("clusters") or []:
        if isinstance(c, dict):
            add(str(c.get("name") or ""), "clusters", snippet=c.get("summary") or "", importance=0.55)

    scored = sorted(by_slug.values(), key=_candidate_score, reverse=True)
    return scored[:max_candidates]


def persist_concepts(s: Session, landscape_id: str, concepts: list[dict[str, Any]]) -> int:
    existing = s.exec(select(Concept).where(Concept.landscape_id == landscape_id)).all()
    by_slug = {((c.slug or concept_slug(c.name)).lower()): c for c in existing}
    keep: set[str] = set()
    count = 0
    for item in concepts:
        term = _clean_term(item.get("term") or item.get("name") or "")
        if not term:
            continue
        slug = item.get("slug") or concept_slug(term)
        keep.add(slug)
        row = by_slug.get(slug)
        if row is None:
            row = Concept(landscape_id=landscape_id, name=term)
        row.name = term
        row.term = term
        row.slug = slug
        row.aliases = _clean_list(item.get("aliases") or [])
        row.short_definition = str(item.get("short_definition") or item.get("definition") or "").strip()
        row.long_definition = str(item.get("long_definition") or row.short_definition or "").strip()
        row.why_it_matters = str(item.get("why_it_matters") or "").strip()
        row.related_terms = _clean_list(item.get("related_terms") or [])
        row.paper_ids = _clean_string_list(item.get("paper_ids") or [])
        row.source_grounding = [g for g in item.get("source_grounding") or [] if isinstance(g, dict)]
        row.confidence = _clamp(float(item.get("confidence") or 0.5))
        row.importance = _clamp(float(item.get("importance") or 0.5))
        row.definition = row.short_definition or row.long_definition or None
        s.add(row)
        count += 1

    for row in existing:
        slug = (row.slug or concept_slug(row.name)).lower()
        if slug not in keep:
            s.delete(row)
    return count


def concept_to_dict(c: Concept) -> dict[str, Any]:
    term = c.term or c.name
    short = c.short_definition or c.definition or ""
    return {
        "id": c.id,
        "landscape_id": c.landscape_id,
        "term": term,
        "slug": c.slug or concept_slug(term),
        "aliases": c.aliases or [],
        "short_definition": short,
        "long_definition": c.long_definition or short,
        "why_it_matters": c.why_it_matters or "",
        "related_terms": c.related_terms or [],
        "paper_ids": c.paper_ids or [],
        "source_grounding": c.source_grounding or [],
        "confidence": _clamp(float(c.confidence or 0.0)),
        "importance": _clamp(float(c.importance or 0.0)),
    }


def build_concept_map(concepts: list[dict[str, Any]]) -> dict[str, Any]:
    by_term = {c["term"].lower(): c for c in concepts}
    by_slug = {c["slug"]: c for c in concepts}
    nodes = [{"id": c["slug"], "label": c["term"], "type": "concept"} for c in concepts]
    edges: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for c in concepts:
        for related in c.get("related_terms") or []:
            target = by_term.get(str(related).lower()) or by_slug.get(concept_slug(str(related)))
            if not target or target["slug"] == c["slug"]:
                continue
            key = tuple(sorted([c["slug"], target["slug"]]))
            if key in seen:
                continue
            seen.add(key)
            edges.append({"source": c["slug"], "target": target["slug"], "type": "related"})
    return {"nodes": nodes, "edges": sorted(edges, key=lambda e: (e["source"], e["target"]))}


def annotate_text(
    text: str,
    concepts: list[dict[str, Any]],
    *,
    confidence_threshold: float = 0.55,
    max_highlights: int = 24,
) -> list[dict[str, Any]]:
    if not text:
        return [{"type": "text", "text": ""}]
    matchers = _concept_matchers(concepts, confidence_threshold=confidence_threshold)
    if not matchers:
        return [{"type": "text", "text": text}]

    protected = _protected_ranges(text)
    paragraphs = _paragraph_ranges(text)
    matches: list[tuple[int, int, dict[str, Any]]] = []
    occupied: list[tuple[int, int]] = []
    seen_by_paragraph: set[tuple[int, str]] = set()

    for pattern, concept in matchers:
        for m in pattern.finditer(text):
            start, end = m.span()
            if len(matches) >= max_highlights:
                break
            if _range_overlaps(start, end, protected) or _range_overlaps(start, end, occupied):
                continue
            para_idx = _paragraph_index(start, paragraphs)
            seen_key = (para_idx, concept["slug"])
            if seen_key in seen_by_paragraph:
                continue
            seen_by_paragraph.add(seen_key)
            occupied.append((start, end))
            matches.append((start, end, concept))

    if not matches:
        return [{"type": "text", "text": text}]

    out: list[dict[str, Any]] = []
    pos = 0
    for start, end, concept in sorted(matches, key=lambda x: x[0]):
        if start > pos:
            out.append({"type": "text", "text": text[pos:start]})
        out.append(
            {
                "type": "concept",
                "text": text[start:end],
                "concept_slug": concept["slug"],
                "definition": concept.get("short_definition") or "",
            }
        )
        pos = end
    if pos < len(text):
        out.append({"type": "text", "text": text[pos:]})
    return out


def link_concepts_in_markdown(text: str, concepts: list[dict[str, Any]]) -> str:
    segments = annotate_text(text, concepts, max_highlights=18)
    linked = []
    by_slug = {c["slug"]: c for c in concepts}
    for seg in segments:
        if seg["type"] != "concept":
            linked.append(seg["text"])
            continue
        concept = by_slug.get(seg.get("concept_slug") or "")
        label = _obsidian_concept_label(concept["term"] if concept else seg["text"])
        linked.append(f"[[{label}]]")
    return "".join(linked)


def _fallback_definition(c: ConceptCandidate, *, topic: str) -> dict[str, Any]:
    sources = sorted(c.source_counts)
    confidence = 0.58 + min(0.22, len(c.paper_ids) * 0.04) + min(0.1, sum(c.source_counts.values()) * 0.015)
    if c.source_counts.get("field_structure"):
        confidence += 0.05
    return {
        "term": c.term,
        "slug": c.slug,
        "aliases": sorted(c.aliases),
        "short_definition": f"A recurring concept in this {topic} landscape.",
        "long_definition": (
            f"{c.term} appears across the selected papers or field structure for {topic}. "
            "FieldMap marked it as useful background for reading the landscape; review the linked papers for the exact usage."
        ),
        "why_it_matters": "Understanding it should make the surrounding methods, evaluations, or research questions easier to follow.",
        "related_terms": [],
        "paper_ids": sorted(c.paper_ids),
        "source_grounding": c.snippets[:4],
        "confidence": round(_clamp(confidence), 2),
        "importance": round(_clamp(max(c.importance, _candidate_score(c) / 6.0)), 2),
        "sources": sources,
    }


async def _define_with_llm(
    llm: LLMProvider,
    *,
    topic: str,
    concepts: list[dict[str, Any]],
    landscape_papers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    papers = [
        {
            "paper_id": p.get("paper_id"),
            "title": p.get("title"),
            "abstract": (p.get("abstract") or "")[:900],
            "key_terms": ((p.get("extraction") or {}).get("key_terms") or [])[:8],
        }
        for p in landscape_papers[:8]
    ]
    prompt = {
        "topic": topic,
        "concepts": [
            {
                "term": c["term"],
                "aliases": c.get("aliases") or [],
                "paper_ids": c.get("paper_ids") or [],
                "source_grounding": c.get("source_grounding") or [],
            }
            for c in concepts
        ],
        "papers": papers,
        "instructions": (
            "Return JSON with key concepts. For each concept include term, short_definition "
            "(one sentence), long_definition (2-5 concise sentences), why_it_matters "
            "(1-3 sentences), related_terms, confidence. Be beginner-friendly and do not invent "
            "highly specific claims without evidence."
        ),
    }
    raw = await llm.complete_json(
        [
            {"role": "system", "content": "You define technical concepts from research notes. Output valid JSON only."},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        max_tokens=5000,
        stage="concept_generation",
    )
    return raw.get("concepts") if isinstance(raw.get("concepts"), list) else []


def _merge_llm_definitions(base: list[dict[str, Any]], definitions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_slug = {concept_slug(d.get("term") or ""): d for d in definitions if isinstance(d, dict)}
    out = []
    for item in base:
        d = by_slug.get(item["slug"])
        if not d:
            out.append(item)
            continue
        merged = dict(item)
        for key in ["short_definition", "long_definition", "why_it_matters"]:
            if str(d.get(key) or "").strip():
                merged[key] = str(d[key]).strip()
        if isinstance(d.get("related_terms"), list):
            merged["related_terms"] = dedupe_terms([str(x) for x in d["related_terms"]])[:8]
        if d.get("confidence") is not None:
            merged["confidence"] = round(_clamp(float(d["confidence"])), 2)
        out.append(merged)
    return out


def _concept_matchers(concepts: list[dict[str, Any]], *, confidence_threshold: float) -> list[tuple[re.Pattern[str], dict[str, Any]]]:
    terms: list[tuple[str, dict[str, Any]]] = []
    for c in concepts:
        if float(c.get("confidence") or 0) < confidence_threshold:
            continue
        for term in [c.get("term"), *(c.get("aliases") or [])]:
            clean = _clean_term(str(term or ""))
            if clean and not is_generic_term(clean):
                terms.append((clean, c))
    terms.sort(key=lambda x: len(x[0]), reverse=True)
    out = []
    seen: set[tuple[str, str]] = set()
    for term, concept in terms:
        key = (concept["slug"], term.lower())
        if key in seen:
            continue
        seen.add(key)
        escaped = re.escape(term).replace(r"\ ", r"\s+")
        out.append((re.compile(rf"(?<![\w-]){escaped}(?![\w-])", re.IGNORECASE), concept))
    return out


def _protected_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    patterns = [
        re.compile(r"```.*?```", re.DOTALL),
        re.compile(r"`[^`\n]+`"),
        re.compile(r"\[[^\]]+\]\([^)]+\)"),
        re.compile(r"(?m)^#{1,6}\s.*$"),
    ]
    for pattern in patterns:
        ranges.extend(m.span() for m in pattern.finditer(text))
    return sorted(ranges)


def _paragraph_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    start = 0
    for m in re.finditer(r"\n\s*\n", text):
        ranges.append((start, m.start()))
        start = m.end()
    ranges.append((start, len(text)))
    return ranges


def _paragraph_index(pos: int, paragraphs: list[tuple[int, int]]) -> int:
    for i, (start, end) in enumerate(paragraphs):
        if start <= pos <= end:
            return i
    return len(paragraphs)


def _range_overlaps(start: int, end: int, ranges: list[tuple[int, int]]) -> bool:
    return any(start < r_end and end > r_start for r_start, r_end in ranges)


def _candidate_score(c: ConceptCandidate) -> float:
    weighted = sum(SOURCE_WEIGHTS.get(src, 0.4) * count for src, count in c.source_counts.items())
    return weighted + min(2.0, len(c.paper_ids) * 0.35) + c.importance


def _snippet_for_term(term: str, extraction: dict[str, Any]) -> str:
    term_l = term.lower()
    for key in ["method", "contribution", "problem", "motivation", "novelty"]:
        value = str(extraction.get(key) or "")
        if term_l in value.lower():
            return value
    return ""


def _clean_term(term: str) -> str:
    term = re.sub(r"\s+", " ", str(term or "")).strip()
    term = term.strip(" \t\r\n-–—:;,.()[]{}")
    return term[:140]


def _clean_list(items: Iterable[Any]) -> list[str]:
    return dedupe_terms(str(x) for x in items)


def _clean_string_list(items: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        clean = " ".join(str(item or "").split())
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _obsidian_concept_label(term: str) -> str:
    words = _clean_term(term).split()
    return " ".join(w if w.isupper() else w[:1].upper() + w[1:] for w in words)
