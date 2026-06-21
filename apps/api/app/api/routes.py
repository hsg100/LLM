"""HTTP API routes.

Routes are intentionally thin: they translate request shapes into ORM
calls and back. All heavy lifting lives in services/workers.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, select
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.db import get_session, session_scope
from app.pipeline import JobStage, LandscapeStatus, TERMINAL_STAGES
from app.exporters.obsidian_git import (
    get_configured_repo_root,
    make_repo_root,
    preview_plan,
    render_landscape_export,
    write_plan,
)
from app.models import (
    Chunk,
    Concept,
    Extraction,
    Flashcard,
    JobEvent,
    Landscape,
    LandscapePaper,
    ObsidianExport,
    Paper,
    PaperPdf,
    PaperRelationship,
    PaperSection,
    Quiz,
    SearchJob,
)
from app.schemas import (
    ConceptDetailOut,
    ConceptMapOut,
    ConceptOut,
    ExportPreviewOut,
    ExportRequest,
    ExportResult,
    FlashcardOut,
    JobOut,
    PaperGraphNode,
    PaperGraphOut,
    PaperRelationshipOut,
    LandscapeCreate,
    LandscapeOut,
    LandscapePaperOut,
    PaperOut,
    QuizOut,
    SettingsOut,
    SettingsPatch,
    Extraction as ExtractionSchema,
)
from app.runtime_settings import EDITABLE_FIELDS, effective_settings, set_overrides
from app.services.concepts import build_concept_map, concept_slug, concept_to_dict
from app.services.pdf_storage import resolve_pdf_storage_path
from app.users import DEFAULT_USER_ID
from app.workers.landscape_job import job_channel, run_landscape_job
from app.workers.queue import get_queue


router = APIRouter()


# ---------------------------------------------------------------------------
# Landscapes
# ---------------------------------------------------------------------------
@router.post("/landscapes", response_model=dict)
def create_landscape(body: LandscapeCreate, s: Session = Depends(get_session)) -> dict[str, str]:
    landscape = Landscape(
        topic=body.topic,
        user_id=DEFAULT_USER_ID,
        settings={
            "max_papers": body.max_papers or effective_settings().max_papers_per_landscape,
            "sources": body.sources,
            "parse_pdfs": body.parse_pdfs,
            **(body.settings or {}),
        },
        status=LandscapeStatus.QUEUED.value,
    )
    s.add(landscape)
    s.flush()

    job = SearchJob(landscape_id=landscape.id, stage=JobStage.QUEUED.value, progress=0.0)
    s.add(job)
    s.flush()

    # Enqueue background work.
    try:
        get_queue().enqueue(run_landscape_job, job.id, job_timeout=3600)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"failed to enqueue: {e!s}")
    return {"landscape_id": landscape.id, "job_id": job.id}


@router.get("/landscapes", response_model=list[LandscapeOut])
def list_landscapes(s: Session = Depends(get_session)) -> list[LandscapeOut]:
    rows = s.exec(
        select(Landscape)
        .where(Landscape.user_id == DEFAULT_USER_ID)
        .order_by(Landscape.created_at.desc())
    ).all()
    return [LandscapeOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/landscapes/{landscape_id}", response_model=LandscapeOut)
def get_landscape(landscape_id: str, s: Session = Depends(get_session)) -> LandscapeOut:
    row = s.get(Landscape, landscape_id)
    if row is None:
        raise HTTPException(404, "landscape not found")
    return LandscapeOut.model_validate(row, from_attributes=True)


def _papers_by_id(s: Session, paper_ids: list[str]) -> dict[str, Paper]:
    """Batch-load papers into an id->Paper map (avoids per-link N+1 gets)."""
    ids = [pid for pid in dict.fromkeys(paper_ids) if pid]
    if not ids:
        return {}
    rows = s.exec(select(Paper).where(Paper.id.in_(ids))).all()
    return {p.id: p for p in rows}


@router.get("/landscapes/{landscape_id}/papers", response_model=list[LandscapePaperOut])
def get_landscape_papers(landscape_id: str, s: Session = Depends(get_session)) -> list[LandscapePaperOut]:
    links = s.exec(
        select(LandscapePaper)
        .where(LandscapePaper.landscape_id == landscape_id)
        .order_by(LandscapePaper.score.desc())
    ).all()
    papers = _papers_by_id(s, [link.paper_id for link in links])
    out: list[LandscapePaperOut] = []
    for link in links:
        paper = papers.get(link.paper_id)
        if paper is None:
            continue
        out.append(
            LandscapePaperOut(
                paper=PaperOut.model_validate(paper, from_attributes=True),
                score=link.score,
                category=link.category,
                rationale=link.rationale,
                cluster_id=link.cluster_id,
                reading_order=link.reading_order,
            )
        )
    return out


@router.get("/landscapes/{landscape_id}/concepts", response_model=list[ConceptOut])
def get_landscape_concepts(landscape_id: str, s: Session = Depends(get_session)) -> list[ConceptOut]:
    if s.get(Landscape, landscape_id) is None:
        raise HTTPException(404, "landscape not found")
    rows = _concept_rows(s, landscape_id)
    return [ConceptOut.model_validate(concept_to_dict(c)) for c in rows]


@router.get("/landscapes/{landscape_id}/concepts/{slug}", response_model=ConceptDetailOut)
def get_landscape_concept_detail(landscape_id: str, slug: str, s: Session = Depends(get_session)) -> ConceptDetailOut:
    if s.get(Landscape, landscape_id) is None:
        raise HTTPException(404, "landscape not found")
    rows = _concept_rows(s, landscape_id)
    concept = next((c for c in rows if (c.slug or concept_slug(c.name)) == slug), None)
    if concept is None:
        raise HTTPException(404, "concept not found")
    concept_dict = concept_to_dict(concept)
    related_names = {str(x).lower() for x in concept_dict.get("related_terms") or []}
    related_slugs = {concept_slug(str(x)) for x in concept_dict.get("related_terms") or []}
    related = [
        concept_to_dict(c)
        for c in rows
        if (c.slug or concept_slug(c.name)) != slug
        and ((c.term or c.name).lower() in related_names or (c.slug or concept_slug(c.name)) in related_slugs)
    ]
    papers = [p for p in (s.get(Paper, pid) for pid in concept_dict.get("paper_ids") or []) if p is not None]
    snippets = [
        str(g.get("quote") or "").strip()
        for g in concept_dict.get("source_grounding") or []
        if isinstance(g, dict) and str(g.get("quote") or "").strip()
    ][:6]
    return ConceptDetailOut(
        concept=ConceptOut.model_validate(concept_dict),
        related_concepts=[ConceptOut.model_validate(x) for x in related],
        papers=[PaperOut.model_validate(p, from_attributes=True) for p in papers],
        source_grounding=concept_dict.get("source_grounding") or [],
        example_snippets=snippets,
    )


@router.get("/landscapes/{landscape_id}/concept-map", response_model=ConceptMapOut)
def get_landscape_concept_map(landscape_id: str, s: Session = Depends(get_session)) -> ConceptMapOut:
    if s.get(Landscape, landscape_id) is None:
        raise HTTPException(404, "landscape not found")
    concepts = [concept_to_dict(c) for c in _concept_rows(s, landscape_id)]
    return ConceptMapOut.model_validate(build_concept_map(concepts))


@router.get("/landscapes/{landscape_id}/graph", response_model=PaperGraphOut)
def get_landscape_graph(landscape_id: str, s: Session = Depends(get_session)) -> PaperGraphOut:
    landscape = s.get(Landscape, landscape_id)
    if landscape is None:
        raise HTTPException(404, "landscape not found")
    links = s.exec(
        select(LandscapePaper)
        .where(LandscapePaper.landscape_id == landscape_id)
        .order_by(LandscapePaper.score.desc())
    ).all()
    papers = _papers_by_id(s, [link.paper_id for link in links])
    nodes: list[PaperGraphNode] = []
    for link in links:
        paper = papers.get(link.paper_id)
        if paper is None:
            continue
        nodes.append(
            PaperGraphNode(
                paper=PaperOut.model_validate(paper, from_attributes=True),
                score=link.score,
                category=link.category,
                cluster_id=link.cluster_id,
            )
        )

    rels = s.exec(
        select(PaperRelationship)
        .where(PaperRelationship.landscape_id == landscape_id)
        .order_by(PaperRelationship.kind, PaperRelationship.src_paper_id, PaperRelationship.dst_paper_id)
    ).all()
    edges = [
        PaperRelationshipOut(
            source_paper_id=r.src_paper_id,
            target_paper_id=r.dst_paper_id,
            type=r.kind,
            rationale=r.note,
        )
        for r in rels
    ]
    return PaperGraphOut(nodes=nodes, edges=edges)


# ---------------------------------------------------------------------------
# Papers
# ---------------------------------------------------------------------------
@router.get("/papers/{paper_id}", response_model=dict)
def get_paper(paper_id: str, s: Session = Depends(get_session)) -> dict[str, Any]:
    paper = s.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(404, "paper not found")
    extraction = s.exec(select(Extraction).where(Extraction.paper_id == paper_id)).first()
    pdf = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
    sections = s.exec(
        select(PaperSection).where(PaperSection.paper_id == paper_id).order_by(PaperSection.ordinal)
    ).all()
    chunks = s.exec(select(Chunk).where(Chunk.paper_id == paper_id).order_by(Chunk.ordinal)).all()
    extraction_data = _normalise_extraction_payload(extraction.data if extraction else None)
    landscape_ids = [
        x.landscape_id
        for x in s.exec(select(LandscapePaper).where(LandscapePaper.paper_id == paper_id)).all()
    ]
    return {
        "paper": PaperOut.model_validate(paper, from_attributes=True).model_dump(),
        "extraction": extraction_data,
        "landscape_ids": landscape_ids,
        "pdf": {
            "status": pdf.status if pdf else "missing",
            "bytes": pdf.bytes if pdf else None,
            "error": pdf.error if pdf else None,
            "url": f"/api/papers/{paper_id}/pdf" if _pdf_file_exists(pdf) else None,
            "storage_path": pdf.storage_path if pdf and _pdf_file_exists(pdf) else None,
        },
        "sections": [{"heading": x.heading, "content": x.content[:6000]} for x in sections],
        "chunks": [
            {
                "id": x.id,
                "section_id": x.section_id,
                "section": x.section_heading,
                "page_start": x.page_start,
                "page_end": x.page_end,
                "ordinal": x.ordinal,
                "char_start": x.char_start,
                "char_end": x.char_end,
                "content": x.content[:1200],
            }
            for x in chunks
        ],
    }


@router.get("/papers/{paper_id}/pdf")
def get_paper_pdf(paper_id: str, s: Session = Depends(get_session)) -> FileResponse:
    paper = s.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(404, "paper not found")
    pdf = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
    path = _pdf_file_path(pdf)
    if path is None:
        raise HTTPException(404, "local PDF not found")
    # Serve inline — do NOT pass filename= (that triggers Content-Disposition: attachment).
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename=\"{path.name}\"; filename*=UTF-8''{quote(path.name)}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/papers/{paper_id}/pdf/download")
def download_paper_pdf(paper_id: str, s: Session = Depends(get_session)) -> FileResponse:
    """Explicit download endpoint — sets Content-Disposition: attachment."""
    paper = s.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(404, "paper not found")
    pdf = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
    path = _pdf_file_path(pdf)
    if path is None:
        raise HTTPException(404, "local PDF not found")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


def _concept_rows(s: Session, landscape_id: str) -> list[Concept]:
    return s.exec(
        select(Concept)
        .where(Concept.landscape_id == landscape_id)
        .order_by(Concept.importance.desc(), Concept.name)
    ).all()


def _pdf_file_exists(pdf: PaperPdf | None) -> bool:
    return _pdf_file_path(pdf) is not None


def _pdf_file_path(pdf: PaperPdf | None) -> Path | None:
    if pdf is None or not pdf.storage_path:
        return None
    path = resolve_pdf_storage_path(pdf.storage_path)
    if path is None or not path.exists() or not path.is_file():
        return None
    return path


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
def _job_out(s: Session, job: SearchJob) -> JobOut:
    rows = s.exec(
        select(JobEvent).where(JobEvent.job_id == job.id).order_by(JobEvent.seq)
    ).all()
    return JobOut(
        id=job.id,
        landscape_id=job.landscape_id,
        stage=job.stage,
        progress=job.progress,
        cancel_requested=job.cancel_requested,
        events=[
            {
                "ts": e.ts,
                "stage": e.stage,
                "message": e.message,
                "progress": e.progress,
                "meta": e.meta or {},
            }
            for e in rows
        ],
        error=job.error,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, s: Session = Depends(get_session)) -> JobOut:
    job = s.get(SearchJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return _job_out(s, job)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: str, s: Session = Depends(get_session)) -> JobOut:
    """Request cooperative cancellation. The worker observes the flag at stage
    boundaries and finalizes the job as ``cancelled``."""
    job = s.get(SearchJob, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    if job.stage not in TERMINAL_STAGES:
        job.cancel_requested = True
        s.add(job)
        s.flush()
    s.refresh(job)
    return _job_out(s, job)


# SSE tuning. EventSourceResponse already emits periodic ping comments to keep
# the connection alive, so we only handle event delivery + a stall watchdog.
_SSE_POLL_SECONDS = 2.0
_SSE_STALL_SECONDS = 90.0
_SSE_MAX_LIFETIME_SECONDS = 2 * 60 * 60


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str) -> EventSourceResponse:
    """SSE stream of job events.

    Pushes via Redis pub/sub (the worker publishes on every event) with a short
    DB poll as a fallback so nothing is missed if a notification is dropped.
    Ordering + cursoring use the monotonic ``job_events.seq``.
    """

    def _load_since(last_seq: int) -> dict[str, Any] | None:
        with session_scope() as s:
            job = s.get(SearchJob, job_id)
            if job is None:
                return None
            rows = s.exec(
                select(JobEvent)
                .where(JobEvent.job_id == job_id, JobEvent.seq > last_seq)
                .order_by(JobEvent.seq)
            ).all()
            payloads = [
                (
                    int(r.seq),
                    _normalise_job_event(
                        {
                            "ts": r.ts.isoformat() + "Z",
                            "stage": r.stage,
                            "message": r.message,
                            "progress": r.progress,
                            "meta": r.meta or {},
                        }
                    ),
                )
                for r in rows
            ]
            return {
                "payloads": payloads,
                "stage": job.stage,
                "progress": job.progress,
                "error": job.error,
                "finished_at": job.finished_at,
                "landscape_id": job.landscape_id,
            }

    async def gen():  # type: ignore[no-untyped-def]
        from redis.asyncio import Redis as AsyncRedis

        last_seq = 0
        started = time.monotonic()
        last_activity = time.monotonic()
        stall_notified = False
        aredis = None
        pubsub = None
        try:
            try:
                aredis = AsyncRedis.from_url(get_settings().redis_url)
                pubsub = aredis.pubsub()
                await pubsub.subscribe(job_channel(job_id))
            except Exception:  # noqa: BLE001 — pub/sub is an optimisation; polling still works
                pubsub = None

            while True:
                snap = await run_in_threadpool(_load_since, last_seq)
                if snap is None:
                    yield {
                        "event": "error",
                        "data": json.dumps(
                            {
                                "ts": datetime.utcnow().isoformat() + "Z",
                                "stage": "error",
                                "progress": 0,
                                "message": "job not found",
                                "meta": {"job_id": job_id},
                            }
                        ),
                    }
                    return

                for seq, payload in snap["payloads"]:
                    yield {"event": "progress", "id": str(seq), "data": json.dumps(payload)}
                    last_seq = seq
                    last_activity = time.monotonic()
                    stall_notified = False

                if snap["stage"] in TERMINAL_STAGES:
                    yield {
                        "event": "complete",
                        "id": "final",
                        "data": json.dumps(
                            {
                                "ts": (snap["finished_at"] or datetime.utcnow()).isoformat() + "Z",
                                "stage": snap["stage"],
                                "progress": snap["progress"],
                                "message": "Pipeline complete"
                                if snap["stage"] == JobStage.DONE.value
                                else (snap["error"] or f"Pipeline {snap['stage']}"),
                                "meta": {"job_id": job_id, "landscape_id": snap["landscape_id"]},
                            }
                        ),
                    }
                    return

                now = time.monotonic()
                if not stall_notified and (now - last_activity) > _SSE_STALL_SECONDS:
                    stall_notified = True
                    yield {
                        "event": "progress",
                        "data": json.dumps(
                            {
                                "ts": datetime.utcnow().isoformat() + "Z",
                                "stage": snap["stage"],
                                "progress": snap["progress"],
                                "message": "No progress received recently; the job may be stalled.",
                                "meta": {"job_id": job_id, "stalled": True},
                            }
                        ),
                    }
                if (now - started) > _SSE_MAX_LIFETIME_SECONDS:
                    return

                # Wait for a pub/sub nudge, or fall through after the poll timeout.
                if pubsub is not None:
                    try:
                        await pubsub.get_message(ignore_subscribe_messages=True, timeout=_SSE_POLL_SECONDS)
                    except Exception:  # noqa: BLE001
                        await asyncio.sleep(_SSE_POLL_SECONDS)
                else:
                    await asyncio.sleep(_SSE_POLL_SECONDS)
        except asyncio.CancelledError:
            return
        finally:
            if pubsub is not None:
                try:
                    await pubsub.unsubscribe(job_channel(job_id))
                    await pubsub.aclose()
                except Exception:  # noqa: BLE001
                    pass
            if aredis is not None:
                try:
                    await aredis.aclose()
                except Exception:  # noqa: BLE001
                    pass

    return EventSourceResponse(gen())


# ---------------------------------------------------------------------------
# Quiz + flashcards
# ---------------------------------------------------------------------------
@router.get("/landscapes/{landscape_id}/quiz", response_model=list[QuizOut])
def get_quiz(landscape_id: str, s: Session = Depends(get_session)) -> list[QuizOut]:
    rows = s.exec(select(Quiz).where(Quiz.landscape_id == landscape_id)).all()
    return [QuizOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/landscapes/{landscape_id}/flashcards", response_model=list[FlashcardOut])
def get_flashcards(landscape_id: str, s: Session = Depends(get_session)) -> list[FlashcardOut]:
    rows = s.exec(select(Flashcard).where(Flashcard.landscape_id == landscape_id)).all()
    return [FlashcardOut.model_validate(r, from_attributes=True) for r in rows]


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@router.get("/settings", response_model=SettingsOut)
def get_settings_route() -> SettingsOut:
    # Effective view = env defaults + persisted runtime overrides.
    s = effective_settings()
    return SettingsOut(
        llm_provider=s.llm_provider,
        llm_model_fast=s.llm_model_fast,
        llm_model_strong=s.llm_model_strong,
        embedding_provider=s.embedding_provider,
        embedding_model=s.embedding_model,
        embedding_dim=s.embedding_dim,
        obsidian_export_repo_path=s.obsidian_export_repo_path,
        obsidian_export_auto_push=s.obsidian_export_auto_push,
        max_papers_per_landscape=s.max_papers_per_landscape,
        has_openai_key=bool(s.openai_api_key),
        has_deepseek_key=bool(s.deepseek_api_key),
        has_anthropic_key=bool(s.anthropic_api_key),
        editable_fields=list(EDITABLE_FIELDS.keys()),
    )


@router.patch("/settings", response_model=SettingsOut)
def patch_settings(body: SettingsPatch) -> SettingsOut:
    """Persist runtime overrides for the editable subset. Secrets and
    schema-coupled values stay env-only and are rejected here."""
    try:
        set_overrides(body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return get_settings_route()


# ---------------------------------------------------------------------------
# Obsidian export
# ---------------------------------------------------------------------------
@router.post("/landscapes/{landscape_id}/export/obsidian", response_model=ExportResult)
def export_obsidian(landscape_id: str, body: ExportRequest, s: Session = Depends(get_session)) -> ExportResult:
    landscape, plan, root = _build_export_plan(landscape_id, s, create_root=True)
    push = body.push if body.push is not None else effective_settings().obsidian_export_auto_push
    try:
        written, hashes, commit_sha, pushed = write_plan(
            plan,
            root=root,
            commit_message=f"fieldmap: export landscape '{landscape.topic}' ({datetime.utcnow().isoformat()}Z)",
            push=push,
            force=body.force,
        )
    except Exception as e:
        raise HTTPException(
            500,
            f"obsidian export failed: {type(e).__name__}: {e}. "
            "Check that the configured repo path exists, is writable, and is a git working tree.",
        )

    # Record obsidian_exports rows.
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

    return ExportResult(files=written, commit_sha=commit_sha, pushed=pushed)


@router.get("/landscapes/{landscape_id}/export/preview", response_model=ExportPreviewOut)
def export_preview_get(landscape_id: str, s: Session = Depends(get_session)) -> ExportPreviewOut:
    return _export_preview(landscape_id, False, s)


@router.post("/landscapes/{landscape_id}/export/preview", response_model=ExportPreviewOut)
def export_preview_post(landscape_id: str, body: ExportRequest, s: Session = Depends(get_session)) -> ExportPreviewOut:
    return _export_preview(landscape_id, body.force, s)


def _export_preview(landscape_id: str, force: bool, s: Session) -> ExportPreviewOut:
    _landscape, plan, root = _build_export_plan(landscape_id, s, create_root=False)
    try:
        preview = preview_plan(plan, root=root, force=force)
    except Exception as e:
        raise HTTPException(400, f"obsidian export preview failed: {type(e).__name__}: {e}")
    return ExportPreviewOut(**preview.__dict__)


def _build_export_plan(landscape_id: str, s: Session, *, create_root: bool):  # type: ignore[no-untyped-def]
    landscape = s.get(Landscape, landscape_id)
    if landscape is None:
        raise HTTPException(404, "landscape not found")

    links = s.exec(
        select(LandscapePaper).where(LandscapePaper.landscape_id == landscape_id)
    ).all()
    if not links:
        raise HTTPException(400, "landscape has no papers — run the pipeline first")

    paper_ids = [link.paper_id for link in links]
    papers = _papers_by_id(s, paper_ids)
    ext_rows = s.exec(select(Extraction).where(Extraction.paper_id.in_(paper_ids))).all() if paper_ids else []
    ext_by_paper = {e.paper_id: e for e in ext_rows}
    pdf_rows = s.exec(select(PaperPdf).where(PaperPdf.paper_id.in_(paper_ids))).all() if paper_ids else []
    pdf_by_paper = {p.paper_id: p for p in pdf_rows}

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
        {"front": f.front, "back": f.back, "kind": f.kind} for f in s.exec(select(Flashcard).where(Flashcard.landscape_id == landscape_id)).all()
    ]
    concepts = [concept_to_dict(c) for c in _concept_rows(s, landscape_id)]

    try:
        root = get_configured_repo_root(create=create_root)
        if create_root:
            root = make_repo_root()
    except PermissionError as e:
        raise HTTPException(
            500,
            f"obsidian export path not writable ({get_settings().obsidian_export_repo_path}): {e}. "
            "Fix the volume mount in docker-compose.yml or change OBSIDIAN_EXPORT_REPO_PATH.",
        )
    except (OSError, ValueError) as e:
        raise HTTPException(
            500,
            f"obsidian export path error ({get_settings().obsidian_export_repo_path}): {e}.",
        )

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
    return landscape, plan, root


def _normalise_extraction_payload(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if data is None:
        return None
    base = ExtractionSchema.model_validate(data).model_dump()
    schema_keys = set(base.keys())
    extra = {k: v for k, v in data.items() if k not in schema_keys}
    base["extra_fields"] = extra
    return base


def _normalise_job_event(ev: dict[str, Any]) -> dict[str, Any]:
    return {
        "ts": ev.get("ts") or datetime.utcnow().isoformat() + "Z",
        "stage": ev.get("stage") or "unknown",
        "progress": ev.get("progress", 0),
        "message": ev.get("message") or "",
        "meta": ev.get("meta") or {},
    }
