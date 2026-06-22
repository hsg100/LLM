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
    sources: list[str] = Field(default_factory=lambda: ["arxiv", "semantic_scholar"])
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
    cancel_requested: bool = False
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
FieldEdgeType = Literal[
    "prerequisite",
    "subfield",
    "related",
    "method_flow",
    "evaluation_flow",
    "builds_to",
]


class FieldNode(BaseModel):
    id: str
    label: str
    type: Optional[str] = None
    description: Optional[str] = None
    importance: Optional[float] = Field(default=None, ge=0, le=1)


class FieldEdge(BaseModel):
    source: str
    target: str
    type: FieldEdgeType
    label: Optional[str] = None
    rationale: Optional[str] = None


class FieldStructure(BaseModel):
    nodes: list[FieldNode] = Field(default_factory=list)
    edges: list[FieldEdge] = Field(default_factory=list)


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


class PaperRationale(BaseModel):
    paper_id: str
    rationale: str  # one-sentence "why read this / why skip" for the reader


class Synthesis(BaseModel):
    field_overview: str = ""
    why_it_matters: str = ""
    content_quality: str = "ok"
    extraction_quality: dict[str, Any] = Field(default_factory=dict)
    field_structure: FieldStructure = Field(default_factory=FieldStructure)
    # True when the field_structure DAG was authored by the LLM; False when it
    # fell back to the deterministic outline (frontend labels it as such).
    field_structure_generated: bool = False
    clusters: list[ClusterOut] = Field(default_factory=list)
    must_read_paper_ids: list[str] = Field(default_factory=list)
    reading_path: list[ReadingPathStep] = Field(default_factory=list)
    paper_rationales: list[PaperRationale] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    datasets_benchmarks: list[str] = Field(default_factory=list)
    method_timeline: list[dict[str, Any]] = Field(default_factory=list)
    tensions: list[str] = Field(default_factory=list)
    open_problems: list[str] = Field(default_factory=list)
    project_ideas: list[str] = Field(default_factory=list)
    skip_for_now: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Concepts
# ---------------------------------------------------------------------------
class ConceptOut(BaseModel):
    id: str
    landscape_id: str
    term: str
    slug: str
    aliases: list[str] = Field(default_factory=list)
    short_definition: str = ""
    long_definition: str = ""
    why_it_matters: str = ""
    related_terms: list[str] = Field(default_factory=list)
    paper_ids: list[str] = Field(default_factory=list)
    source_grounding: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0, le=1)
    importance: float = Field(default=0.0, ge=0, le=1)


class ConceptDetailOut(BaseModel):
    concept: ConceptOut
    related_concepts: list[ConceptOut] = Field(default_factory=list)
    papers: list[PaperOut] = Field(default_factory=list)
    source_grounding: list[dict[str, Any]] = Field(default_factory=list)
    example_snippets: list[str] = Field(default_factory=list)


class ConceptMapNode(BaseModel):
    id: str
    label: str
    type: str = "concept"


class ConceptMapEdge(BaseModel):
    source: str
    target: str
    type: str = "related"


class ConceptMapOut(BaseModel):
    nodes: list[ConceptMapNode] = Field(default_factory=list)
    edges: list[ConceptMapEdge] = Field(default_factory=list)


class AnnotatedTextSegment(BaseModel):
    type: Literal["text", "concept"]
    text: str
    concept_slug: Optional[str] = None
    definition: Optional[str] = None


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
# Active recall: review loop (FSRS)
# ---------------------------------------------------------------------------
class ReviewSubmitIn(BaseModel):
    item_kind: Literal["quiz", "flashcard"]
    item_id: str
    rating: int = Field(ge=1, le=4, description="FSRS grade: 1 Again, 2 Hard, 3 Good, 4 Easy")
    correct: Optional[bool] = None


class ReviewResultOut(BaseModel):
    item_kind: str
    item_id: str
    rating: int
    correct: Optional[bool]
    interval_days: int
    due: Optional[datetime]
    state: str
    reps: int
    lapses: int
    stability: Optional[float]
    difficulty: Optional[float]


class ReviewQueueItemOut(BaseModel):
    item_kind: str
    item_id: str
    due: Optional[datetime]
    state: str
    reps: int
    lapses: int
    quiz: Optional[QuizOut] = None
    flashcard: Optional[FlashcardOut] = None


class ReviewQueueOut(BaseModel):
    now: datetime
    due_count: int
    new_count: int
    items: list[ReviewQueueItemOut]


class WeakAreaOut(BaseModel):
    concept: str
    attempts: int
    correct: int
    accuracy: float


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
    # Names of fields the PATCH endpoint will accept (the rest are env-only).
    editable_fields: list[str] = Field(default_factory=list)


class SettingsPatch(BaseModel):
    llm_provider: Optional[str] = None
    llm_model_fast: Optional[str] = None
    llm_model_strong: Optional[str] = None
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


class ExportPreviewOut(BaseModel):
    repo_path: str
    branch: Optional[str] = None
    clean: bool = False
    ahead: int = 0
    behind: int = 0
    files_to_create: list[str] = Field(default_factory=list)
    files_to_update: list[str] = Field(default_factory=list)
    files_to_delete: list[str] = Field(default_factory=list)
    pdfs_to_copy: list[str] = Field(default_factory=list)
    commit_needed: bool = False
    warnings: list[str] = Field(default_factory=list)


class PaperRelationshipOut(BaseModel):
    source_paper_id: str
    target_paper_id: str
    type: str
    rationale: Optional[str] = None


class PaperGraphNode(BaseModel):
    paper: PaperOut
    score: float
    category: str
    cluster_id: Optional[str] = None


class PaperGraphOut(BaseModel):
    nodes: list[PaperGraphNode] = Field(default_factory=list)
    edges: list[PaperRelationshipOut] = Field(default_factory=list)
