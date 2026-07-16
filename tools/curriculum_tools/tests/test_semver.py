"""Red-path tests for semantic version discipline (final-approval condition 2)."""

from pathlib import Path

from curriculum_tools.compile import compile_catalogues
from curriculum_tools.semver import check_semver


def build(d: Path):
    catalog, grading, errors = compile_catalogues(d)
    assert errors == [], errors
    return catalog, grading


def rebuilt_after(curriculum_dir: Path, mutate) -> tuple:
    base_c, base_g = build(curriculum_dir)
    mutate(curriculum_dir)
    new_c, new_g = build(curriculum_dir)
    return check_semver(base_c, base_g, new_c, new_g)


def lesson(curriculum_dir: Path) -> Path:
    return curriculum_dir / "lessons" / "lesson-a.md"


def bump_lesson_version(curriculum_dir: Path):
    p = lesson(curriculum_dir)
    p.write_text(p.read_text().replace("version: 1", "version: 2"))


def test_initial_introduction_exempt(curriculum_dir: Path):
    c, g = build(curriculum_dir)
    assert check_semver(None, None, c, g) == []


def test_no_change_passes(curriculum_dir: Path):
    c, g = build(curriculum_dir)
    assert check_semver(c, g, c, g) == []


def test_answer_key_change_requires_bump(curriculum_dir: Path):
    def mutate(d):
        p = lesson(d)
        p.write_text(
            p.read_text().replace("options: [wrong, right]", "options: [right, wrong]")
            .replace("correct_index: 1", "correct_index: 0")
        )

    errors = rebuilt_after(curriculum_dir, mutate)
    assert any("semver: lesson 'lesson-a'" in e for e in errors)


def test_pass_score_change_requires_bump(curriculum_dir: Path):
    def mutate(d):
        p = lesson(d)
        p.write_text(p.read_text().replace("pass_score: 0.8", "pass_score: 0.5"))

    assert rebuilt_after(curriculum_dir, mutate)


def test_objectives_change_requires_bump(curriculum_dir: Path):
    def mutate(d):
        p = lesson(d)
        p.write_text(p.read_text().replace("- Objective one", "- A different objective"))

    assert rebuilt_after(curriculum_dir, mutate)


def test_block_reorder_requires_bump(curriculum_dir: Path):
    def mutate(d):
        p = lesson(d)
        body = p.read_text()
        body = body.replace("## First block", "## TEMP").replace(
            "## Second block", "## First block"
        ).replace("## TEMP", "## Second block")
        p.write_text(body)

    assert rebuilt_after(curriculum_dir, mutate)


def test_topic_membership_change_requires_curriculum_bump(curriculum_dir: Path):
    def mutate(d):
        (d / "lessons" / "lesson-b.md").write_text(
            lesson(d).read_text().replace("slug: lesson-a", "slug: lesson-b").replace(
                "title: Lesson A", "title: Lesson B"
            )
        )
        t = d / "topics" / "topic-a.yaml"
        t.write_text(t.read_text().replace("lessons:\n  - lesson-a", "lessons:\n  - lesson-a\n  - lesson-b"))

    errors = rebuilt_after(curriculum_dir, mutate)
    assert any("semver: curriculum semantics changed" in e for e in errors)


def test_narrative_edit_is_version_neutral(curriculum_dir: Path):
    def mutate(d):
        p = lesson(d)
        p.write_text(p.read_text().replace("Some narrative.", "Some improved narrative."))

    assert rebuilt_after(curriculum_dir, mutate) == []


def test_citation_metadata_is_version_neutral(curriculum_dir: Path):
    def mutate(d):
        p = lesson(d)
        p.write_text(p.read_text().replace("url: https://example.org/paper", "url: https://example.org/paper-v2"))

    assert rebuilt_after(curriculum_dir, mutate) == []


def test_bumped_semantic_change_passes(curriculum_dir: Path):
    def mutate(d):
        p = lesson(d)
        p.write_text(
            p.read_text()
            .replace("pass_score: 0.8", "pass_score: 0.9")
            .replace("version: 1", "version: 2")
        )

    assert rebuilt_after(curriculum_dir, mutate) == []
