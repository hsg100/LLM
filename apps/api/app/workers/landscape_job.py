"""End-to-end landscape pipeline.

Stages (matching the progress UI):
  1. Searching papers
  2. Deduplicating
  3. Embedding and ranking
  4. Downloading PDFs
  5. Parsing PDFs
  6. Extracting structured paper notes
  7. Synthesising landscape
  8. Generating quiz and flashcards
  9. (Export is its own endpoint; not in this job.)

Each stage updates ``SearchJob.stage``, ``progress`` and appends an event.
Per-paper LLM calls are isolated so one failure can't kill the job.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import delete
from sqlmodel import select

from app.config import get_settings
from app.db import session_scope
from app.pipeline import JobStage, LandscapeStatus, PIPELINE_STAGES
from app.models import (
    Chunk,
    Cluster,
    ClusterPaper,
    Extraction,
    Flashcard,
    Landscape,
    LandscapePaper,
    Paper,
    PaperPdf,
    PaperRelationship,
    PaperSection,
    Quiz,
    SearchJob,
)
from app.parsers.pdf_parser import download_pdf, parse_pdf_bytes
from app.services.embeddings import (
    embedding_fallback_allowed,
    embedding_metadata,
    fallback_stub_provider,
    get_embedding_provider,
)
from app.services.extraction import extract_paper
from app.services.llm import get_llm
from app.services.concepts import generate_concept_glossary, persist_concepts
from app.services.paper_sources import get_source
from app.services.paper_sources.base import (
    PaperCandidate,
    SearchOutcome,
    dedupe,
    normalize_title,
)
from app.services.paper_sources.stub import StubSource
from app.services.pdf_storage import deterministic_pdf_filename, resolve_pdf_storage_path, store_pdf_bytes
from app.services.quiz_generation import generate_quizzes_and_flashcards
from app.services.ranking import rank_papers
from app.services.relationships import generate_paper_relationships
from app.services.synthesis import synthesise
from app.services.vectors import has_embedding, to_list


# Canonical ordered stages live in app.pipeline (shared with the API + frontend).
STAGES = PIPELINE_STAGES


def run_landscape_job(job_id: str) -> None:
    """RQ entrypoint. Sync wrapper around the async pipeline."""
    asyncio.run(_run(job_id))


async def _run(job_id: str) -> None:
    settings = get_settings()
    _set_stage(job_id, "searching", 0.02, "Job started")

    with session_scope() as s:
        job = s.get(SearchJob, job_id)
        if job is None:
            return
        landscape = s.get(Landscape, job.landscape_id)
        if landscape is None:
            _set_error(job_id, "landscape missing")
            return
        topic = landscape.topic
        max_papers = int(landscape.settings.get("max_papers") or settings.max_papers_per_landscape)
        sources = landscape.settings.get("sources") or ["arxiv"]
        parse_pdfs_flag = bool(landscape.settings.get("parse_pdfs", True))
        landscape.status = LandscapeStatus.RUNNING.value
        s.add(landscape)
        job.started_at = datetime.utcnow()
        s.add(job)

    try:
        # ----- 1. Search -----
        candidates: list[PaperCandidate] = []
        outcomes: list[SearchOutcome] = []
        used_fallback = False
        for source_name in sources:
            try:
                src = get_source(source_name)
            except ValueError as e:
                _append_event(
                    job_id,
                    "searching",
                    f"unknown source '{source_name}' — skipping",
                    0.05,
                    meta={"error_type": "ValueError", "error_message": str(e)},
                )
                continue

            try:
                outcome = await src.search(topic, settings.max_candidates)
            except Exception as e:  # noqa: BLE001 — sources must not raise, but guard anyway.
                outcome = SearchOutcome(
                    source=source_name,
                    query=topic,
                    error_type=type(e).__name__,
                    error_message=str(e)[:240],
                    succeeded=False,
                )

            outcomes.append(outcome)
            candidates.extend(outcome.candidates)

            msg = (
                f"{outcome.source}: {len(outcome.candidates)} candidates "
                f"(raw {outcome.raw_entry_count}, {outcome.elapsed_ms or 0}ms)"
                if outcome.succeeded
                else f"{outcome.source} failed: {outcome.error_type} — {outcome.error_message}"
            )
            _append_event(job_id, "searching", msg, 0.06, meta=outcome.diagnostic_dict())

        # ----- 1b. Dev fallback if no usable candidates -----
        if not candidates:
            if settings.enable_dev_fallback and settings.is_development:
                _append_event(
                    job_id,
                    "searching",
                    "All real sources returned zero usable candidates — generating deterministic stub papers (dev fallback).",
                    0.07,
                    meta={
                        "fallback": True,
                        "reason": "no_candidates",
                        "env": settings.env,
                        "outcomes": [o.diagnostic_dict() for o in outcomes],
                    },
                )
                stub = StubSource()
                stub_outcome = await stub.search(topic, settings.max_candidates)
                candidates.extend(stub_outcome.candidates)
                outcomes.append(stub_outcome)
                used_fallback = True
                _append_event(
                    job_id,
                    "searching",
                    f"stub: generated {len(stub_outcome.candidates)} fallback papers",
                    0.08,
                    meta=stub_outcome.diagnostic_dict(),
                )
            else:
                _set_error(
                    job_id,
                    "no candidates returned (dev fallback disabled). "
                    "Check job events for per-source errors.",
                )
                return

        # ----- 2. Dedupe -----
        _set_stage(job_id, "deduplicating", 0.1, f"{len(candidates)} → dedupe")
        candidates = dedupe(candidates)
        _append_event(job_id, "deduplicating", f"{len(candidates)} unique candidates", 0.12)

        # ----- 3. Embed + rank -----
        try:
            provider = get_embedding_provider()
        except Exception as e:  # noqa: BLE001
            if embedding_fallback_allowed(settings):
                provider = fallback_stub_provider(f"{type(e).__name__}: {str(e)[:200]}", settings)
            else:
                _set_error(
                    job_id,
                    f"embedding provider unavailable: {type(e).__name__}: {e}",
                    meta={
                        "error_type": type(e).__name__,
                        "error_message": str(e)[:240],
                        "candidate_count": len(candidates),
                        "embedding_provider": settings.embedding_provider,
                        "embedding_model": settings.embedding_model,
                        "embedding_dim": settings.embedding_dim,
                    },
                )
                return
        _set_stage(
            job_id,
            "embedding_ranking",
            0.15,
            "Embedding + ranking",
            meta=embedding_metadata(provider, candidate_count=len(candidates)),
        )
        if provider.is_fallback:
            _append_event(
                job_id,
                "embedding_ranking",
                f"warning: using stub embeddings ({provider.fallback_reason})",
                0.16,
                meta=embedding_metadata(provider, candidate_count=len(candidates)),
            )
        try:
            ranked = await rank_papers(topic, candidates, provider, max_papers=max_papers)
        except Exception as e:  # noqa: BLE001
            if provider.name != "stub" and embedding_fallback_allowed(settings):
                provider = fallback_stub_provider(f"{type(e).__name__}: {str(e)[:200]}", settings)
                _append_event(
                    job_id,
                    "embedding_ranking",
                    f"warning: real embeddings failed; retrying with stub ({type(e).__name__})",
                    0.17,
                    meta=embedding_metadata(provider, candidate_count=len(candidates)),
                )
                try:
                    ranked = await rank_papers(topic, candidates, provider, max_papers=max_papers)
                except Exception as fallback_error:  # noqa: BLE001
                    _set_error(
                        job_id,
                        f"ranking failed after embedding fallback: {type(fallback_error).__name__}: {fallback_error}",
                        meta={
                            **embedding_metadata(provider, candidate_count=len(candidates)),
                            "error_type": type(fallback_error).__name__,
                            "error_message": str(fallback_error)[:240],
                        },
                    )
                    return
            else:
                _set_error(
                    job_id,
                    f"ranking failed: {type(e).__name__}: {e}",
                    meta={
                        **embedding_metadata(provider, candidate_count=len(candidates)),
                        "error_type": type(e).__name__,
                        "error_message": str(e)[:240],
                    },
                )
                return
        _append_event(
            job_id,
            "embedding_ranking",
            f"kept top {len(ranked)} papers",
            0.22,
            meta=embedding_metadata(provider, candidate_count=len(candidates), ranked_count=len(ranked)),
        )

        # Upsert papers + landscape_papers
        try:
            paper_ids = _persist_papers_and_links(job_id, ranked)
        except Exception as e:  # noqa: BLE001
            _set_error(
                job_id,
                f"persist ranked papers failed: {type(e).__name__}: {e}",
                meta={
                    "error_type": type(e).__name__,
                    "error_message": str(e)[:240],
                    "ranked_count": len(ranked),
                },
            )
            return

        # ----- 4 + 5. Download + parse PDFs -----
        has_pdf_candidates = any(r.candidate.pdf_url for r in ranked)
        if parse_pdfs_flag and has_pdf_candidates:
            _set_stage(job_id, "downloading_pdfs", 0.3, "Downloading PDFs")
            await _download_and_parse(job_id, ranked, paper_ids)
        elif parse_pdfs_flag and not has_pdf_candidates:
            _append_event(
                job_id,
                "downloading_pdfs",
                "skipped — no candidates expose a PDF URL (likely dev fallback)",
                0.48,
                meta={"used_fallback": used_fallback},
            )
        else:
            _append_event(job_id, "downloading_pdfs", "skipped (parse_pdfs=false)", 0.48)

        # ----- 6. Extract per paper -----
        _set_stage(job_id, "extracting", 0.5, "Extracting structured notes")
        llm_fast = get_llm(strong=False)
        extraction_quality = await _extract_all(job_id, ranked, paper_ids, llm_fast)
        if extraction_quality.get("content_quality") == "degraded":
            _append_event(
                job_id,
                "extracting",
                "This landscape used fallback extraction because LLM calls failed.",
                0.775,
                meta=extraction_quality,
            )

        # ----- 7. Synthesise -----
        _set_stage(job_id, "synthesising", 0.78, "Synthesising landscape")
        bundle = _load_landscape_bundle(job_id, paper_ids)
        llm_strong = get_llm(strong=True)
        synthesis = await synthesise(
            llm_strong,
            topic=topic,
            landscape_papers=bundle,
            timeout_seconds=settings.synthesis_timeout_seconds,
        )
        synthesis_dict = synthesis.model_dump()
        synthesis_dict["content_quality"] = (
            "degraded"
            if extraction_quality.get("content_quality") == "degraded"
            else synthesis_dict.get("content_quality") or extraction_quality.get("content_quality", "ok")
        )
        synthesis_dict["extraction_quality"] = extraction_quality
        _persist_synthesis(job_id, synthesis_dict, bundle)
        _append_event(
            job_id,
            "synthesising",
            "Synthesis ready",
            0.84,
            meta={
                "content_quality": synthesis_dict.get("content_quality"),
                "clusters": len(synthesis_dict.get("clusters") or []),
                "reading_path_items": len(synthesis_dict.get("reading_path") or []),
            },
        )

        # ----- 7b. Concept glossary -----
        _set_stage(job_id, "concepts", 0.86, "Generating concept layer")
        try:
            concepts, concept_meta = await generate_concept_glossary(
                llm_strong,
                topic=topic,
                landscape_papers=bundle,
                synthesis=synthesis_dict,
                timeout_seconds=settings.concept_timeout_seconds,
            )
            persisted = _persist_concepts_for_job(job_id, concepts)
            _append_event(
                job_id,
                "concepts",
                f"Concept layer ready: {persisted} concepts",
                0.88,
                meta={
                    **concept_meta,
                    "concepts_generated": len(concepts),
                    "concepts_persisted": persisted,
                    "available": persisted > 0,
                },
            )
        except Exception as e:  # noqa: BLE001
            _append_event(
                job_id,
                "concepts",
                "Concept layer unavailable; continuing pipeline.",
                0.88,
                meta={
                    "available": False,
                    "degraded": True,
                    "error_type": type(e).__name__,
                    "error_message": str(e)[:240],
                },
            )

        # ----- 8. Active recall -----
        _set_stage(job_id, "active_recall", 0.9, "Generating quiz + flashcards")
        quizzes, flashcards = await generate_quizzes_and_flashcards(
            llm_fast,
            topic=topic,
            landscape_papers=bundle,
            timeout_seconds=settings.active_recall_timeout_seconds,
        )
        _persist_quiz_and_flashcards(job_id, quizzes, flashcards)

        _set_stage(job_id, JobStage.DONE.value, 1.0, "Pipeline complete")
        _finalize(job_id, status=LandscapeStatus.READY.value)

    except Exception as e:  # noqa: BLE001
        _set_error(job_id, f"pipeline error: {e!s}")
        raise


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------
def _persist_papers_and_links(job_id: str, ranked) -> dict[str, str]:  # type: ignore[no-untyped-def]
    """Insert/find papers, attach to landscape, return {external_id: paper_id}."""
    out: dict[str, str] = {}
    with session_scope() as s:
        job = s.get(SearchJob, job_id)
        if job is None:
            return out
        landscape_id = job.landscape_id

        for r in ranked:
            cand: PaperCandidate = r.candidate
            # Always coerce to list[float] before crossing the SQLModel/pgvector
            # boundary; pgvector reads back as numpy.ndarray, which would make
            # subsequent ``if paper.embedding`` style checks raise.
            r_embedding_list = to_list(r.embedding)
            paper = s.exec(
                select(Paper).where(
                    Paper.source == cand.source, Paper.external_id == cand.external_id
                )
            ).first()
            if paper is None:
                paper = Paper(
                    source=cand.source,
                    external_id=cand.external_id,
                    title=cand.title,
                    title_norm=normalize_title(cand.title),
                    abstract=cand.abstract,
                    authors=cand.authors,
                    year=cand.year,
                    venue=cand.venue,
                    citation_count=cand.citation_count,
                    pdf_url=cand.pdf_url,
                    arxiv_id=cand.arxiv_id,
                    doi=cand.doi,
                    url=cand.url,
                    metadata_=cand.metadata,
                    embedding=r_embedding_list,
                )
                s.add(paper)
                s.flush()
            else:
                # ``paper.embedding`` may be a numpy.ndarray after a DB read.
                # Never use it in a boolean context.
                if not has_embedding(paper.embedding) and r_embedding_list is not None:
                    paper.embedding = r_embedding_list
                    s.add(paper)
            link = s.exec(
                select(LandscapePaper).where(
                    LandscapePaper.landscape_id == landscape_id,
                    LandscapePaper.paper_id == paper.id,
                )
            ).first()
            if link is None:
                link = LandscapePaper(
                    landscape_id=landscape_id,
                    paper_id=paper.id,
                    score=r.score,
                    category=r.category,
                    rationale=r.rationale,
                )
                s.add(link)
            else:
                link.score = r.score
                link.category = r.category
                link.rationale = r.rationale
                s.add(link)
            out[cand.external_id] = paper.id
    return out


async def _download_and_parse(job_id: str, ranked, paper_ids: dict[str, str]) -> None:  # type: ignore[no-untyped-def]
    items: list[tuple[PaperCandidate, str]] = []
    for r in ranked:
        cand: PaperCandidate = r.candidate
        paper_id = paper_ids.get(cand.external_id)
        if paper_id and cand.pdf_url:
            items.append((cand, paper_id))

    total = len(items)
    if total == 0:
        _append_event(job_id, "downloading_pdfs", "skipped — no downloadable PDFs", 0.48)
        return

    download_sem = asyncio.Semaphore(4)
    parse_sem = asyncio.Semaphore(3)
    counter_lock = asyncio.Lock()
    downloaded: list[dict[str, Any]] = []
    download_done = 0
    parse_done = 0
    parse_total = total

    async def mark_download(cand: PaperCandidate, paper_id: str, status: str, message: str, extra: dict[str, Any] | None = None) -> None:
        nonlocal download_done
        async with counter_lock:
            download_done += 1
            completed = download_done
        ratio = completed / max(1, total)
        _append_event(
            job_id,
            "downloading_pdfs",
            message,
            round(0.3 + 0.12 * ratio, 3),
            meta={
                "paper_id": paper_id,
                "paper_title": cand.title,
                "status": status,
                "completed": completed,
                "total": total,
                "percent": round(ratio * 100),
                **(extra or {}),
            },
        )

    async def mark_parse(cand: PaperCandidate, paper_id: str, status: str, message: str, extra: dict[str, Any] | None = None) -> None:
        nonlocal parse_done
        async with counter_lock:
            parse_done += 1
            completed = parse_done
        ratio = completed / max(1, parse_total)
        _append_event(
            job_id,
            "parsing_pdfs",
            message,
            round(0.42 + 0.06 * ratio, 3),
            meta={
                "paper_id": paper_id,
                "paper_title": cand.title,
                "status": status,
                "completed": completed,
                "total": parse_total,
                "percent": round(ratio * 100),
                **(extra or {}),
            },
        )

    async def download_one(cand: PaperCandidate, paper_id: str) -> None:
        if not cand.pdf_url:
            await mark_download(cand, paper_id, "skipped", f"{cand.title[:80]} — no PDF URL")
            return
        async with download_sem:
            storage_path: str | None = None
            already_parsed = False
            with session_scope() as s:
                pdf_row = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
                if pdf_row and pdf_row.storage_path:
                    existing_path = resolve_pdf_storage_path(pdf_row.storage_path)
                    if existing_path and existing_path.exists():
                        storage_path = pdf_row.storage_path
                        already_parsed = pdf_row.status == "ok" and bool(pdf_row.parsed_markdown)
            if storage_path is not None:
                downloaded.append(
                    {
                        "cand": cand,
                        "paper_id": paper_id,
                        "storage_path": storage_path,
                        "already_parsed": already_parsed,
                    }
                )
                await mark_download(cand, paper_id, "cached", f"{cand.title[:80]} — cached PDF")
                return
            try:
                pdf_bytes = await download_pdf(cand.pdf_url, get_settings().max_pdf_mb)
            except Exception as e:  # noqa: BLE001
                with session_scope() as s:
                    pdf_row = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
                    if pdf_row is None:
                        pdf_row = PaperPdf(paper_id=paper_id)
                    pdf_row.status = "failed"
                    pdf_row.error = f"download failed: {e!s}"
                    s.add(pdf_row)
                await mark_download(
                    cand,
                    paper_id,
                    "failed",
                    f"{cand.title[:80]} — download failed",
                    {"error_type": type(e).__name__, "error_message": str(e)[:240]},
                )
                return
            storage_path, _path, written = store_pdf_bytes(
                pdf_bytes,
                deterministic_pdf_filename(
                    year=cand.year,
                    title=cand.title,
                    arxiv_id=cand.arxiv_id,
                    paper_id=paper_id,
                ),
            )
            with session_scope() as s:
                pdf_row = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
                if pdf_row is None:
                    pdf_row = PaperPdf(paper_id=paper_id)
                pdf_row.storage_path = storage_path
                pdf_row.bytes = len(pdf_bytes)
                s.add(pdf_row)
            downloaded.append(
                {
                    "cand": cand,
                    "paper_id": paper_id,
                    "storage_path": storage_path,
                    "already_parsed": False,
                }
            )
            await mark_download(
                cand,
                paper_id,
                "downloaded",
                f"{cand.title[:80]} — downloaded PDF",
                {"bytes": len(pdf_bytes), "written": written},
            )

    async def parse_one(item: dict[str, Any]) -> None:
        cand: PaperCandidate = item["cand"]
        paper_id = item["paper_id"]
        if item.get("already_parsed"):
            await mark_parse(cand, paper_id, "cached", f"{cand.title[:80]} — parsed PDF cached")
            return
        async with parse_sem:
            path = resolve_pdf_storage_path(item.get("storage_path"))
            if path is None or not path.exists():
                await mark_parse(cand, paper_id, "failed", f"{cand.title[:80]} — local PDF missing")
                return
            pdf_bytes = path.read_bytes()
            parsed = parse_pdf_bytes(pdf_bytes)
            with session_scope() as s:
                pdf_row = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
                if pdf_row is None:
                    pdf_row = PaperPdf(paper_id=paper_id)
                pdf_row.storage_path = item.get("storage_path") or pdf_row.storage_path
                pdf_row.bytes = len(pdf_bytes)
                if parsed.ok:
                    pdf_row.status = "ok"
                    pdf_row.parsed_markdown = parsed.markdown
                    pdf_row.error = None
                else:
                    pdf_row.status = "failed"
                    pdf_row.error = parsed.error
                s.add(pdf_row)
                if parsed.ok:
                    _replace_sections_and_chunks(s, paper_id, parsed.sections)
            await mark_parse(
                cand,
                paper_id,
                "ok" if parsed.ok else "failed",
                f"{cand.title[:80]} — {'ok' if parsed.ok else parsed.error}",
                {"bytes": len(pdf_bytes), "sections": len(parsed.sections) if parsed.ok else 0},
            )

    _set_stage(
        job_id,
        "downloading_pdfs",
        0.3,
        f"Downloading PDFs: 0 / {total}",
        meta={"completed": 0, "total": total, "percent": 0},
    )
    await asyncio.gather(*(download_one(cand, paper_id) for cand, paper_id in items))
    parse_total = len(downloaded)
    _set_stage(
        job_id,
        "parsing_pdfs",
        0.42,
        f"Parsing PDFs: 0 / {parse_total}",
        meta={"completed": 0, "total": parse_total, "percent": 0, "downloaded": len(downloaded)},
    )
    await asyncio.gather(*(parse_one(item) for item in downloaded))
    _set_stage(job_id, "parsing_pdfs", 0.48, "PDF parsing complete")


def _replace_sections_and_chunks(s, paper_id: str, sections: list[tuple[str, str]]) -> None:  # type: ignore[no-untyped-def]
    s.exec(delete(Chunk).where(Chunk.paper_id == paper_id))
    s.exec(delete(PaperSection).where(PaperSection.paper_id == paper_id))
    chunk_ordinal = 0
    for section_ordinal, (heading, content) in enumerate(sections):
        section = PaperSection(
            paper_id=paper_id,
            ordinal=section_ordinal,
            heading=heading,
            page_start=None,
            page_end=None,
            content=content,
        )
        s.add(section)
        s.flush()
        char_start = 0
        for chunk_text, start, end in _chunk_text_with_ranges(content, target_chars=1200, overlap=120):
            s.add(
                Chunk(
                    paper_id=paper_id,
                    section_id=section.id,
                    ordinal=chunk_ordinal,
                    section_heading=heading,
                    page_start=None,
                    page_end=None,
                    char_start=char_start + start,
                    char_end=char_start + end,
                    content=chunk_text,
                )
            )
            chunk_ordinal += 1


def _chunk_text_with_ranges(text: str, target_chars: int, overlap: int) -> list[tuple[str, int, int]]:
    text = text or ""
    out: list[tuple[str, int, int]] = []
    pos = 0
    while pos < len(text):
        end = min(len(text), pos + target_chars)
        if end < len(text):
            split = text.rfind("\n\n", pos, end)
            if split > pos + 300:
                end = split
        chunk = text[pos:end].strip()
        if chunk:
            leading = len(text[pos:end]) - len(text[pos:end].lstrip())
            trailing = len(text[pos:end].rstrip())
            out.append((chunk, pos + leading, pos + trailing))
        if end >= len(text):
            break
        pos = max(pos + 1, end - overlap)
    return out


async def _extract_all(
    job_id: str,
    ranked,  # type: ignore[no-untyped-def]
    paper_ids: dict[str, str],
    llm,  # type: ignore[no-untyped-def]
) -> dict[str, Any]:
    total = len(ranked)
    sem = asyncio.Semaphore(3)
    stats: dict[str, Any] = {
        "total": 0,
        "degraded": 0,
        "ok": 0,
        "grounded_fields": 0,
        "ungrounded_fields": 0,
        "confidence_sum": 0.0,
    }
    stats_lock = asyncio.Lock()

    async def one(idx: int, r) -> None:  # type: ignore[no-untyped-def]
        async with sem:
            cand: PaperCandidate = r.candidate
            paper_id = paper_ids.get(cand.external_id)
            if paper_id is None:
                return
            # Cached?
            with session_scope() as s:
                row = s.exec(select(Extraction).where(Extraction.paper_id == paper_id)).first()
                if row is not None and not _extraction_needs_refresh(row.data):
                    async with stats_lock:
                        stats["total"] += 1
                        grounding = ((row.data or {}).get("_fieldmap") or {}).get("grounding") or {}
                        stats["grounded_fields"] += int(grounding.get("grounded_fields") or 0)
                        stats["ungrounded_fields"] += int(grounding.get("ungrounded_fields") or 0)
                        stats["confidence_sum"] += float(row.data.get("confidence") or 0.0)
                        if _extraction_is_degraded(row.data):
                            stats["degraded"] += 1
                        else:
                            stats["ok"] += 1
                    return
                pdf_row = s.exec(select(PaperPdf).where(PaperPdf.paper_id == paper_id)).first()
                paper_text = pdf_row.parsed_markdown if (pdf_row and pdf_row.parsed_markdown) else None
                section_rows = s.exec(
                    select(PaperSection).where(PaperSection.paper_id == paper_id).order_by(PaperSection.ordinal)
                ).all()
                sections = [(x.heading, x.content) for x in section_rows]
                chunk_rows = s.exec(
                    select(Chunk).where(Chunk.paper_id == paper_id).order_by(Chunk.ordinal)
                ).all()
                chunks = [
                    {
                        "chunk_id": c.id,
                        "chunk_ordinal": c.ordinal,
                        "section": c.section_heading,
                        "page": c.page_start,
                        "text": c.content,
                    }
                    for c in chunk_rows
                ]
                paper = s.get(Paper, paper_id)
                title = paper.title if paper else cand.title
                abstract = paper.abstract if paper else cand.abstract
                authors = paper.authors if paper else cand.authors
                year = paper.year if paper else cand.year
                venue = paper.venue if paper else cand.venue

            result = await extract_paper(
                llm,
                paper_id=paper_id,
                title=title,
                abstract=abstract,
                authors=authors,
                year=year,
                venue=venue,
                paper_text=paper_text,
                sections=sections,
                chunks=chunks,
            )
            with session_scope() as s:
                ext = s.exec(select(Extraction).where(Extraction.paper_id == paper_id)).first()
                if ext is None:
                    ext = Extraction(paper_id=paper_id)
                ext.data = result.data
                ext.model = getattr(llm, "default_model", None)
                ext.confidence = result.data.get("confidence")
                s.add(ext)
                # Also reflect difficulty / priority onto the landscape link.
                link = s.exec(
                    select(LandscapePaper).where(
                        LandscapePaper.landscape_id == _landscape_id_of(s, job_id),
                        LandscapePaper.paper_id == paper_id,
                    )
                ).first()
                if link is not None and result.data.get("reading_priority"):
                    link.category = result.data["reading_priority"]
                    s.add(link)
            async with stats_lock:
                stats["total"] += 1
                grounding = (result.data.get("_fieldmap") or {}).get("grounding") or {}
                stats["grounded_fields"] += int(grounding.get("grounded_fields") or 0)
                stats["ungrounded_fields"] += int(grounding.get("ungrounded_fields") or 0)
                stats["confidence_sum"] += float(result.data.get("confidence") or 0.0)
                if result.degraded:
                    stats["degraded"] += 1
                else:
                    stats["ok"] += 1
            prog = 0.5 + 0.27 * ((idx + 1) / max(1, total))
            meta: dict[str, Any] = {
                "paper_id": paper_id,
                "paper_title": title,
                "provider": getattr(llm, "name", "unknown"),
                "model": getattr(llm, "default_model", None),
                "degraded": result.degraded,
                "fallback_reason": result.fallback_reason,
                "retry_used": result.retry_used,
                "chunks_supplied_to_extraction": (result.diagnostics or {}).get("chunks_supplied"),
                "grounded_fields": ((result.data.get("_fieldmap") or {}).get("grounding") or {}).get("grounded_fields"),
                "ungrounded_fields": ((result.data.get("_fieldmap") or {}).get("grounding") or {}).get("ungrounded_fields"),
                "extraction_confidence": result.data.get("confidence"),
                **(result.diagnostics or {}),
            }
            _append_event(
                job_id,
                "extracting",
                f"{cand.title[:80]} — {'ok' if not result.error else result.error}",
                round(prog, 3),
                meta=meta,
            )

    await asyncio.gather(*(one(i, r) for i, r in enumerate(ranked)))
    degraded = stats["degraded"]
    total_done = stats["total"]
    content_quality = "degraded" if total_done and degraded >= max(1, (total_done // 2) + 1) else "ok"
    return {
        "content_quality": content_quality,
        "total_extractions": total_done,
        "degraded_extractions": degraded,
        "ok_extractions": stats["ok"],
        "grounded_fields": stats["grounded_fields"],
        "ungrounded_fields": stats["ungrounded_fields"],
        "average_extraction_confidence": round(stats["confidence_sum"] / max(1, total_done), 3),
    }


def _extraction_is_degraded(data: dict[str, Any]) -> bool:
    meta = (data or {}).get("_fieldmap") or {}
    if meta:
        return bool(meta.get("degraded"))
    return _is_low_signal_extraction(data)


def _extraction_needs_refresh(data: dict[str, Any]) -> bool:
    meta = (data or {}).get("_fieldmap") or {}
    if meta.get("degraded"):
        return True
    if "grounding" not in meta:
        return True
    return not meta and _is_low_signal_extraction(data)


def _is_low_signal_extraction(data: dict[str, Any]) -> bool:
    if not data:
        return True
    text_fields = ["problem", "motivation", "research_question", "method", "contribution", "novelty"]
    list_fields = [
        "results",
        "limitations",
        "datasets",
        "benchmarks",
        "baselines",
        "metrics",
        "key_terms",
        "source_grounding",
    ]
    text_signal = [
        str(data.get(k) or "").strip()
        for k in text_fields
        if str(data.get(k) or "").strip().lower() not in {"", "not reported", "not reported."}
    ]
    list_signal = [item for k in list_fields for item in (data.get(k) or []) if str(item).strip()]
    return len(text_signal) + len(list_signal) < 2


def _landscape_id_of(s, job_id: str) -> str:  # type: ignore[no-untyped-def]
    job = s.get(SearchJob, job_id)
    return job.landscape_id


def _load_landscape_bundle(job_id: str, paper_ids: dict[str, str]) -> list[dict[str, Any]]:
    bundle: list[dict[str, Any]] = []
    with session_scope() as s:
        landscape_id = _landscape_id_of(s, job_id)
        links = s.exec(
            select(LandscapePaper).where(LandscapePaper.landscape_id == landscape_id)
        ).all()
        for link in links:
            paper = s.get(Paper, link.paper_id)
            ext = s.exec(select(Extraction).where(Extraction.paper_id == link.paper_id)).first()
            if paper is None:
                continue
            bundle.append(
                {
                    "paper_id": paper.id,
                    "title": paper.title,
                    "year": paper.year,
                    "authors": paper.authors,
                    "venue": paper.venue,
                    "url": paper.url,
                    "pdf_url": paper.pdf_url,
                    "arxiv_id": paper.arxiv_id,
                    "category": link.category,
                    "cluster_id": link.cluster_id,
                    "score": link.score,
                    "rationale": link.rationale,
                    "extraction": ext.data if ext else None,
                }
            )
    return bundle


def _persist_synthesis(job_id: str, synthesis_dict: dict[str, Any], bundle: list[dict[str, Any]]) -> None:
    with session_scope() as s:
        landscape_id = _landscape_id_of(s, job_id)
        landscape = s.get(Landscape, landscape_id)
        if landscape is None:
            return
        landscape.synthesis = synthesis_dict
        s.add(landscape)

        # Replace prior clusters (and their cluster_paper links).
        prior_clusters = s.exec(select(Cluster).where(Cluster.landscape_id == landscape_id)).all()
        prior_ids = {c.id for c in prior_clusters}
        if prior_ids:
            prior_cps = s.exec(select(ClusterPaper).where(ClusterPaper.cluster_id.in_(prior_ids))).all()
            for cp in prior_cps:
                s.delete(cp)
        for c in prior_clusters:
            s.delete(c)
        s.flush()

        title_to_pid = {b["title"]: b["paper_id"] for b in bundle}
        for ord_, c in enumerate(synthesis_dict.get("clusters") or []):
            row = Cluster(
                landscape_id=landscape_id,
                name=c.get("name") or f"Cluster {ord_ + 1}",
                summary=c.get("summary"),
                ordinal=ord_,
            )
            s.add(row)
            s.flush()
            for pid_or_title in c.get("paper_ids") or []:
                paper_id = pid_or_title if pid_or_title in {b["paper_id"] for b in bundle} else title_to_pid.get(pid_or_title)
                if paper_id:
                    s.add(ClusterPaper(cluster_id=row.id, paper_id=paper_id))
                    # Set landscape_paper cluster + reading order
                    link = s.exec(
                        select(LandscapePaper).where(
                            LandscapePaper.landscape_id == landscape_id,
                            LandscapePaper.paper_id == paper_id,
                        )
                    ).first()
                    if link is not None:
                        link.cluster_id = row.id
                        s.add(link)

        for step_idx, step in enumerate(synthesis_dict.get("reading_path") or []):
            pid = step.get("paper_id")
            if pid not in {b["paper_id"] for b in bundle}:
                pid = title_to_pid.get(step.get("title"))
            if not pid:
                continue
            link = s.exec(
                select(LandscapePaper).where(
                    LandscapePaper.landscape_id == landscape_id,
                    LandscapePaper.paper_id == pid,
                )
            ).first()
            if link is not None:
                link.reading_order = step_idx + 1
                s.add(link)

        refreshed_bundle: list[dict[str, Any]] = []
        for b in bundle:
            link = s.exec(
                select(LandscapePaper).where(
                    LandscapePaper.landscape_id == landscape_id,
                    LandscapePaper.paper_id == b["paper_id"],
                )
            ).first()
            item = dict(b)
            item["cluster_id"] = link.cluster_id if link else b.get("cluster_id")
            refreshed_bundle.append(item)

        for rel in s.exec(select(PaperRelationship).where(PaperRelationship.landscape_id == landscape_id)).all():
            s.delete(rel)
        s.flush()
        for rel in generate_paper_relationships(refreshed_bundle):
            s.add(
                PaperRelationship(
                    landscape_id=landscape_id,
                    src_paper_id=rel["source_paper_id"],
                    dst_paper_id=rel["target_paper_id"],
                    kind=rel["type"],
                    note=rel.get("rationale"),
                )
            )


def _persist_concepts_for_job(job_id: str, concepts: list[dict[str, Any]]) -> int:
    with session_scope() as s:
        landscape_id = _landscape_id_of(s, job_id)
        return persist_concepts(s, landscape_id, concepts)


def _persist_quiz_and_flashcards(
    job_id: str,
    quizzes: list[dict[str, Any]],
    flashcards: list[dict[str, Any]],
) -> None:
    with session_scope() as s:
        landscape_id = _landscape_id_of(s, job_id)
        # Replace prior items so re-runs don't accumulate duplicates.
        for q in s.exec(select(Quiz).where(Quiz.landscape_id == landscape_id)).all():
            s.delete(q)
        for f in s.exec(select(Flashcard).where(Flashcard.landscape_id == landscape_id)).all():
            s.delete(f)

        for q in quizzes:
            s.add(
                Quiz(
                    landscape_id=landscape_id,
                    question=q["question"],
                    options=q["options"],
                    correct_index=q["correct_index"],
                    explanation=q.get("explanation"),
                    paper_id=q.get("paper_id"),
                    concept=q.get("concept"),
                    difficulty=q.get("difficulty", 1),
                )
            )
        for f in flashcards:
            s.add(
                Flashcard(
                    landscape_id=landscape_id,
                    front=f["front"],
                    back=f["back"],
                    paper_id=f.get("paper_id"),
                    concept=f.get("concept"),
                    kind=f.get("kind", "recall"),
                )
            )


# ---------------------------------------------------------------------------
# Job event helpers
# ---------------------------------------------------------------------------
def _set_stage(
    job_id: str,
    stage: str,
    progress: float,
    message: str,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    with session_scope() as s:
        job = s.get(SearchJob, job_id)
        if job is None:
            return
        job.stage = stage
        job.progress = progress
        events = list(job.events or [])
        events.append(_event(stage, message, progress, meta))
        job.events = events
        s.add(job)


def _append_event(
    job_id: str,
    stage: str,
    message: str,
    progress: float,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    with session_scope() as s:
        job = s.get(SearchJob, job_id)
        if job is None:
            return
        events = list(job.events or [])
        events.append(_event(stage, message, progress, meta))
        job.events = events
        job.progress = max(job.progress, progress)
        s.add(job)


def _event(stage: str, message: str, progress: float, meta: Optional[dict[str, Any]]) -> dict[str, Any]:
    ev: dict[str, Any] = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "stage": stage,
        "message": message,
        "progress": progress,
    }
    if meta:
        ev["meta"] = meta
    return ev


def _set_error(job_id: str, msg: str, meta: Optional[dict[str, Any]] = None) -> None:
    with session_scope() as s:
        job = s.get(SearchJob, job_id)
        if job is None:
            return
        job.error = msg
        job.stage = JobStage.FAILED.value
        job.finished_at = datetime.utcnow()
        events = list(job.events or [])
        events.append(_event(JobStage.FAILED.value, msg, job.progress, meta))
        job.events = events
        s.add(job)
        landscape = s.get(Landscape, job.landscape_id)
        if landscape:
            landscape.status = LandscapeStatus.FAILED.value
            s.add(landscape)


def _finalize(job_id: str, status: str) -> None:
    with session_scope() as s:
        job = s.get(SearchJob, job_id)
        if job is None:
            return
        job.finished_at = datetime.utcnow()
        s.add(job)
        landscape = s.get(Landscape, job.landscape_id)
        if landscape:
            landscape.status = status
            s.add(landscape)
