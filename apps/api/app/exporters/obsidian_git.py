"""Obsidian Git-backed exporter.

Writes deterministic markdown files into a *separate* Git-backed
research vault/section, commits, and optionally pushes. Never touches
the user's main Obsidian vault. Never uses the Obsidian Local REST API.

Behaviour
---------
- Writes to a configured repo path. The path is treated as a working
  tree. If it isn't a git repo yet, we ``git init`` it on first use.
- Layout (under the configured root):
    FieldMap Research/
      Landscapes/<topic-slug>.md
      Papers/<topic-slug>/<paper-slug>.md
      Reading Plans/<topic-slug>.md
      Open Questions/<topic-slug>.md
      Project Ideas/<topic-slug>.md
      Flashcards/<topic-slug>.md
      Exports/<topic-slug>-quiz.md
- Each file has YAML frontmatter (type, topic, generated_at, source).
- Content hashing: an export skips writing if the file already exists
  with the same SHA-256 of the rendered body. This keeps git history
  meaningful and makes re-exports idempotent.
- Records each (path, hash, commit_sha) row in ``obsidian_exports``.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from slugify import slugify

from app.config import get_settings
from app.services.pdf_storage import pdf_obsidian_embed, pdf_vault_relpath


VAULT_SUBDIR = "FieldMap Research"


@dataclass
class ExportPlan:
    """Result of rendering — what we *will* write, in memory, before touching disk."""

    files: list[tuple[Path, str]] = field(default_factory=list)
    binary_files: list[tuple[Path, bytes]] = field(default_factory=list)


def render_landscape_export(
    *,
    topic: str,
    landscape_id: str,
    synthesis: dict[str, Any],
    landscape_papers: list[dict[str, Any]],
    quizzes: list[dict[str, Any]],
    flashcards: list[dict[str, Any]],
    extractions_by_paper: dict[str, dict[str, Any]],
    root: Path,
    generated_at: str | None = None,
) -> ExportPlan:
    """Build the full set of file paths and contents for a landscape."""
    plan = ExportPlan()
    slug = slugify(topic) or landscape_id
    generated_at = generated_at or datetime.utcnow().isoformat() + "Z"

    base = root / VAULT_SUBDIR

    plan.files.append(
        (
            base / "Landscapes" / f"{slug}.md",
            _render_landscape_note(topic, landscape_id, synthesis, landscape_papers, generated_at),
        )
    )

    for lp in landscape_papers:
        paper_slug = slugify(lp["title"])[:80] or lp["paper_id"]
        ext = extractions_by_paper.get(lp["paper_id"], {})
        pdf_source_path = lp.get("pdf_source_path")
        pdf_filename = lp.get("pdf_filename")
        if pdf_source_path and pdf_filename:
            source = Path(pdf_source_path)
            if source.exists() and source.is_file():
                plan.binary_files.append((base / "Attachments" / "PDFs" / str(pdf_filename), source.read_bytes()))
        plan.files.append(
            (
                base / "Papers" / slug / f"{paper_slug}.md",
                _render_paper_note(topic=topic, landscape_paper=lp, extraction=ext, generated_at=generated_at),
            )
        )

    plan.files.append(
        (base / "Reading Plans" / f"{slug}.md", _render_reading_plan(topic, synthesis, landscape_papers, generated_at)),
    )
    plan.files.append(
        (base / "Open Questions" / f"{slug}.md", _render_open_questions(topic, synthesis, landscape_papers, generated_at)),
    )
    plan.files.append(
        (base / "Project Ideas" / f"{slug}.md", _render_project_ideas(topic, synthesis, landscape_papers, generated_at)),
    )
    plan.files.append(
        (base / "Flashcards" / f"{slug}.md", _render_flashcards(topic, flashcards, generated_at)),
    )
    plan.files.append(
        (base / "Exports" / f"{slug}-quiz.md", _render_quiz(topic, quizzes, generated_at)),
    )

    return plan


def write_plan(
    plan: ExportPlan,
    *,
    root: Path,
    commit_message: str,
    push: bool,
    force: bool = False,
) -> tuple[list[str], list[tuple[str, str]], Optional[str], bool]:
    """Write files, commit if anything changed, optionally push.

    Returns: (written_relative_paths, [(rel_path, content_hash), ...],
              commit_sha, pushed_flag).
    """
    from git import Actor, Repo
    from git.exc import InvalidGitRepositoryError, NoSuchPathError

    settings = get_settings()
    root.mkdir(parents=True, exist_ok=True)
    try:
        repo = Repo(root)
    except (InvalidGitRepositoryError, NoSuchPathError):
        repo = Repo.init(root)

    written_rel: list[str] = []
    hashes: list[tuple[str, str]] = []

    for path, body in plan.files:
        path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        rel = str(path.relative_to(root))
        hashes.append((rel, digest))

        if path.exists() and not force:
            try:
                existing = path.read_text(encoding="utf-8")
                if hashlib.sha256(existing.encode("utf-8")).hexdigest() == digest:
                    continue
            except OSError:
                pass

        path.write_text(body, encoding="utf-8")
        written_rel.append(rel)

    for path, data in plan.binary_files:
        path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(data).hexdigest()
        rel = str(path.relative_to(root))
        hashes.append((rel, digest))

        if path.exists() and not force:
            try:
                if hashlib.sha256(path.read_bytes()).hexdigest() == digest:
                    continue
            except OSError:
                pass

        path.write_bytes(data)
        written_rel.append(rel)

    # Commit if anything is dirty.
    if repo.is_dirty(untracked_files=True):
        repo.git.add(A=True)
        actor = Actor(settings.obsidian_export_author_name, settings.obsidian_export_author_email)
        commit = repo.index.commit(commit_message, author=actor, committer=actor)
        sha = commit.hexsha
    else:
        sha = repo.head.commit.hexsha if repo.head.is_valid() else None

    pushed = False
    if push and settings.obsidian_export_git_remote:
        if "origin" not in [r.name for r in repo.remotes]:
            repo.create_remote("origin", settings.obsidian_export_git_remote)
        try:
            repo.remotes.origin.push()
            pushed = True
        except Exception:  # noqa: BLE001
            pushed = False

    return written_rel, hashes, sha, pushed


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------
def _frontmatter(**fields: Any) -> str:
    lines = ["---"]
    for k, v in fields.items():
        if isinstance(v, list):
            joined = ", ".join(f'"{_yaml_escape(str(x))}"' for x in v)
            lines.append(f"{k}: [{joined}]")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, (int, float)):
            lines.append(f"{k}: {v}")
        else:
            lines.append(f'{k}: "{_yaml_escape(str(v))}"')
    lines.append("---")
    return "\n".join(lines)


def _yaml_escape(s: str) -> str:
    return s.replace('"', '\\"').replace("\n", " ").strip()


def _bullets(items: list[str]) -> str:
    items = [i for i in (s.strip() for s in items) if i]
    if not items:
        return "_None._"
    return "\n".join(f"- {i}" for i in items)


def _paper_link(topic_slug: str, title: str) -> str:
    slug = slugify(title)[:80] or "paper"
    return f"[[Papers/{topic_slug}/{slug}|{title}]]"


def _render_landscape_note(
    topic: str,
    landscape_id: str,
    synthesis: dict[str, Any],
    landscape_papers: list[dict[str, Any]],
    generated_at: str,
) -> str:
    fm = _frontmatter(
        type="fieldmap-landscape",
        topic=topic,
        landscape_id=landscape_id,
        generated_at=generated_at,
        source="fieldmap",
        tags=["fieldmap", f"topic/{slugify(topic)}"],
    )
    topic_slug = slugify(topic)
    must_read = [lp for lp in landscape_papers if lp.get("category") == "must-read"]
    quality_note = (
        "\n> Content quality: degraded. This landscape used fallback extraction because LLM calls failed.\n"
        if synthesis.get("content_quality") == "degraded"
        else ""
    )

    cluster_md_blocks: list[str] = []
    for c in synthesis.get("clusters") or []:
        title = c.get("name") or "Cluster"
        summary = c.get("summary") or ""
        pid_set = set(c.get("paper_ids") or [])
        papers_in = [lp for lp in landscape_papers if lp.get("paper_id") in pid_set]
        body_lines = [f"### {title}", summary or "", ""]
        if papers_in:
            for lp in papers_in:
                body_lines.append(f"- {_paper_link(topic_slug, lp['title'])}  *(score {lp.get('score', 0):.2f})*")
        cluster_md_blocks.append("\n".join(body_lines))

    body = f"""{fm}

