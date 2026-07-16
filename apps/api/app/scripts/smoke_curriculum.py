"""Image smoke test (design §5.4): prove the curriculum catalogue is present,
parseable and integrity-checked inside the running container — no DB, Redis
or provider required.

    python -m app.scripts.smoke_curriculum
"""

from __future__ import annotations

import argparse
import sys

from app.services.curriculum_catalog import get_catalog


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate the packaged curriculum catalogue"
    )
    parser.add_argument("--expected-version", type=int)
    parser.add_argument("--expected-hash")
    args = parser.parse_args(argv)
    if (args.expected_version is None) != (args.expected_hash is None):
        print(
            "FAIL curriculum catalogue: --expected-version and --expected-hash must be supplied together",
            file=sys.stderr,
        )
        return 2

    try:
        c = get_catalog()
    except Exception as e:  # noqa: BLE001
        print(f"FAIL curriculum catalogue: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    actual_version = int(c.curriculum["version"])
    actual_hash = c.source_tree_hash
    if args.expected_version is not None and actual_version != args.expected_version:
        print(
            "FAIL curriculum catalogue version mismatch: "
            f"expected={args.expected_version} actual={actual_version}",
            file=sys.stderr,
        )
        return 1
    if args.expected_hash is not None and actual_hash != args.expected_hash:
        print(
            "FAIL curriculum catalogue hash mismatch: "
            f"expected={args.expected_hash} actual={actual_hash}",
            file=sys.stderr,
        )
        return 1

    lesson_count = len(c.catalog["lessons"])
    print(
        "ok curriculum catalogue: "
        f"path={c.path} version={actual_version} hash={actual_hash} lessons={lesson_count}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
