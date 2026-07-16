"""Focused tests for exact packaged-curriculum identity smoke checks."""

from app.scripts.smoke_curriculum import main
from app.services.curriculum_catalog import get_catalog


def _identity() -> tuple[int, str]:
    catalog = get_catalog()
    return int(catalog.curriculum["version"]), catalog.source_tree_hash


def test_smoke_accepts_exact_version_and_full_hash(capsys):
    version, source_hash = _identity()

    assert (
        main(["--expected-version", str(version), "--expected-hash", source_hash]) == 0
    )
    output = capsys.readouterr()
    assert source_hash in output.out


def test_smoke_rejects_version_mismatch(capsys):
    version, source_hash = _identity()

    assert (
        main(["--expected-version", str(version + 1), "--expected-hash", source_hash])
        == 1
    )
    assert "version mismatch" in capsys.readouterr().err


def test_smoke_rejects_full_hash_mismatch(capsys):
    version, source_hash = _identity()
    different_hash = ("0" if source_hash[0] != "0" else "1") + source_hash[1:]

    assert (
        main(["--expected-version", str(version), "--expected-hash", different_hash])
        == 1
    )
    assert "hash mismatch" in capsys.readouterr().err


def test_smoke_requires_identity_arguments_as_a_pair(capsys):
    version, _source_hash = _identity()

    assert main(["--expected-version", str(version)]) == 2
    assert "must be supplied together" in capsys.readouterr().err
