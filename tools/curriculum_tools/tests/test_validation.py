"""Red-path tests: every validator rule class must fail CI (design §12)."""

from pathlib import Path

from curriculum_tools.compile import compile_catalogues
from curriculum_tools.hashing import verify_artifact


def errors_for(d: Path) -> list[str]:
    _, _, errors = compile_catalogues(d)
    return errors


def assert_rule(errors: list[str], marker: str):
    assert any(marker in e for e in errors), f"expected {marker!r} in {errors}"


def test_valid_curriculum_compiles(curriculum_dir: Path):
    catalog, grading, errors = compile_catalogues(curriculum_dir)
    assert errors == []
    assert list(catalog["lessons"]) == ["lesson-a"]
    assert verify_artifact(catalog) and verify_artifact(grading)
    assert catalog["source_tree_hash"] == grading["source_tree_hash"]
    # answer keys only in the grading catalogue
    assert "correct_index" not in str(catalog)
    assert grading["checkpoints"]["lesson-a"]["answer_key"] == {"q1": 1}


def test_rule1_schema_violation(curriculum_dir: Path):
    (curriculum_dir / "topics" / "topic-a.yaml").write_text("slug: topic-a\nbogus_field: 1\n")
    assert_rule(errors_for(curriculum_dir), "rule1 schema")


def test_rule2_unknown_topic_prerequisite(curriculum_dir: Path):
    p = curriculum_dir / "topics" / "topic-a.yaml"
    p.write_text(p.read_text().replace("prerequisites: []", "prerequisites:\n  - ghost-topic"))
    assert_rule(errors_for(curriculum_dir), "rule2 unknown-ref")


def test_rule2_unknown_checkpoint_concept(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(p.read_text().replace("      concept: concept-a", "      concept: ghost-concept"))
    assert_rule(errors_for(curriculum_dir), "rule2 unknown-ref")


def test_rule3_duplicate_topic_lesson_slug(curriculum_dir: Path):
    (curriculum_dir / "topics" / "lesson-a.yaml").write_text(
        "slug: lesson-a\ntitle: X\nsummary: Y\nstatus: planned\n"
    )
    errors = errors_for(curriculum_dir)
    assert_rule(errors, "rule3 duplicate")


def test_rule3_duplicate_block_ids(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(p.read_text().replace("## Second block", "## First block"))
    assert_rule(errors_for(curriculum_dir), "rule3 duplicate")


def test_rule4_topic_cycle(curriculum_dir: Path):
    (curriculum_dir / "topics" / "topic-b.yaml").write_text(
        "slug: topic-b\ntitle: B\nsummary: B\nstatus: planned\nprerequisites:\n  - topic-a\n"
    )
    p = curriculum_dir / "topics" / "topic-a.yaml"
    p.write_text(p.read_text().replace("prerequisites: []", "prerequisites:\n  - topic-b"))
    c = curriculum_dir / "curriculum.yaml"
    c.write_text(c.read_text() + "  - topic-b\n")
    assert_rule(errors_for(curriculum_dir), "rule4 cycle")


def test_rule5_unknown_demo(curriculum_dir: Path):
    (curriculum_dir / "schemas" / "demo-registry.yaml").write_text("demos: []\n")
    assert_rule(errors_for(curriculum_dir), "rule5 unknown-demo")


def test_rule6_missing_fallback(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(
        p.read_text().replace(
            "demo_fallbacks:\n  demo-x: A plain-text fallback conveying the same point.",
            "demo_fallbacks: {}",
        )
    )
    assert_rule(errors_for(curriculum_dir), "rule6 missing-fallback")


def test_rule7_active_topic_without_lessons(curriculum_dir: Path):
    p = curriculum_dir / "topics" / "topic-a.yaml"
    p.write_text(p.read_text().replace("lessons:\n  - lesson-a", "lessons: []"))
    errors = errors_for(curriculum_dir)
    assert_rule(errors, "rule7 content")


def test_rule7_bad_correct_index(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(p.read_text().replace("correct_index: 1", "correct_index: 9"))
    assert_rule(errors_for(curriculum_dir), "rule1 schema")


def test_rule7_source_without_url(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(p.read_text().replace("    url: https://example.org/paper\n", ""))
    assert_rule(errors_for(curriculum_dir), "rule1 schema")


def test_rule8_raw_html_rejected(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(p.read_text() + "\n<script>alert(1)</script>\n")
    assert_rule(errors_for(curriculum_dir), "rule8 raw-html")


def test_rule8_inline_html_rejected(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(p.read_text().replace("Some narrative.", "Some <b>narrative</b>."))
    assert_rule(errors_for(curriculum_dir), "rule8 raw-html")


def test_content_before_first_block_rejected(curriculum_dir: Path):
    p = curriculum_dir / "lessons" / "lesson-a.md"
    p.write_text(p.read_text().replace("## First block", "Stray intro.\n\n## First block"))
    assert_rule(errors_for(curriculum_dir), "rule3 blocks")


def test_determinism(curriculum_dir: Path):
    a1, g1, _ = compile_catalogues(curriculum_dir)
    a2, g2, _ = compile_catalogues(curriculum_dir)
    assert a1 == a2 and g1 == g2
