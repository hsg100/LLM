"""Pydantic request/response schemas + the canonical Extraction schema.

The Extraction schema mirrors the JSON contract from the build handoff
exactly and is the source of truth the LLM extraction service validates
against.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Landscape creation / status
# ---------------------------------------------------------------------------
class LandscapeCreate(BaseModel):
    topic: str = Field(min_length=2, max_length=500)
    max_papers: Optional[int] = None
    sources: list[str] = Field(default_factory=lambda: ["arxiv"])
    parse_pdfs: bool = True
    settings: dict[str, Any] = Field(default_factory=dict)


class LandscapeOut(BaseModel):
    id: str
    topic: str
    status: str
    synthesis: dict[str, Any]
    settings: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class JobEvent(BaseModel):
    ts: datetime
    stage: str
    message: str
    progress: float
    meta: Optional[dict[str, Any]] = None


class JobOut(BaseModel):
    id: str
    landscape_id: str
    stage: str
    progress: float
    events: list[JobEvent]
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Paper API shapes
# ---------------------------------------------------------------------------
class PaperOut(BaseModel):
    id: str
    source: str
    external_id: str
    title: str
    abstract: Optional[str]
    authors: list[str]
    year: Optional[int]
    venue: Optional[str]
    citation_count: Optional[int]
    pdf_url: Optional[str]
    arxiv_id: Optional[str]
    url: Optional[str]


class LandscapePaperOut(BaseModel):
    paper: PaperOut
    score: float
    category: str
    rationale: Optional[str] = None
    cluster_id: Optional[str] = None
    reading_order: Optional[int] = None


# ---------------------------------------------------------------------------
# Extraction schema — canonical
# ---------------------------------------------------------------------------
ReadingPriority = Literal["must-read", "useful", "optional", "skip-for-now"]


class SourceGrounding(BaseModel):
    field: str
    section: Optional[str] = None
    page: Optional[int] = None
    chunk_id: Optional[str] = None
    chunk_ordinal: Optional[int] = None
    quote: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0, le=1)

    @field_validator("field")
    @classmethod
    def _clean_field(cls, v: str) -> str:
        return str(v or "").strip()

    @field_validator("quote")
    @classmethod
    def _short_quote(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        text = " ".join(str(v).split())
        return text[:500] if text else None


class Extraction(BaseModel):
    problem: str = "Not reported"
    motivation: str = "Not reported"
    research_question: str = "Not reported"
    method: str = "Not reported"
    contribution: str = "Not reported"
    novelty: str = "Not reported"
    results: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    datasets: list[str] = Field(default_factory=list)
    benchmarks: list[str] = Field(default_factory=list)
    baselines: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    implementation_details: list[str] = Field(default_factory=list)
    mathematical_ideas: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    key_terms: list[str] = Field(default_factory=list)
    related_papers: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    project_ideas: list[str] = Field(default_factory=list)
    difficulty_level: int = 1
    reading_priority: ReadingPriority = "optional"
    confidence: float = 0.0
    source_grounding: list[SourceGrounding] = Field(default_factory=list)

    @field_validator("difficulty_level")
    @classmethod
    def _clamp_difficulty(cls, v: int) -> int:
        return max(1, min(5, int(v)))

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, v: float) -> float:
        return max(0.0, min(1.0, float(v)))

    @field_validator("source_grounding", mode="before")
    @classmethod
    def _coerce_legacy_grounding(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return []
        out = []
        for item in v:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    out.append({"field": "general", "quote": text, "confidence": 0.3})
            else:
                out.append(item)
        return out


# ---------------------------------------------------------------------------
# Synthesis (the landscape document)
# ---------------------------------------------------------------------------
class ClusterOut(BaseModel):
    id: Optional[str] = None
    name: str
    summary: str
    paper_ids: list[str] = Field(default_factory=list)


class ReadingPathStep(BaseModel):
    paper_id: str
    title: str
    why: str
    cluster: Optional[str] = None


class Synthesis(BaseModel):
    field_overview: str = ""
    why_it_matters: str = ""
    content_quality: str = "ok"
    extraction_quality: dict[str, Any] = Field(default_factory=dict)
    clusters: list[ClusterOut] = Field(default_factory=list)
    must_read_paper_ids: list[str] = Field(default_factory=list)
    reading_path: list[ReadingPathStep] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    datasets_benchmarks: list[str] = Field(default_factory=list)
    method_timeline: list[dict[str, Any]] = Field(default_factory=list)
    tensions: list[str] = Field(default_factory=list)
    open_problems: list[str] = Field(default_factory=list)
    project_ideas: list[str] = Field(default_factory=list)
    skip_for_now: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Quiz + flashcards
# ---------------------------------------------------------------------------
class QuizOut(BaseModel):
    id: str
    question: str
    options: list[str]
    correct_index: int
    explanation: Optional[str]
    paper_id: Optional[str]
    concept: Optional[str]
    difficulty: int


class FlashcardOut(BaseModel):
    id: str
    front: str
    back: str
    paper_id: Optional[str]
    concept: Optional[str]
    kind: str


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class SettingsOut(BaseModel):
    llm_provider: str
    llm_model_fast: str
    llm_model_strong: str
    embedding_provider: str
    embedding_model: str
    embedding_dim: int
    obsidian_export_repo_path: str
    obsidian_export_auto_push: bool
    max_papers_per_landscape: int
    has_openai_key: bool
    has_deepseek_key: bool
    has_anthropic_key: bool


class SettingsPatch(BaseModel):
    obsidian_export_auto_push: Optional[bool] = None
    max_papers_per_landscape: Optional[int] = None


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
class ExportRequest(BaseModel):
    push: Optional[bool] = None
    force: bool = False


class ExportResult(BaseModel):
    files: list[str]
    commit_sha: Optional[str]
    pushed: bool
