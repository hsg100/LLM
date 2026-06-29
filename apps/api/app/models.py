"""SQLModel tables for FieldMap.

Embedding columns use pgvector with a fixed dimension matching
``Settings.embedding_dim`` (384 by default, for local bge-small). All flexible/optional
LLM output is stored in JSONB so the schema does not break when
prompts evolve.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    Identity,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.config import get_settings


EMBED_DIM = get_settings().embedding_dim


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


# ---------------------------------------------------------------------------
# Users (single-user alpha, but model exists)
# ---------------------------------------------------------------------------
class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(default_factory=_uuid, primary_key=True)
    email: str = Field(sa_column=Column(String, unique=True, index=True))
    name: Optional[str] = None
    # Auth: PBKDF2 hash (see app.services.auth). Nullable so the legacy default
    # single-user row (which never logs in) can exist without a password.
    password_hash: Optional[str] = Field(default=None, sa_column=Column(Text))
    is_admin: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# Landscapes
# ---------------------------------------------------------------------------
class Landscape(SQLModel, table=True):
    __tablename__ = "landscapes"

    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: Optional[str] = Field(default=None, foreign_key="users.id", index=True)
    topic: str = Field(sa_column=Column(Text, nullable=False))
    settings: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}"))
    synthesis: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}"))
    # See app.pipeline.LandscapeStatus for the canonical values.
    status: str = Field(default="queued", index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(
        sa_column=Column(DateTime, default=_now, onupdate=_now, nullable=False)
    )


# ---------------------------------------------------------------------------
# Search jobs / pipeline state
# ---------------------------------------------------------------------------
class SearchJob(SQLModel, table=True):
    __tablename__ = "search_jobs"

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    # See app.pipeline.JobStage for the canonical values.
    stage: str = Field(default="queued", index=True)
    progress: float = Field(default=0.0)
    # Cooperative cancellation flag; the worker checks it at stage boundaries.
    cancel_requested: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=_now)


class JobEvent(SQLModel, table=True):
    """Append-only progress events for a SearchJob.

    Replaces the prior JSONB list on ``SearchJob.events`` (which was rewritten
    in full on every append, racing under concurrent pipeline tasks). One row
    per event; ``seq`` is a DB-assigned monotonic identity used both for stable
    ordering and as the SSE cursor.
    """

    __tablename__ = "job_events"
    __table_args__ = (
        Index("ix_job_events_job_seq", "job_id", "seq"),
    )

    id: str = Field(default_factory=_uuid, primary_key=True)
    job_id: str = Field(foreign_key="search_jobs.id", index=True)
    seq: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, Identity(always=False), nullable=False, unique=True, index=True),
    )
    ts: datetime = Field(default_factory=_now)
    stage: str = Field(index=True)
    message: str = Field(sa_column=Column(Text))
    progress: float = Field(default=0.0)
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}"))
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# Papers (global, deduped) and per-landscape links
# ---------------------------------------------------------------------------
class Paper(SQLModel, table=True):
    __tablename__ = "papers"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_papers_source_extid"),
        Index("ix_papers_title_norm", "title_norm"),
    )

    id: str = Field(default_factory=_uuid, primary_key=True)
    source: str = Field(index=True)  # arxiv, semantic_scholar, openalex
    external_id: str = Field(index=True)
    title: str = Field(sa_column=Column(Text))
    title_norm: str = Field(sa_column=Column(Text))
    abstract: Optional[str] = Field(default=None, sa_column=Column(Text))
    authors: list[str] = Field(default_factory=list, sa_column=Column(JSONB, server_default="[]"))
    year: Optional[int] = Field(default=None, index=True)
    venue: Optional[str] = None
    citation_count: Optional[int] = Field(default=None, index=True)
    pdf_url: Optional[str] = Field(default=None, sa_column=Column(Text))
    arxiv_id: Optional[str] = Field(default=None, index=True)
    doi: Optional[str] = Field(default=None, index=True)
    url: Optional[str] = Field(default=None, sa_column=Column(Text))
    metadata_: dict[str, Any] = Field(default_factory=dict, sa_column=Column("metadata", JSONB, server_default="{}"))
    embedding: Optional[list[float]] = Field(
        default=None, sa_column=Column(Vector(EMBED_DIM), nullable=True)
    )
    created_at: datetime = Field(default_factory=_now)


class LandscapePaper(SQLModel, table=True):
    __tablename__ = "landscape_papers"
    __table_args__ = (
        UniqueConstraint("landscape_id", "paper_id", name="uq_lp"),
    )

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)
    score: float = Field(default=0.0, sa_column=Column(Float, index=True))
    category: str = Field(default="optional", index=True)  # must-read/useful/optional/skip-for-now
    rationale: Optional[str] = Field(default=None, sa_column=Column(Text))
    cluster_id: Optional[str] = Field(default=None, foreign_key="clusters.id", index=True)
    reading_order: Optional[int] = Field(default=None, index=True)


# ---------------------------------------------------------------------------
# PDF + parsed content
# ---------------------------------------------------------------------------
class PaperPdf(SQLModel, table=True):
    __tablename__ = "paper_pdfs"

    id: str = Field(default_factory=_uuid, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True, unique=True)
    status: str = Field(default="pending", index=True)  # pending/ok/failed
    bytes: Optional[int] = None
    storage_path: Optional[str] = Field(default=None, sa_column=Column(Text))
    parsed_markdown: Optional[str] = Field(default=None, sa_column=Column(Text))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=_now)


class PaperSection(SQLModel, table=True):
    __tablename__ = "paper_sections"
    __table_args__ = (
        Index("ix_section_paper_ord", "paper_id", "ordinal"),
    )

    id: str = Field(default_factory=_uuid, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)
    ordinal: int = 0
    heading: Optional[str] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    content: str = Field(sa_column=Column(Text))


class Chunk(SQLModel, table=True):
    __tablename__ = "chunks"
    __table_args__ = (
        Index("ix_chunk_paper_ord", "paper_id", "ordinal"),
    )

    id: str = Field(default_factory=_uuid, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)
    section_id: Optional[str] = Field(default=None, foreign_key="paper_sections.id")
    ordinal: int = 0
    section_heading: Optional[str] = Field(default=None, sa_column=Column(Text))
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    content: str = Field(sa_column=Column(Text))
    embedding: Optional[list[float]] = Field(
        default=None, sa_column=Column(Vector(EMBED_DIM), nullable=True)
    )


# ---------------------------------------------------------------------------
# Extractions (structured per-paper LLM output)
# ---------------------------------------------------------------------------
class Extraction(SQLModel, table=True):
    __tablename__ = "extractions"

    id: str = Field(default_factory=_uuid, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True, unique=True)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}"))
    model: Optional[str] = None
    confidence: Optional[float] = None
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# Clusters and inter-paper relationships
# ---------------------------------------------------------------------------
class Cluster(SQLModel, table=True):
    __tablename__ = "clusters"

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    name: str = Field(sa_column=Column(Text))
    summary: Optional[str] = Field(default=None, sa_column=Column(Text))
    ordinal: int = 0


class ClusterPaper(SQLModel, table=True):
    __tablename__ = "cluster_papers"
    __table_args__ = (UniqueConstraint("cluster_id", "paper_id", name="uq_cp"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    cluster_id: str = Field(foreign_key="clusters.id", index=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)


class PaperRelationship(SQLModel, table=True):
    __tablename__ = "paper_relationships"

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    src_paper_id: str = Field(foreign_key="papers.id", index=True)
    dst_paper_id: str = Field(foreign_key="papers.id", index=True)
    kind: str = Field(index=True)  # extends, contradicts, applies, benchmarks, prerequisite
    note: Optional[str] = Field(default=None, sa_column=Column(Text))


# ---------------------------------------------------------------------------
# Concepts & glossary
# ---------------------------------------------------------------------------
class Concept(SQLModel, table=True):
    __tablename__ = "concepts"
    __table_args__ = (UniqueConstraint("landscape_id", "name", name="uq_concept"),)

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    name: str = Field(sa_column=Column(Text))
    term: Optional[str] = Field(default=None, sa_column=Column(Text))
    slug: Optional[str] = Field(default=None, sa_column=Column(String, index=True))
    aliases: list[str] = Field(default_factory=list, sa_column=Column(JSONB, server_default="[]"))
    short_definition: Optional[str] = Field(default=None, sa_column=Column(Text))
    long_definition: Optional[str] = Field(default=None, sa_column=Column(Text))
    why_it_matters: Optional[str] = Field(default=None, sa_column=Column(Text))
    related_terms: list[str] = Field(default_factory=list, sa_column=Column(JSONB, server_default="[]"))
    paper_ids: list[str] = Field(default_factory=list, sa_column=Column(JSONB, server_default="[]"))
    source_grounding: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSONB, server_default="[]"))
    confidence: float = Field(default=0.5, sa_column=Column(Float))
    importance: float = Field(default=0.5, sa_column=Column(Float))
    definition: Optional[str] = Field(default=None, sa_column=Column(Text))
    prerequisites: list[str] = Field(default_factory=list, sa_column=Column(JSONB, server_default="[]"))
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(
        sa_column=Column(DateTime, default=_now, onupdate=_now, nullable=False)
    )


# ---------------------------------------------------------------------------
# Active recall: quizzes + flashcards
# ---------------------------------------------------------------------------
class Quiz(SQLModel, table=True):
    __tablename__ = "quizzes"

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    question: str = Field(sa_column=Column(Text))
    options: list[str] = Field(default_factory=list, sa_column=Column(JSONB, nullable=False, server_default="[]"))
    correct_index: int = 0
    explanation: Optional[str] = Field(default=None, sa_column=Column(Text))
    paper_id: Optional[str] = Field(default=None, foreign_key="papers.id")
    concept: Optional[str] = None
    difficulty: int = 1


class Flashcard(SQLModel, table=True):
    __tablename__ = "flashcards"

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    front: str = Field(sa_column=Column(Text))
    back: str = Field(sa_column=Column(Text))
    paper_id: Optional[str] = Field(default=None, foreign_key="papers.id")
    concept: Optional[str] = None
    kind: str = Field(default="recall")  # recall / explain / cloze


class ReviewAttempt(SQLModel, table=True):
    __tablename__ = "review_attempts"

    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: Optional[str] = Field(default=None, foreign_key="users.id", index=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    item_kind: str  # quiz / flashcard
    item_id: str = Field(index=True)
    correct: Optional[bool] = None
    rating: Optional[int] = None  # FSRS grade 1-4 (Again/Hard/Good/Easy)
    created_at: datetime = Field(default_factory=_now)


class ReviewState(SQLModel, table=True):
    """Per-item FSRS scheduling state (one row per user × item)."""

    __tablename__ = "review_states"
    __table_args__ = (
        UniqueConstraint("user_id", "item_kind", "item_id", name="uq_review_state"),
        Index("ix_review_state_due", "user_id", "due"),
    )

    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: Optional[str] = Field(default=None, foreign_key="users.id", index=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    item_kind: str  # quiz / flashcard
    item_id: str = Field(index=True)
    stability: Optional[float] = Field(default=None, sa_column=Column(Float))
    difficulty: Optional[float] = Field(default=None, sa_column=Column(Float))
    state: str = Field(default="new")  # new / review / relearning
    reps: int = 0
    lapses: int = 0
    last_review: Optional[datetime] = None
    due: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(
        sa_column=Column(DateTime, default=_now, onupdate=_now, nullable=False)
    )


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------
class RuntimeSettings(SQLModel, table=True):
    """Single-row store of runtime-editable setting overrides.

    A JSONB ``overrides`` map (setting name -> value) layered on top of the
    env-based defaults by app.runtime_settings.effective_settings(). Secrets and
    schema-coupled values (DB/Redis URLs, embedding dim) stay env-only.
    """

    __tablename__ = "runtime_settings"

    id: str = Field(default="singleton", primary_key=True)
    overrides: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}"))
    updated_at: datetime = Field(
        sa_column=Column(DateTime, default=_now, onupdate=_now, nullable=False)
    )


class ObsidianExport(SQLModel, table=True):
    __tablename__ = "obsidian_exports"

    id: str = Field(default_factory=_uuid, primary_key=True)
    landscape_id: str = Field(foreign_key="landscapes.id", index=True)
    file_path: str = Field(sa_column=Column(Text))
    content_hash: str = Field(index=True)
    commit_sha: Optional[str] = None
    pushed: bool = False
    created_at: datetime = Field(default_factory=_now)