# {topic}
{quality_note}

> {synthesis.get("field_overview") or "_Field overview pending._"}

**Why it matters.** {synthesis.get("why_it_matters") or "_Pending._"}

## Must-read
{_bullets([_paper_link(topic_slug, lp["title"]) for lp in must_read]) if must_read else "_None ranked must-read._"}

## Clusters
{chr(10).join(cluster_md_blocks) if cluster_md_blocks else "_No clusters generated._"}

## Reading path
{_render_reading_path_inline(synthesis.get("reading_path") or [], topic_slug)}

## Prerequisites
{_bullets(synthesis.get("prerequisites") or [])}

## Datasets and benchmarks
{_bullets(synthesis.get("datasets_benchmarks") or [])}

## Tensions / disagreements
{_bullets(synthesis.get("tensions") or [])}

## Open problems
{_bullets(synthesis.get("open_problems") or [])}

## Project ideas
{_bullets(synthesis.get("project_ideas") or [])}

## Skip for now
{_bullets(synthesis.get("skip_for_now") or [])}

## All papers
{_render_full_paper_table(landscape_papers, topic_slug)}

## PDF availability
{_render_pdf_availability(landscape_papers, topic_slug)}
"""
    return body


def _render_reading_path_inline(steps: list[dict[str, Any]], topic_slug: str) -> str:
    if not steps:
        return "_Pending._"
    out = []
    for i, s in enumerate(steps, 1):
        title = s.get("title") or s.get("paper_id") or "Paper"
        why = s.get("why") or ""
        out.append(f"{i}. {_paper_link(topic_slug, title)} — {why}")
    return "\n".join(out)


def _render_full_paper_table(landscape_papers: list[dict[str, Any]], topic_slug: str) -> str:
    rows = ["| Score | Category | Year | Title |", "|------:|:---------|:----:|:------|"]
    for lp in sorted(landscape_papers, key=lambda x: x.get("score", 0), reverse=True):
        rows.append(
            f"| {lp.get('score', 0):.2f} | {lp.get('category', '')} | {lp.get('year') or ''} | "
            f"{_paper_link(topic_slug, lp['title'])} |"
        )
    return "\n".join(rows)


def _render_pdf_availability(landscape_papers: list[dict[str, Any]], topic_slug: str) -> str:
    rows = ["| Paper | Local PDF | Source PDF |", "|:------|:----------|:-----------|"]
    for lp in sorted(landscape_papers, key=lambda x: x.get("score", 0), reverse=True):
        filename = lp.get("pdf_filename")
        source_pdf = lp.get("pdf_url") or ""
        local = f"[[{pdf_vault_relpath(filename)}|PDF]]" if filename else "_missing_"
        source = f"[source]({source_pdf})" if source_pdf else "_not reported_"
        rows.append(f"| {_paper_link(topic_slug, lp['title'])} | {local} | {source} |")
    return "\n".join(rows)


def _render_paper_note(
    *,
    topic: str,
    landscape_paper: dict[str, Any],
    extraction: dict[str, Any],
    generated_at: str,
) -> str:
    title = landscape_paper["title"]
    fm = _frontmatter(
        type="fieldmap-paper",
        topic=topic,
        title=title,
        category=landscape_paper.get("category", ""),
        score=round(float(landscape_paper.get("score", 0)), 3),
        year=landscape_paper.get("year") or "",
        venue=landscape_paper.get("venue") or "",
        arxiv_id=landscape_paper.get("arxiv_id") or "",
        source="fieldmap",
        generated_at=generated_at,
        tags=["fieldmap", f"topic/{slugify(topic)}", f"category/{landscape_paper.get('category', 'optional')}"],
    )
    e = extraction or {}
    grounding = e.get("source_grounding") or []
    quality = e.get("_fieldmap") or {}
    quality_note = (
        "\n> Extraction quality: degraded. This note used fallback extraction because LLM calls failed.\n"
        if quality.get("degraded")
        else ""
    )
    url = landscape_paper.get("url") or ""
    pdf = landscape_paper.get("pdf_url") or ""
    pdf_filename = landscape_paper.get("pdf_filename") or ""
    local_pdf_link = f"[[{pdf_vault_relpath(pdf_filename)}|Local PDF]]" if pdf_filename else ""
    pdf_embed = pdf_obsidian_embed(pdf_filename) if pdf_filename else ""
    pdf_note = (
        f"**Source PDF URL:** {pdf}\n"
        f"**Local vault PDF:** {local_pdf_link or '_Not available._'}\n"
        f"{pdf_embed if pdf_embed else '_No local PDF was available at export time._'}"
    )
    return f"""{fm}

