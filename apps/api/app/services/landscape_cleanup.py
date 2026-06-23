"""Cascade deletion + off-topic detection for existing landscapes.

The fast-fail guard (``app.services.topic_guard``) only protects *new*
landscapes. This module applies the same verdict retroactively and removes
landscapes (and all of their dependent rows) that should never have been
created — e.g. junk topics like "gta" or "bonnie blue" submitted before the
guard existed.

Shared ``papers`` rows are global (a paper can belong to several landscapes),
so they are intentionally **not** deleted here.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session, select

from app.models import (
    Cluster,
    ClusterPaper,
    Concept,
    Flashcard,
    JobEvent,
    Landscape,
    LandscapePaper,
    ObsidianExport,
    PaperRelationship,
    Quiz,
    ReviewAttempt,
    ReviewState,
    SearchJob,
)
from app.services.topic_guard import TopicVerdict, evaluate_topic


@dataclass(frozen=True)
class OffTopicLandscape:
    id: str
    topic: str
    status: str
    verdict: TopicVerdict


def find_offtopic_landscapes(s: Session) -> list[OffTopicLandscape]:
    """Return every persisted landscape whose topic fails the guard."""
    rows = s.exec(select(Landscape)).all()
    out: list[OffTopicLandscape] = []
    for ls in rows:
        verdict = evaluate_topic(ls.topic)
        if not verdict.ok:
            out.append(
                OffTopicLandscape(id=ls.id, topic=ls.topic, status=ls.status, verdict=verdict)
            )
    return out


def delete_landscape_cascade(s: Session, landscape_id: str) -> dict[str, int]:
    """Delete a landscape and all rows that reference it (FK-safe order).

    Returns a per-table count of deleted rows. Does not commit — the caller
    owns the transaction (e.g. ``session_scope``).
    """
    counts: dict[str, int] = {}

    def _delete(rows: list[object], label: str) -> None:
        for r in rows:
            s.delete(r)
        if rows:
            counts[label] = counts.get(label, 0) + len(rows)

    # job_events reference search_jobs, so collect job ids first.
    jobs = s.exec(select(SearchJob).where(SearchJob.landscape_id == landscape_id)).all()
    job_ids = [j.id for j in jobs]
    if job_ids:
        _delete(
            s.exec(select(JobEvent).where(JobEvent.job_id.in_(job_ids))).all(),
            "job_events",
        )
    _delete(jobs, "search_jobs")

    # cluster_papers reference clusters, so collect cluster ids first.
    clusters = s.exec(select(Cluster).where(Cluster.landscape_id == landscape_id)).all()
    cluster_ids = [c.id for c in clusters]
    if cluster_ids:
        _delete(
            s.exec(select(ClusterPaper).where(ClusterPaper.cluster_id.in_(cluster_ids))).all(),
            "cluster_papers",
        )
    _delete(clusters, "clusters")

    _delete(
        s.exec(select(LandscapePaper).where(LandscapePaper.landscape_id == landscape_id)).all(),
        "landscape_papers",
    )
    _delete(
        s.exec(select(PaperRelationship).where(PaperRelationship.landscape_id == landscape_id)).all(),
        "paper_relationships",
    )
    _delete(
        s.exec(select(Concept).where(Concept.landscape_id == landscape_id)).all(),
        "concepts",
    )
    _delete(
        s.exec(select(Quiz).where(Quiz.landscape_id == landscape_id)).all(),
        "quizzes",
    )
    _delete(
        s.exec(select(Flashcard).where(Flashcard.landscape_id == landscape_id)).all(),
        "flashcards",
    )
    _delete(
        s.exec(select(ReviewAttempt).where(ReviewAttempt.landscape_id == landscape_id)).all(),
        "review_attempts",
    )
    _delete(
        s.exec(select(ReviewState).where(ReviewState.landscape_id == landscape_id)).all(),
        "review_states",
    )
    _delete(
        s.exec(select(ObsidianExport).where(ObsidianExport.landscape_id == landscape_id)).all(),
        "obsidian_exports",
    )

    landscape = s.get(Landscape, landscape_id)
    if landscape is not None:
        s.delete(landscape)
        counts["landscapes"] = counts.get("landscapes", 0) + 1

    s.flush()
    return counts
