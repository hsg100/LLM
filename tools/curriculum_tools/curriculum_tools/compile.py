"""Load, validate and compile curriculum sources into the catalogue artifacts.

Validation rule classes are numbered per docs/PHASE_2_TECHNICAL_DESIGN.md §12.
Every error string is prefixed with its rule class so red-path tests can
assert the precise failure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from markdown_it import MarkdownIt
from pydantic import ValidationError

from . import CATALOG_FORMAT, GRADING_CANARY
from .contracts import Concept, CurriculumManifest, DemoRegistry, LessonFrontmatter, Topic
from .hashing import artifact_hash, source_tree_hash

FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
_md = MarkdownIt("commonmark")


@dataclass
class LessonSource:
    front: LessonFrontmatter
    body: str
    path: str


@dataclass
class Sources:
    curriculum: CurriculumManifest | None = None
    topics: dict[str, Topic] = field(default_factory=dict)
    concepts: dict[str, Concept] = field(default_factory=dict)
    lessons: dict[str, LessonSource] = field(default_factory=dict)
    demo_registry: DemoRegistry = field(default_factory=DemoRegistry)


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "section"


def _fmt_pydantic(path: str, e: ValidationError) -> list[str]:
    return [
        f"rule1 schema: {path}: {'.'.join(str(p) for p in err['loc'])}: {err['msg']}"
        for err in e.errors()
    ]


# ---------------------------------------------------------------------------
# Loading (rule 1: schema)
# ---------------------------------------------------------------------------
def load_sources(curriculum_dir: Path) -> tuple[Sources, list[str]]:
    src = Sources()
    errors: list[str] = []

    manifest_path = curriculum_dir / "curriculum.yaml"
    if not manifest_path.exists():
        errors.append("rule1 schema: curriculum.yaml is missing")
    else:
        try:
            src.curriculum = CurriculumManifest.model_validate(
                yaml.safe_load(manifest_path.read_text()) or {}
            )
        except ValidationError as e:
            errors += _fmt_pydantic("curriculum.yaml", e)

    for sub, model, store in (
        ("topics", Topic, src.topics),
        ("concepts", Concept, src.concepts),
    ):
        for p in sorted((curriculum_dir / sub).glob("*.yaml")):
            try:
                obj = model.model_validate(yaml.safe_load(p.read_text()) or {})
            except ValidationError as e:
                errors += _fmt_pydantic(str(p.relative_to(curriculum_dir)), e)
                continue
            if obj.slug != p.stem:
                errors.append(
                    f"rule3 duplicate/misnamed: {p.name}: slug {obj.slug!r} must match filename"
                )
            if obj.slug in store:
                errors.append(f"rule3 duplicate: {sub} slug {obj.slug!r} defined twice")
            store[obj.slug] = obj

    for p in sorted((curriculum_dir / "lessons").glob("*.md")):
        rel = str(p.relative_to(curriculum_dir))
        text = p.read_text()
        m = FRONTMATTER_RE.match(text)
        if not m:
            errors.append(f"rule1 schema: {rel}: missing YAML frontmatter")
            continue
        try:
            front = LessonFrontmatter.model_validate(yaml.safe_load(m.group(1)) or {})
        except ValidationError as e:
            errors += _fmt_pydantic(rel, e)
            continue
        if front.slug != p.stem:
            errors.append(f"rule3 duplicate/misnamed: {p.name}: slug {front.slug!r} must match filename")
        if front.slug in src.lessons:
            errors.append(f"rule3 duplicate: lesson slug {front.slug!r} defined twice")
        src.lessons[front.slug] = LessonSource(front=front, body=text[m.end():], path=rel)

    registry_path = curriculum_dir / "schemas" / "demo-registry.yaml"
    if registry_path.exists():
        try:
            src.demo_registry = DemoRegistry.model_validate(
                yaml.safe_load(registry_path.read_text()) or {}
            )
        except ValidationError as e:
            errors += _fmt_pydantic("schemas/demo-registry.yaml", e)

    return src, errors


# ---------------------------------------------------------------------------
# Lesson body → blocks (rules 3, 8)
# ---------------------------------------------------------------------------
def split_blocks(body: str, lesson_slug: str) -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    tokens = _md.parse(body)
    for t in tokens:
        if t.type in ("html_block", "html_inline") or (
            t.children and any(c.type == "html_inline" for c in t.children)
        ):
            errors.append(f"rule8 raw-html: lesson {lesson_slug!r} contains raw HTML")
            break

    lines = body.splitlines()
    heads: list[tuple[int, str]] = []  # (source line, heading text)
    for i, t in enumerate(tokens):
        if t.type == "heading_open":
            if t.tag != "h2":
                errors.append(
                    f"rule3 blocks: lesson {lesson_slug!r}: only '##' headings may "
                    f"structure the body (found {t.tag})"
                )
            elif t.map:
                heads.append((t.map[0], tokens[i + 1].content))

    if not heads:
        errors.append(f"rule3 blocks: lesson {lesson_slug!r} has no '##' blocks")
        return [], errors
    first_line = heads[0][0]
    if any(line.strip() for line in lines[:first_line]):
        errors.append(
            f"rule3 blocks: lesson {lesson_slug!r} has content before the first '##' block"
        )

    blocks: list[dict] = []
    seen: set[str] = set()
    for idx, (start, heading) in enumerate(heads):
        end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
        block_id = _slugify(heading)
        if block_id in seen:
            errors.append(f"rule3 duplicate: lesson {lesson_slug!r} block id {block_id!r} repeats")
        seen.add(block_id)
        content = "\n".join(lines[start + 1 : end]).strip()
        blocks.append({"id": block_id, "heading": heading, "markdown": content})
    return blocks, errors


# ---------------------------------------------------------------------------
# Cross-reference and graph validation (rules 2, 4, 5, 6, 7)
# ---------------------------------------------------------------------------
def _find_cycle(nodes: dict[str, list[str]]) -> list[str] | None:
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {n: WHITE for n in nodes}
    stack: list[str] = []

    def visit(n: str) -> list[str] | None:
        colour[n] = GREY
        stack.append(n)
        for dep in nodes.get(n, []):
            if dep not in nodes:
                continue
            if colour[dep] == GREY:
                return stack[stack.index(dep):] + [dep]
            if colour[dep] == WHITE:
                found = visit(dep)
                if found:
                    return found
        colour[n] = BLACK
        stack.pop()
        return None

    for n in nodes:
        if colour[n] == WHITE:
            found = visit(n)
            if found:
                return found
    return None


def validate_sources(src: Sources) -> list[str]:
    errors: list[str] = []
    if src.curriculum is None:
        return ["rule1 schema: no valid curriculum manifest"]

    topics, concepts, lessons = src.topics, src.concepts, src.lessons

    for t_slug in src.curriculum.topics:
        if t_slug not in topics:
            errors.append(f"rule2 unknown-ref: curriculum.topics references unknown topic {t_slug!r}")
    for topic in topics.values():
        for pre in topic.prerequisites:
            if pre not in topics:
                errors.append(f"rule2 unknown-ref: topic {topic.slug!r} prerequisite {pre!r} unknown")
        for les in topic.lessons:
            if les not in lessons:
                errors.append(f"rule2 unknown-ref: topic {topic.slug!r} lesson {les!r} unknown")
        for c in topic.concepts:
            if c not in concepts:
                errors.append(f"rule2 unknown-ref: topic {topic.slug!r} concept {c!r} unknown")
        if topic.status == "active" and not topic.lessons:
            errors.append(f"rule7 content: active topic {topic.slug!r} has zero lessons")
        if topic.slug not in src.curriculum.topics:
            errors.append(f"rule2 unknown-ref: topic {topic.slug!r} not listed in curriculum.topics")
    for concept in concepts.values():
        for pre in concept.prerequisites:
            if pre not in concepts:
                errors.append(f"rule2 unknown-ref: concept {concept.slug!r} prerequisite {pre!r} unknown")

    lesson_owner: dict[str, str] = {}
    for topic in topics.values():
        for les in topic.lessons:
            if les in lesson_owner:
                errors.append(
                    f"rule3 duplicate: lesson {les!r} owned by both "
                    f"{lesson_owner[les]!r} and {topic.slug!r}"
                )
            lesson_owner[les] = topic.slug

    declared_demos = set(src.demo_registry.demos)
    for lesson in lessons.values():
        f = lesson.front
        if f.topic not in topics:
            errors.append(f"rule2 unknown-ref: lesson {f.slug!r} topic {f.topic!r} unknown")
        elif f.slug not in topics[f.topic].lessons:
            errors.append(
                f"rule2 unknown-ref: lesson {f.slug!r} not listed by its topic {f.topic!r}"
            )
        for c in f.concepts:
            if c not in concepts:
                errors.append(f"rule2 unknown-ref: lesson {f.slug!r} concept {c!r} unknown")
        for q in f.checkpoint.questions:
            if q.concept not in concepts:
                errors.append(
                    f"rule2 unknown-ref: lesson {f.slug!r} checkpoint question "
                    f"{q.id!r} concept {q.concept!r} unknown"
                )
        for d in f.demos:
            if d not in declared_demos:
                errors.append(f"rule5 unknown-demo: lesson {f.slug!r} references demo {d!r}")
            if d not in f.demo_fallbacks or not f.demo_fallbacks.get(d, "").strip():
                errors.append(f"rule6 missing-fallback: lesson {f.slug!r} demo {d!r} has no fallback")
        qids = [q.id for q in f.checkpoint.questions]
        if len(qids) != len(set(qids)):
            errors.append(f"rule3 duplicate: lesson {f.slug!r} has duplicate question ids")
        sids = [s.id for s in f.sources]
        if len(sids) != len(set(sids)):
            errors.append(f"rule3 duplicate: lesson {f.slug!r} has duplicate source ids")

    # Topics and lessons share the /learn route and progress-key namespace, so
    # they must not collide with each other (or with the curriculum slug).
    # Concepts are a separate namespace: a topic and its headline concept may
    # legitimately share a slug (e.g. "attention", spec §4.2 + §5.4).
    route_slugs = list(topics) + list(lessons)
    if src.curriculum and src.curriculum.slug in route_slugs:
        errors.append(f"rule3 duplicate: curriculum slug {src.curriculum.slug!r} collides")
    seen: set[str] = set()
    for s in route_slugs:
        if s in seen:
            errors.append(f"rule3 duplicate: slug {s!r} used by both a topic and a lesson")
        seen.add(s)

    cyc = _find_cycle({t.slug: t.prerequisites for t in topics.values()})
    if cyc:
        errors.append(f"rule4 cycle: topic prerequisites cycle: {' -> '.join(cyc)}")
    cyc = _find_cycle({c.slug: c.prerequisites for c in concepts.values()})
    if cyc:
        errors.append(f"rule4 cycle: concept prerequisites cycle: {' -> '.join(cyc)}")

    return errors


# ---------------------------------------------------------------------------
# Compilation
# ---------------------------------------------------------------------------
def compile_catalogues(curriculum_dir: Path) -> tuple[dict, dict, list[str]]:
    """Return (catalog, grading_catalog, errors). Artifacts are only
    meaningful when errors is empty."""
    src, errors = load_sources(curriculum_dir)
    errors += validate_sources(src)

    lesson_blocks: dict[str, list[dict]] = {}
    for slug, lesson in src.lessons.items():
        blocks, block_errors = split_blocks(lesson.body, slug)
        errors += block_errors
        lesson_blocks[slug] = blocks

    if errors or src.curriculum is None:
        return {}, {}, errors

    tree_hash = source_tree_hash(curriculum_dir)

    catalog = {
        "format": CATALOG_FORMAT,
        "source_tree_hash": tree_hash,
        "artifact_hash": None,
        "curriculum": src.curriculum.model_dump(),
        "topics": {s: t.model_dump() for s, t in sorted(src.topics.items())},
        "concepts": {s: c.model_dump() for s, c in sorted(src.concepts.items())},
        "lessons": {},
    }
    grading = {
        "format": CATALOG_FORMAT,
        "source_tree_hash": tree_hash,
        "artifact_hash": None,
        "canary": GRADING_CANARY,
        "checkpoints": {},
    }

    for slug, lesson in sorted(src.lessons.items()):
        f = lesson.front
        public_checkpoint = f.checkpoint.model_dump()
        for q in public_checkpoint["questions"]:
            del q["correct_index"]  # answer keys live only in the grading catalogue
        entry = f.model_dump()
        entry["checkpoint"] = public_checkpoint
        entry["blocks"] = lesson_blocks[slug]
        catalog["lessons"][slug] = entry
        grading["checkpoints"][slug] = {
            "lesson_version": f.version,
            "checkpoint_slug": f.checkpoint.slug,
            "pass_score": f.checkpoint.pass_score,
            "answer_key": {q.id: q.correct_index for q in f.checkpoint.questions},
        }

    catalog["artifact_hash"] = artifact_hash(catalog)
    grading["artifact_hash"] = artifact_hash(grading)
    return catalog, grading, []
