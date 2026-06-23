"""Shared Obsidian-export plan building + writing.

One implementation used by the export route (preview + write) and the worker's
opt-in auto-export-on-complete, so the plan is built one way everywhere.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from sqlmodel import Session, select

from app.db import session_scope
from app.exporters.obsidian_git import (
    ExportPlan,
    make_repo_root,
    render_landscape_export,
    write_plan,
)
from app.models import (
    Extraction,
    Flashcard,
    Landscape,
    LandscapePaper,
    ObsidianExport,
    Paper,
    PaperPdf,
    Quiz,
)
from app.runtime_settings import effective_settings
from app.services.concepts import concept_to_dict
from app.services.pdf_storage import resolve_pdf_storage_path


class ExportError(Exception):
    """Plan-building failure with an HTTP-ish status for the route to translate."""

    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def _pdf_file_path(pdf: Optional[PaperPdf]) -> Optional[Path]:
    if pdf is None or not pdf.storage_path:
        return None
    path = resolve_pdf_storage_path(pdf.storage_path)
    if path is None or not path.exists() or not path.is_file():
        return None
    return path


def build_landscape_export_plan(
    s: Session, landscape_id: str, *, root: Path
) -> tuple[Landscape, ExportPlan]:
    """Assemble the deterministic export plan for a landscape."""
    landscape = s.get(Landscape, landscape_id)
    if landscape is None:
        raise ExportError(404, "landscape not found")

    links = s.exec(
        select(LandscapePaper).where(LandscapePaper.landscape_id == landscape_id)
    ).all()
    if not links:
        raise ExportError(400, "landscape has no papers — run the pipeline first")

    paper_ids = [link.paper_id for link in links]
    papers = {
        p.id: p
        for p in (s.exec(select(Paper).where(Paper.id.in_(paper_ids))).all() if paper_ids else [])
    }
    ext_by_paper = {
        e.paper_id: e
        for e in (s.exec(select(Extraction).where(Extraction.paper_id.in_(paper_ids))).all() if paper_ids else [])
    }
    pdf_by_paper = {
        p.paper_id: p
        for p in (s.exec(select(PaperPdf).where(PaperPdf.paper_id.in_(paper_ids))).all() if paper_ids else [])
    }

    landscape_papers: list[dict[str, Any]] = []
    extractions_by_paper: dict[str, dict[str, Any]] = {}
    for link in links:
        paper = papers.get(link.paper_id)
        if paper is None:
            continue
        ext = ext_by_paper.get(link.paper_id)
        if ext:
            extractions_by_paper[paper.id] = ext.data
        pdf_path = _pdf_file_path(pdf_by_paper.get(paper.id))
        landscape_papers.append(
            {
                "paper_id": paper.id,
                "title": paper.title,
                "year": paper.year,
                "venue": paper.venue,
                "authors": paper.authors,
                "url": paper.url,
                "pdf_url": paper.pdf_url,
                "pdf_filename": pdf_path.name if pdf_path else None,
                "pdf_source_path": str(pdf_path) if pdf_path else None,
                "arxiv_id": paper.arxiv_id,
                "category": link.category,
                "score": link.score,
                "rationale": link.rationale,
            }
        )

    quizzes = [
        {
            "question": q.question,
            "options": q.options,
            "correct_index": q.correct_index,
            "explanation": q.explanation,
        }
        for q in s.exec(select(Quiz).where(Quiz.landscape_id == landscape_id)).all()
    ]
    flashcards = [
        {"front": f.front, "back": f.back, "kind": f.kind}
        for f in s.exec(select(Flashcard).where(Flashcard.landscape_id == landscape_id)).all()
    ]
    from app.models import Concept

    concepts = [
        concept_to_dict(c)
        for c in s.exec(
            select(Concept)
            .where(Concept.landscape_id == landscape_id)
            .order_by(Concept.importance.desc(), Concept.name)
        ).all()
    ]

    plan = render_landscape_export(
        topic=landscape.topic,
        landscape_id=landscape_id,
        synthesis=landscape.synthesis or {},
        landscape_papers=landscape_papers,
        quizzes=quizzes,
        flashcards=flashcards,
        extractions_by_paper=extractions_by_paper,
        concepts=concepts,
        root=root,
        generated_at=landscape.updated_at.isoformat() + "Z",
    )
    return landscape, plan


def _record_export_rows(
    s: Session,
    landscape_id: str,
    hashes: list[tuple[str, str]],
    commit_sha: Optional[str],
    pushed: bool,
) -> None:
    for rel, digest in hashes:
        existing = s.exec(
            select(ObsidianExport).where(
                ObsidianExport.landscape_id == landscape_id,
                ObsidianExport.file_path == rel,
            )
        ).first()
        if existing is None:
            s.add(
                ObsidianExport(
                    landscape_id=landscape_id,
                    file_path=rel,
                    content_hash=digest,
                    commit_sha=commit_sha,
                    pushed=pushed,
                )
            )
        else:
            existing.content_hash = digest
            existing.commit_sha = commit_sha
            existing.pushed = pushed
            s.add(existing)


def write_landscape_export(
    s: Session, landscape_id: str, *, root: Path, push: bool, force: bool = False
) -> dict[str, Any]:
    """Build the plan, write+commit it, and record export rows."""
    landscape, plan = build_landscape_export_plan(s, landscape_id, root=root)
    written, hashes, commit_sha, pushed = write_plan(
        plan,
        root=root,
        commit_message=f"fieldmap: export landscape '{landscape.topic}' ({datetime.utcnow().isoformat()}Z)",
        push=push,
        force=force,
    )
    _record_export_rows(s, landscape_id, hashes, commit_sha, pushed)
    return {"files": written, "commit_sha": commit_sha, "pushed": pushed}


def auto_export_landscape(landscape_id: str) -> Optional[dict[str, Any]]:
    """Opt-in export on pipeline completion. Best-effort: never raises."""
    try:
        with session_scope() as s:
            settings = effective_settings(s)
            if not getattr(settings, "obsidian_auto_export", False):
                return None
            root = make_repo_root()
            return write_landscape_export(
                s,
                landscape_id,
                root=root,
                push=settings.obsidian_export_auto_push,
                force=False,
            )
    except Exception:  # noqa: BLE001 — auto-export must never fail the pipeline
        return None
