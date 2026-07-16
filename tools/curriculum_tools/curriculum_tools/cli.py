"""curriculum-tools CLI: validate | build [--check] | emit-schemas [--check] | semver-check."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .compile import compile_catalogues
from .contracts import Concept, CurriculumManifest, DemoRegistry, LessonFrontmatter, Topic
from .semver import check_semver

ARTIFACTS = ("catalog.json", "catalog.grading.json")
SCHEMAS = {
    "curriculum.schema.json": CurriculumManifest,
    "topic.schema.json": Topic,
    "concept.schema.json": Concept,
    "lesson-frontmatter.schema.json": LessonFrontmatter,
    "demo-registry.schema.json": DemoRegistry,
}


def _dump(data: dict) -> str:
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _fail(errors: list[str]) -> int:
    for e in errors:
        print(f"ERROR {e}", file=sys.stderr)
    print(f"{len(errors)} error(s)", file=sys.stderr)
    return 1


def cmd_validate(curriculum_dir: Path) -> int:
    _, _, errors = compile_catalogues(curriculum_dir)
    if errors:
        return _fail(errors)
    print("curriculum: valid")
    return 0


def cmd_build(curriculum_dir: Path, check: bool) -> int:
    catalog, grading, errors = compile_catalogues(curriculum_dir)
    if errors:
        return _fail(errors)
    build_dir = curriculum_dir / "build"
    rendered = {"catalog.json": _dump(catalog), "catalog.grading.json": _dump(grading)}
    if check:
        drift = []
        for name, content in rendered.items():
            existing = build_dir / name
            if not existing.exists():
                drift.append(f"drift: {existing} is missing — run `curriculum-tools build`")
            elif existing.read_text() != content:
                drift.append(f"drift: {existing} differs from compiled sources — run `curriculum-tools build`")
        if drift:
            return _fail(drift)
        print("build: committed artifacts match sources")
        return 0
    build_dir.mkdir(parents=True, exist_ok=True)
    for name, content in rendered.items():
        (build_dir / name).write_text(content)
        print(f"wrote {build_dir / name}")
    return 0


def cmd_emit_schemas(curriculum_dir: Path, check: bool) -> int:
    schema_dir = curriculum_dir / "schemas"
    drift = []
    for name, model in SCHEMAS.items():
        content = _dump(model.model_json_schema())
        target = schema_dir / name
        if check:
            if not target.exists() or target.read_text() != content:
                drift.append(f"drift: {target} differs from contracts — run `curriculum-tools emit-schemas`")
        else:
            schema_dir.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
            print(f"wrote {target}")
    if check:
        if drift:
            return _fail(drift)
        print("schemas: in sync with contracts")
    return 0


def _load_base_artifact(base_ref: str, repo_rel: str) -> dict | None:
    try:
        merge_base = subprocess.run(
            ["git", "merge-base", "HEAD", base_ref],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        shown = subprocess.run(
            ["git", "show", f"{merge_base}:{repo_rel}"],
            capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError:
        return None  # no merge base or file absent at base → initial introduction
    return json.loads(shown)


def cmd_semver_check(curriculum_dir: Path, base_ref: str) -> int:
    catalog, grading, errors = compile_catalogues(curriculum_dir)
    if errors:
        return _fail(errors)
    base_catalog = _load_base_artifact(base_ref, "curriculum/build/catalog.json")
    base_grading = _load_base_artifact(base_ref, "curriculum/build/catalog.grading.json")
    if base_catalog is None:
        print(f"semver: no catalogue at merge-base with {base_ref} — initial introduction, exempt")
        return 0
    errors = check_semver(base_catalog, base_grading, catalog, grading)
    if errors:
        return _fail(errors)
    print("semver: version discipline holds")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="curriculum-tools")
    parser.add_argument(
        "--curriculum-dir", type=Path, default=Path("curriculum"),
        help="path to the curriculum source directory (default: ./curriculum)",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    p_build = sub.add_parser("build")
    p_build.add_argument("--check", action="store_true")
    p_schemas = sub.add_parser("emit-schemas")
    p_schemas.add_argument("--check", action="store_true")
    p_semver = sub.add_parser("semver-check")
    p_semver.add_argument("--base-ref", default="origin/main")
    args = parser.parse_args(argv)

    d = args.curriculum_dir
    if args.command == "validate":
        return cmd_validate(d)
    if args.command == "build":
        return cmd_build(d, args.check)
    if args.command == "emit-schemas":
        return cmd_emit_schemas(d, args.check)
    if args.command == "semver-check":
        return cmd_semver_check(d, args.base_ref)
    return 2


if __name__ == "__main__":
    sys.exit(main())
