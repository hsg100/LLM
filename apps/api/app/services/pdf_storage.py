"""Safe deterministic storage for downloaded paper PDFs."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

from slugify import slugify

from app.config import get_settings


PDF_SUBDIR = "Attachments/PDFs"


def pdf_storage_root() -> Path:
    root = Path(get_settings().pdf_storage_dir).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def deterministic_pdf_filename(
    *,
    year: Optional[int],
    title: str,
    arxiv_id: Optional[str],
    paper_id: str,
) -> str:
    year_part = str(year) if year else "unknown"
    title_part = slugify(title)[:80] or "paper"
    raw_identifier = arxiv_id or paper_id
    identifier = slugify(raw_identifier)[:80] or hashlib.sha256(paper_id.encode()).hexdigest()[:12]
    return f"{year_part}-{title_part}-{identifier}.pdf"


def resolve_pdf_storage_path(storage_path: str | None) -> Path | None:
    if not storage_path:
        return None
    root = pdf_storage_root()
    candidate = (root / storage_path).resolve()
    if not is_safe_pdf_path(candidate, root=root):
        return None
    return candidate


def is_safe_pdf_path(path: Path, *, root: Path | None = None) -> bool:
    root = (root or pdf_storage_root()).resolve()
    try:
        resolved = path.resolve()
        resolved.relative_to(root)
    except (OSError, ValueError):
        return False
    return resolved.suffix.lower() == ".pdf"


def store_pdf_bytes(data: bytes, filename: str) -> tuple[str, Path, bool]:
    root = pdf_storage_root()
    path = (root / filename).resolve()
    if not is_safe_pdf_path(path, root=root):
        raise ValueError(f"unsafe pdf storage path: {filename}")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return filename, path, False
    path.write_bytes(data)
    return filename, path, True


def pdf_content_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pdf_vault_relpath(filename: str) -> str:
    safe = Path(filename).name
    return f"{PDF_SUBDIR}/{safe}"


def pdf_obsidian_embed(filename: str) -> str:
    return f"![[{pdf_vault_relpath(filename)}]]"
