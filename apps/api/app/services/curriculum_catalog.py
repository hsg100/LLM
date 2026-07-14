"""Loader for the compiled curriculum catalogue (design §6).

The api never parses curriculum YAML/Markdown: it loads the two committed
artifacts once at startup (lazily, cached) and serves progress/grading from
that immutable in-memory view.

Integrity model (design §6): the loader recomputes each artifact's
``artifact_hash`` (canonical JSON with the hash field nulled) and requires
both files to carry the same ``source_tree_hash``. Source-to-artifact
agreement is proven only by the CI drift gate — the raw sources are not
packaged with the api, and nothing here claims to verify them.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from app.config import get_settings

logger = logging.getLogger("fieldmap.curriculum")


class CatalogIntegrityError(RuntimeError):
    pass


def _canonical(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _artifact_hash(artifact: dict[str, Any]) -> str:
    unsigned = dict(artifact)
    unsigned["artifact_hash"] = None
    return hashlib.sha256(_canonical(unsigned).encode("utf-8")).hexdigest()


def _candidate_dirs() -> list[Path]:
    s = get_settings()
    if s.curriculum_catalog_dir:
        return [Path(s.curriculum_catalog_dir)]
    repo_root = Path(__file__).resolve().parents[4]  # app/services → app → api → apps → root
    return [Path("/curriculum/build"), repo_root / "curriculum" / "build"]


@dataclass(frozen=True)
class Catalog:
    catalog: dict[str, Any]
    grading: dict[str, Any]
    path: str

    @property
    def curriculum(self) -> dict[str, Any]:
        return self.catalog["curriculum"]

    @property
    def source_tree_hash(self) -> str:
        return self.catalog["source_tree_hash"]

    def lesson(self, slug: str) -> Optional[dict[str, Any]]:
        return self.catalog["lessons"].get(slug)

    def block_ids(self, lesson_slug: str) -> list[str]:
        lesson = self.lesson(lesson_slug)
        return [b["id"] for b in lesson["blocks"]] if lesson else []

    def grading_for(self, lesson_slug: str) -> Optional[dict[str, Any]]:
        return self.grading["checkpoints"].get(lesson_slug)

    def active_topic_lessons(self) -> dict[str, list[str]]:
        """topic slug → lesson slugs, for topics with status=active."""
        return {
            slug: t["lessons"]
            for slug, t in self.catalog["topics"].items()
            if t["status"] == "active"
        }


_lock = threading.Lock()
_cached: Optional[Catalog] = None
_load_error: Optional[str] = None


def _load() -> Catalog:
    last_missing: Optional[Path] = None
    for d in _candidate_dirs():
        cat_path = d / "catalog.json"
        grade_path = d / "catalog.grading.json"
        if not cat_path.exists() or not grade_path.exists():
            last_missing = d
            continue
        catalog = json.loads(cat_path.read_text())
        grading = json.loads(grade_path.read_text())
        for name, artifact in (("catalog.json", catalog), ("catalog.grading.json", grading)):
            claimed = artifact.get("artifact_hash")
            actual = _artifact_hash(artifact)
            if claimed != actual:
                raise CatalogIntegrityError(
                    f"{d / name}: artifact_hash mismatch (file corrupted or hand-edited)"
                )
        if catalog.get("source_tree_hash") != grading.get("source_tree_hash"):
            raise CatalogIntegrityError(
                f"{d}: catalog.json and catalog.grading.json were not built together "
                "(source_tree_hash differs)"
            )
        logger.info(
            "curriculum catalogue loaded from %s (version=%s hash=%s lessons=%d)",
            d,
            catalog["curriculum"]["version"],
            catalog["source_tree_hash"][:12],
            len(catalog["lessons"]),
        )
        return Catalog(catalog=catalog, grading=grading, path=str(d))
    raise CatalogIntegrityError(
        f"curriculum catalogue not found (looked in {[str(p) for p in _candidate_dirs()]}; "
        f"last missing: {last_missing})"
    )


def get_catalog() -> Catalog:
    """Load-once accessor. Raises CatalogIntegrityError on any failure."""
    global _cached, _load_error
    with _lock:
        if _cached is None:
            try:
                _cached = _load()
                _load_error = None
            except Exception as e:
                _load_error = f"{type(e).__name__}: {e}"
                raise
        return _cached


def catalog_status() -> dict[str, Any]:
    """For /ready: never raises."""
    try:
        c = get_catalog()
        return {
            "curriculum": "ok",
            "curriculum_version": c.curriculum["version"],
            "curriculum_hash": c.source_tree_hash,
        }
    except Exception as e:  # noqa: BLE001
        return {"curriculum": f"error: {type(e).__name__}: {str(e)[:200]}"}


def reset_catalog_cache_for_tests() -> None:
    global _cached, _load_error
    with _lock:
        _cached = None
        _load_error = None