# {title}
{quality_note}

{', '.join(landscape_paper.get('authors') or []) or '_Authors not reported._'}
{f"[Abstract page]({url})" if url else ''}{f" · [PDF]({pdf})" if pdf else ''}

## PDF
{pdf_note}

**Score:** {landscape_paper.get('score', 0):.2f} · **Category:** {landscape_paper.get('category', '')}
**Rationale:** {landscape_paper.get('rationale') or '_n/a_'}

## Problem
{e.get('problem') or 'Not reported.'}
{_render_inline_grounding(grounding, 'problem')}

## Motivation
{e.get('motivation') or 'Not reported.'}
{_render_inline_grounding(grounding, 'motivation')}

## Research question
{e.get('research_question') or 'Not reported.'}
{_render_inline_grounding(grounding, 'research_question')}

## Method
{e.get('method') or 'Not reported.'}
{_render_inline_grounding(grounding, 'method')}

## Contribution
{e.get('contribution') or 'Not reported.'}
{_render_inline_grounding(grounding, 'contribution')}

## Novelty
{e.get('novelty') or 'Not reported.'}
{_render_inline_grounding(grounding, 'novelty')}

## Results
{_bullets(e.get('results') or [])}

## Limitations
{_bullets(e.get('limitations') or [])}

## Assumptions
{_bullets(e.get('assumptions') or [])}

