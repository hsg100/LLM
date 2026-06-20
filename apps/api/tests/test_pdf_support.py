from __future__ import annotations

from pathlib import Path

from git import Repo

from app.exporters.obsidian_git import ExportPlan, preview_plan, render_landscape_export, write_plan
from app.services.pdf_storage import (
    deterministic_pdf_filename,
    is_safe_pdf_path,
    pdf_obsidian_embed,
    pdf_vault_relpath,
    resolve_pdf_storage_path,
)


def test_deterministic_pdf_filename_is_safe_and_stable():
    filename = deterministic_pdf_filename(
        year=2025,
        title="../RAG Evaluation: A Survey/Benchmark?",
        arxiv_id="cs/9901001v2",
        paper_id="paper-123",
    )

    assert filename == "2025-rag-evaluation-a-survey-benchmark-cs-9901001v2.pdf"
    assert "/" not in filename
    assert ".." not in filename


def test_pdf_path_safety_rejects_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("PDF_STORAGE_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()
    safe = tmp_path / "paper.pdf"
    unsafe = tmp_path / ".." / "outside.pdf"

    assert is_safe_pdf_path(safe)
    assert not is_safe_pdf_path(unsafe)
    assert resolve_pdf_storage_path("../outside.pdf") is None
    get_settings.cache_clear()


def test_obsidian_pdf_link_helpers():
    filename = "2025-example-paper-123.pdf"

    assert pdf_vault_relpath(filename) == "Attachments/PDFs/2025-example-paper-123.pdf"
    assert pdf_obsidian_embed(filename) == "![[Attachments/PDFs/2025-example-paper-123.pdf]]"


def test_rendered_paper_note_includes_pdf_embed(tmp_path):
    source_pdf = tmp_path / "2025-example-paper-123.pdf"
    source_pdf.write_bytes(b"%PDF-1.4 example")

    plan = render_landscape_export(
        topic="RAG evaluation",
        landscape_id="landscape-1",
        synthesis={},
        landscape_papers=[
            {
                "paper_id": "paper-1",
                "title": "Example Paper",
                "year": 2025,
                "venue": None,
                "authors": [],
                "url": "https://example.test/abs",
                "pdf_url": "https://example.test/pdf",
                "pdf_filename": source_pdf.name,
                "pdf_source_path": str(source_pdf),
                "arxiv_id": "123",
                "category": "must-read",
                "score": 0.9,
                "rationale": "test",
            }
        ],
        quizzes=[],
        flashcards=[],
        extractions_by_paper={},
        root=tmp_path,
    )

    paper_note = next(body for path, body in plan.files if Path(path).name == "example-paper.md")
    assert "**Source PDF URL:** https://example.test/pdf" in paper_note
    assert "[[Attachments/PDFs/2025-example-paper-123.pdf|Local PDF]]" in paper_note
    assert "![[Attachments/PDFs/2025-example-paper-123.pdf]]" in paper_note
    assert plan.binary_files[0][0].name == source_pdf.name


def test_repeated_export_does_not_rewrite_identical_pdf(tmp_path):
    plan = ExportPlan()
    target = tmp_path / "FieldMap Research" / "Attachments" / "PDFs" / "paper.pdf"
    plan.binary_files.append((target, b"%PDF-1.4 same bytes"))

    written_first, hashes_first, _sha_first, _pushed_first = write_plan(
        plan,
        root=tmp_path,
        commit_message="first",
        push=False,
    )
    written_second, hashes_second, _sha_second, _pushed_second = write_plan(
        plan,
        root=tmp_path,
        commit_message="second",
        push=False,
    )

    assert written_first == ["FieldMap Research/Attachments/PDFs/paper.pdf"]
    assert written_second == []
    assert hashes_first == hashes_second


def test_export_preview_does_not_write_files(tmp_path):
    Repo.init(tmp_path)
    plan = render_landscape_export(
        topic="RAG evaluation",
        landscape_id="landscape-1",
        synthesis={},
        landscape_papers=[],
        quizzes=[],
        flashcards=[],
        extractions_by_paper={},
        root=tmp_path,
        generated_at="2026-01-01T00:00:00Z",
    )

    preview = preview_plan(plan, root=tmp_path)

    assert preview.files_to_create
    assert preview.commit_needed is True
    assert not (tmp_path / "FieldMap Research").exists()


def test_export_preview_detects_file_changes(tmp_path):
    Repo.init(tmp_path)
    plan = render_landscape_export(
        topic="RAG evaluation",
        landscape_id="landscape-1",
        synthesis={},
        landscape_papers=[],
        quizzes=[],
        flashcards=[],
        extractions_by_paper={},
        root=tmp_path,
        generated_at="2026-01-01T00:00:00Z",
    )
    target = tmp_path / "FieldMap Research" / "Landscapes" / "rag-evaluation.md"
    target.parent.mkdir(parents=True)
    target.write_text("old body", encoding="utf-8")

    preview = preview_plan(plan, root=tmp_path)

    assert "FieldMap Research/Landscapes/rag-evaluation.md" in preview.files_to_update
    assert target.read_text(encoding="utf-8") == "old body"
