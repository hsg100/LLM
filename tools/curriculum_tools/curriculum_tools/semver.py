"""Semantic version discipline (design §12 rule 9; final-approval condition 2).

Compares the proposed catalogues with the catalogues at the PR merge-base and
fails when a semantic change lands without the required version bump.

Enforced lesson-level semantics (require a lesson version bump):
- checkpoint questions, options, answer keys, pass thresholds, kind, slug;
- objectives;
- block IDs or their order;
- lesson topic reassignment;
- lesson concept list;
- demo ID list.

Enforced curriculum-level semantics (require a curriculum version bump):
- the curriculum topic list (order/membership);
- any topic's lesson list (order/membership), status or prerequisites
  (these define completion requirements and pathway meaning).

Version-neutral by policy: narrative block *content* edits that preserve
block IDs and order, citation/source metadata, demo fallback text, topic
titles/summaries/objectives copy, concept definitions.

The initial introduction of the catalogue is exempt: with no merge-base
catalogue there is nothing whose meaning can silently change.
"""

from __future__ import annotations

from typing import Any


def _lesson_semantics(lesson: dict[str, Any], grading_cp: dict[str, Any] | None) -> dict[str, Any]:
    cp = lesson.get("checkpoint", {})
    return {
        "topic": lesson.get("topic"),
        "objectives": lesson.get("objectives"),
        "concepts": lesson.get("concepts"),
        "demos": lesson.get("demos"),
        "block_ids": [b["id"] for b in lesson.get("blocks", [])],
        "checkpoint": {
            "slug": cp.get("slug"),
            "kind": cp.get("kind"),
            "pass_score": cp.get("pass_score"),
            "questions": [
                {"id": q.get("id"), "prompt": q.get("prompt"), "options": q.get("options"),
                 "concept": q.get("concept")}
                for q in cp.get("questions", [])
            ],
        },
        "answer_key": (grading_cp or {}).get("answer_key"),
    }


def _curriculum_semantics(catalog: dict[str, Any]) -> dict[str, Any]:
    return {
        "topics_order": catalog.get("curriculum", {}).get("topics"),
        "topics": {
            slug: {
                "lessons": t.get("lessons"),
                "status": t.get("status"),
                "prerequisites": t.get("prerequisites"),
            }
            for slug, t in catalog.get("topics", {}).items()
        },
    }


def check_semver(
    base_catalog: dict[str, Any] | None,
    base_grading: dict[str, Any] | None,
    new_catalog: dict[str, Any],
    new_grading: dict[str, Any],
) -> list[str]:
    if base_catalog is None:
        return []  # initial introduction: explicitly exempt

    errors: list[str] = []
    base_grading = base_grading or {}

    old_cur = base_catalog.get("curriculum", {})
    new_cur = new_catalog.get("curriculum", {})
    if (
        _curriculum_semantics(base_catalog) != _curriculum_semantics(new_catalog)
        and new_cur.get("version", 0) <= old_cur.get("version", 0)
    ):
        errors.append(
            "semver: curriculum semantics changed (topic membership/order/status/"
            "prerequisites or lesson membership) without a curriculum version bump "
            f"(version stayed at {new_cur.get('version')})"
        )

    old_lessons = base_catalog.get("lessons", {})
    for slug, new_lesson in new_catalog.get("lessons", {}).items():
        old_lesson = old_lessons.get(slug)
        if old_lesson is None:
            continue  # new lesson: no prior meaning to preserve
        old_sem = _lesson_semantics(old_lesson, base_grading.get("checkpoints", {}).get(slug))
        new_sem = _lesson_semantics(new_lesson, new_grading.get("checkpoints", {}).get(slug))
        if old_sem != new_sem and new_lesson.get("version", 0) <= old_lesson.get("version", 0):
            changed = [k for k in new_sem if new_sem[k] != old_sem[k]]
            errors.append(
                f"semver: lesson {slug!r} semantics changed ({', '.join(changed)}) "
                f"without a version bump (version stayed at {new_lesson.get('version')})"
            )
    return errors