## Datasets
{_bullets(e.get('datasets') or [])}

## Benchmarks
{_bullets(e.get('benchmarks') or [])}

## Baselines
{_bullets(e.get('baselines') or [])}

## Metrics
{_bullets(e.get('metrics') or [])}

## Implementation details
{_bullets(e.get('implementation_details') or [])}

## Mathematical ideas
{_bullets(e.get('mathematical_ideas') or [])}

## Prerequisites
{_bullets(e.get('prerequisites') or [])}

## Key terms
{_bullets(e.get('key_terms') or [])}

## Related papers
{_bullets(e.get('related_papers') or [])}

## Open questions
{_bullets(e.get('open_questions') or [])}

## Project ideas
{_bullets(e.get('project_ideas') or [])}

## Source grounding
{_render_source_grounding(grounding)}

---

_Difficulty: {e.get('difficulty_level', 1)}/5 · Reading priority: {e.get('reading_priority', 'optional')} · Confidence: {e.get('confidence', 0)}_
"""


def _render_inline_grounding(grounding: list[dict[str, Any]], field: str) -> str:
    matches = [g for g in grounding if g.get("field") == field]
    if not matches:
        return ""
    g = matches[0]
    source = _grounding_source(g)
    quote = g.get("quote") or ""
    evidence_quote = f' - "{quote}"' if quote else ""
    return f"\n\n_Evidence:_ {source}{evidence_quote}"


def _render_source_grounding(grounding: list[dict[str, Any]]) -> str:
    if not grounding:
        return "_No structured grounding was available for this extraction._"
    blocks: list[str] = []
    for g in grounding:
        field_name = str(g.get("field") or "field").replace("_", " ").title()
        quote = g.get("quote") or ""
        evidence = f'"{quote}"' if quote else "_No quote supplied._"
        blocks.append(
            "\n".join(
                [
                    f"### {field_name}",
                    f"- Claim field: `{g.get('field')}`",
                    f"- Source: {_grounding_source(g)}",
                    f"- Evidence: {evidence}",
                    f"- Confidence: {float(g.get('confidence') or 0):.2f}",
                ]
            )
        )
    return "\n\n".join(blocks)


def _grounding_source(g: dict[str, Any]) -> str:
    section = g.get("section") or "Unknown section"
    page = f", page {g.get('page')}" if g.get("page") is not None else ""
    chunk = g.get("chunk_ordinal")
    chunk_text = f", chunk {chunk}" if chunk is not None else ""
    chunk_id = f" (`{g.get('chunk_id')}`)" if g.get("chunk_id") else ""
    return f"{section}{page}{chunk_text}{chunk_id}"


def _render_reading_plan(topic: str, synthesis: dict[str, Any], landscape_papers: list[dict[str, Any]], generated_at: str) -> str:
    fm = _frontmatter(
        type="fieldmap-reading-plan",
        topic=topic,
        generated_at=generated_at,
        source="fieldmap",
        tags=["fieldmap", f"topic/{slugify(topic)}"],
    )
    topic_slug = slugify(topic)
    steps = synthesis.get("reading_path") or []
    if not steps:
        steps = [
            {"paper_id": lp["paper_id"], "title": lp["title"], "why": "Ranked must-read", "cluster": ""}
            for lp in landscape_papers
            if lp.get("category") == "must-read"
        ]
    body_lines = [_paper_link(topic_slug, s.get("title") or "Paper") + f" — {s.get('why') or ''}" for s in steps]
    return f"""{fm}

