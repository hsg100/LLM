"""Deterministic inter-paper relationship generation."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any


ALLOWED_RELATIONSHIP_TYPES = {
    "extends",
    "contradicts",
    "improves",
    "critiques",
    "uses_same_benchmark",
    "introduces_dataset",
    "introduces_metric",
    "baseline_for",
    "survey_of",
    "related",
}


def generate_paper_relationships(landscape_papers: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Generate lightweight graph edges using extracted fields only."""
    papers = [p for p in landscape_papers if p.get("paper_id")]
    by_id = {p["paper_id"]: p for p in papers}
    title_index = [(_norm(p.get("title")), p["paper_id"]) for p in papers]
    edges: dict[tuple[str, str, str], dict[str, str]] = {}

    def add(src: str | None, dst: str | None, kind: str, note: str) -> None:
        if not src or not dst or src == dst or src not in by_id or dst not in by_id:
            return
        if kind not in ALLOWED_RELATIONSHIP_TYPES:
            kind = "related"
        key = (src, dst, kind)
        edges.setdefault(
            key,
            {
                "source_paper_id": src,
                "target_paper_id": dst,
                "type": kind,
                "rationale": note[:500],
            },
        )

    for p in papers:
        pid = p["paper_id"]
        ext = p.get("extraction") or {}
        text = " ".join(
            str(ext.get(k) or "")
            for k in ["method", "contribution", "novelty", "limitations", "research_question"]
        ).lower()
        for rel in ext.get("related_papers") or []:
            dst = _resolve_paper_ref(str(rel), title_index, pid)
            if dst:
                kind = "related"
                rel_lower = str(rel).lower()
                if "extend" in text or "extends" in rel_lower:
                    kind = "extends"
                elif "contradict" in text or "conflict" in text:
                    kind = "contradicts"
                elif "critique" in text or "limitation" in text:
                    kind = "critiques"
                add(pid, dst, kind, f"Extraction related_papers mentions: {rel}")

        for baseline in ext.get("baselines") or []:
            baseline_id = _resolve_paper_ref(str(baseline), title_index, pid)
            if baseline_id:
                add(baseline_id, pid, "baseline_for", f"Listed as a baseline for {p.get('title')}.")

    for field, kind in [
        ("benchmarks", "uses_same_benchmark"),
        ("datasets", "introduces_dataset"),
        ("metrics", "introduces_metric"),
    ]:
        buckets: dict[str, list[str]] = defaultdict(list)
        for p in papers:
            ext = p.get("extraction") or {}
            for item in ext.get(field) or []:
                key = _norm(str(item))
                if key:
                    buckets[key].append(p["paper_id"])
        for artifact, ids in buckets.items():
            unique_ids = sorted(set(ids), key=lambda pid: _sort_key(by_id[pid]))
            if len(unique_ids) < 2:
                continue
            anchor = unique_ids[0]
            for other in unique_ids[1:]:
                add(anchor, other, kind, f"Both papers mention {field[:-1]}: {artifact}.")

    for p in papers:
        pid = p["paper_id"]
        title_method = f"{p.get('title') or ''} {(p.get('extraction') or {}).get('method') or ''}".lower()
        if "survey" in title_method or "review" in title_method:
            for other in sorted(papers, key=_sort_key)[:8]:
                if other["paper_id"] != pid:
                    add(pid, other["paper_id"], "survey_of", "Survey/review paper connected to selected landscape paper.")

    # Conservative fallback: connect adjacent papers in the same cluster or ranking order.
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in papers:
        groups[str(p.get("cluster_id") or "unclustered")].append(p)
    for group in groups.values():
        ordered = sorted(group, key=_sort_key)
        for a, b in zip(ordered, ordered[1:]):
            add(a["paper_id"], b["paper_id"], "related", "Deterministic fallback: adjacent selected papers in ranking/cluster order.")

    return [edges[k] for k in sorted(edges)]


def _resolve_paper_ref(ref: str, title_index: list[tuple[str, str]], current_id: str) -> str | None:
    needle = _norm(ref)
    if not needle:
        return None
    for title_norm, pid in title_index:
        if pid != current_id and (needle in title_norm or title_norm in needle):
            return pid
    tokens = set(needle.split("-"))
    best: tuple[int, str] | None = None
    for title_norm, pid in title_index:
        if pid == current_id:
            continue
        score = len(tokens & set(title_norm.split("-")))
        if score >= 3 and (best is None or score > best[0]):
            best = (score, pid)
    return best[1] if best else None


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def _sort_key(p: dict[str, Any]) -> tuple[int, float, str]:
    year = int(p.get("year") or 9999)
    score = -float(p.get("score") or 0.0)
    return (year, score, str(p.get("paper_id") or ""))
