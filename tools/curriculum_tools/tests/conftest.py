import textwrap
from pathlib import Path

import pytest

MINIMAL_LESSON = """\
---
slug: lesson-a
title: Lesson A
topic: topic-a
version: 1
duration_minutes: 5
objectives:
  - Objective one
concepts:
  - concept-a
demos:
  - demo-x
demo_fallbacks:
  demo-x: A plain-text fallback conveying the same point.
checkpoint:
  slug: checkpoint-a
  kind: concept-check
  pass_score: 0.8
  questions:
    - id: q1
      prompt: Question?
      options: [wrong, right]
      correct_index: 1
      concept: concept-a
sources:
  - id: src-1
    url: https://example.org/paper
---

## First block

Some narrative.

## Second block

More narrative.
"""


@pytest.fixture()
def curriculum_dir(tmp_path: Path) -> Path:
    """A minimal, fully valid curriculum tree."""
    d = tmp_path / "curriculum"
    (d / "topics").mkdir(parents=True)
    (d / "concepts").mkdir()
    (d / "lessons").mkdir()
    (d / "schemas").mkdir()

    (d / "curriculum.yaml").write_text(
        textwrap.dedent(
            """\
            slug: test-pathway
            title: Test pathway
            version: 1
            topics:
              - topic-a
            """
        )
    )
    (d / "topics" / "topic-a.yaml").write_text(
        textwrap.dedent(
            """\
            slug: topic-a
            title: Topic A
            summary: A topic.
            status: active
            prerequisites: []
            learning_objectives:
              - Learn the thing
            lessons:
              - lesson-a
            concepts:
              - concept-a
            """
        )
    )
    (d / "concepts" / "concept-a.yaml").write_text(
        textwrap.dedent(
            """\
            slug: concept-a
            name: Concept A
            short_definition: The first concept.
            prerequisites: []
            """
        )
    )
    (d / "lessons" / "lesson-a.md").write_text(MINIMAL_LESSON)
    (d / "schemas" / "demo-registry.yaml").write_text("demos:\n  - demo-x\n")
    return d