# Reading plan — {topic}

{_bullets(body_lines)}
"""


def _render_open_questions(topic: str, synthesis: dict[str, Any], landscape_papers: list[dict[str, Any]], generated_at: str) -> str:
    fm = _frontmatter(
        type="fieldmap-open-questions",
        topic=topic,
        generated_at=generated_at,
        source="fieldmap",
        tags=["fieldmap", f"topic/{slugify(topic)}"],
    )
    return f"""{fm}

# Open questions — {topic}

{_bullets(synthesis.get('open_problems') or [])}
"""


def _render_project_ideas(topic: str, synthesis: dict[str, Any], landscape_papers: list[dict[str, Any]], generated_at: str) -> str:
    fm = _frontmatter(
        type="fieldmap-project-ideas",
        topic=topic,
        generated_at=generated_at,
        source="fieldmap",
        tags=["fieldmap", f"topic/{slugify(topic)}"],
    )
    return f"""{fm}

# Project ideas — {topic}

{_bullets(synthesis.get('project_ideas') or [])}
"""


def _render_flashcards(topic: str, flashcards: list[dict[str, Any]], generated_at: str) -> str:
    fm = _frontmatter(
        type="fieldmap-flashcards",
        topic=topic,
        count=len(flashcards),
        generated_at=generated_at,
        source="fieldmap",
        tags=["fieldmap", f"topic/{slugify(topic)}"],
    )
    body = []
    for f in flashcards:
        body.append(f"### {f.get('front')}\n\n_({f.get('kind', 'recall')})_ — {f.get('back')}\n")
    return f"""{fm}

# Flashcards — {topic}

{(chr(10) + chr(10)).join(body) if body else '_No flashcards generated._'}
"""


def _render_quiz(topic: str, quizzes: list[dict[str, Any]], generated_at: str) -> str:
    fm = _frontmatter(
        type="fieldmap-quiz",
        topic=topic,
        count=len(quizzes),
        generated_at=generated_at,
        source="fieldmap",
        tags=["fieldmap", f"topic/{slugify(topic)}"],
    )
    body: list[str] = []
    for i, q in enumerate(quizzes, 1):
        body.append(f"### Q{i}. {q['question']}\n")
        for j, opt in enumerate(q["options"]):
            body.append(f"- {chr(ord('A') + j)}. {opt}")
        body.append("")
        body.append(f"**Answer:** {chr(ord('A') + q['correct_index'])} — {q.get('explanation') or ''}")
        body.append("")
    return f"""{fm}

# Quiz — {topic}

{(chr(10)).join(body) if body else '_No quiz items generated._'}
"""


def make_repo_root() -> Path:
    p = Path(get_settings().obsidian_export_repo_path)
    p = p.expanduser()
    os.makedirs(p, exist_ok=True)
    return p
