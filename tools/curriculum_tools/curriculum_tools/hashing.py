"""Hash taxonomy (design §6).

- source_tree_hash: over the canonicalised curriculum *sources* (everything
  under curriculum/ except build/). Only CI, holding the sources, can verify
  it against the artifacts.
- artifact_hash: each artifact's own canonical JSON with its artifact_hash
  field nulled. Anything holding the file can recompute it (the api does at
  startup).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

EXCLUDED_DIRS = {"build"}


def canonical_json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _is_source(p: Path, curriculum_dir: Path) -> bool:
    rel = p.relative_to(curriculum_dir)
    if not EXCLUDED_DIRS.isdisjoint(rel.parts[:1]):
        return False  # build/ holds compiled artifacts, not sources
    if p.name.endswith(".schema.json"):
        return False  # generated from the pydantic contracts (emit-schemas)
    return True


def source_tree_hash(curriculum_dir: Path) -> str:
    h = hashlib.sha256()
    files = sorted(
        p for p in curriculum_dir.rglob("*") if p.is_file() and _is_source(p, curriculum_dir)
    )
    for p in files:
        rel = p.relative_to(curriculum_dir).as_posix()
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def artifact_hash(artifact: dict[str, Any]) -> str:
    unsigned = dict(artifact)
    unsigned["artifact_hash"] = None
    return hashlib.sha256(canonical_json(unsigned).encode("utf-8")).hexdigest()


def verify_artifact(artifact: dict[str, Any]) -> bool:
    claimed = artifact.get("artifact_hash")
    return bool(claimed) and claimed == artifact_hash(artifact)
