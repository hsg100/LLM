"""Pydantic contracts for curriculum sources (design §3.2).

These models are the single truth for the source formats; the JSON Schemas
under curriculum/schemas/ are generated from them (``curriculum-tools
emit-schemas``) so editors and CI can never drift from the code.
"""

from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _check_slug(value: str, field: str) -> str:
    if not SLUG_RE.match(value):
        raise ValueError(f"{field} must be a kebab-case slug, got {value!r}")
    return value


class CurriculumManifest(StrictModel):
    slug: str
    title: str
    version: int = Field(ge=1)
    topics: list[str] = Field(min_length=1)  # ordered pathway

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        return _check_slug(v, "curriculum.slug")

    @field_validator("topics")
    @classmethod
    def _topic_slugs(cls, v: list[str]) -> list[str]:
        return [_check_slug(t, "curriculum.topics[]") for t in v]


class Topic(StrictModel):
    slug: str
    title: str
    summary: str
    status: Literal["active", "planned", "retired"]
    prerequisites: list[str] = []
    learning_objectives: list[str] = []
    lessons: list[str] = []  # ordered; empty allowed only when planned/retired
    concepts: list[str] = []

    @field_validator("slug", "prerequisites", "lessons", "concepts")
    @classmethod
    def _slugs(cls, v, info):
        if isinstance(v, str):
            return _check_slug(v, f"topic.{info.field_name}")
        return [_check_slug(x, f"topic.{info.field_name}[]") for x in v]


class Concept(StrictModel):
    slug: str
    name: str
    short_definition: str
    prerequisites: list[str] = []

    @field_validator("slug", "prerequisites")
    @classmethod
    def _slugs(cls, v, info):
        if isinstance(v, str):
            return _check_slug(v, f"concept.{info.field_name}")
        return [_check_slug(x, f"concept.{info.field_name}[]") for x in v]


class CheckpointQuestion(StrictModel):
    id: str
    prompt: str
    options: list[str] = Field(min_length=2)
    correct_index: int = Field(ge=0)
    concept: str

    @model_validator(mode="after")
    def _index_in_range(self) -> "CheckpointQuestion":
        if self.correct_index >= len(self.options):
            raise ValueError(
                f"question {self.id!r}: correct_index {self.correct_index} "
                f"out of range for {len(self.options)} options"
            )
        return self


class Checkpoint(StrictModel):
    slug: str
    kind: Literal["concept-check"]
    pass_score: float = Field(gt=0, le=1)
    questions: list[CheckpointQuestion] = Field(min_length=1)

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        return _check_slug(v, "checkpoint.slug")


class Source(StrictModel):
    id: str
    url: str
    title: Optional[str] = None

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError(f"source url must be http(s), got {v!r}")
        return v


class LessonFrontmatter(StrictModel):
    slug: str
    title: str
    topic: str
    version: int = Field(ge=1)
    duration_minutes: int = Field(ge=1)
    objectives: list[str] = Field(min_length=1)
    concepts: list[str] = []
    demos: list[str] = []
    demo_fallbacks: dict[str, str] = {}
    checkpoint: Checkpoint
    sources: list[Source] = Field(min_length=1)

    @field_validator("slug", "topic", "concepts", "demos")
    @classmethod
    def _slugs(cls, v, info):
        if isinstance(v, str):
            return _check_slug(v, f"lesson.{info.field_name}")
        return [_check_slug(x, f"lesson.{info.field_name}[]") for x in v]


class DemoRegistry(StrictModel):
    """Declared interactive-demo IDs (Phase 2: manifest only; runtime is Phase 3)."""

    demos: list[str] = []

    @field_validator("demos")
    @classmethod
    def _slugs(cls, v: list[str]) -> list[str]:
        return [_check_slug(x, "demo-registry.demos[]") for x in v]
