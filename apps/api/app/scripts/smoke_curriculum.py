"""Image smoke test (design §5.4): prove the curriculum catalogue is present,
parseable and integrity-checked inside the running container — no DB, Redis
or provider required.

    python -m app.scripts.smoke_curriculum
"""

from __future__ import annotations

import sys

from app.services.curriculum_catalog import get_catalog


def main() -> int:
    try:
        c = get_catalog()
    except Exception as e:  # noqa: BLE001
        print(f"FAIL curriculum catalogue: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    print(
        "ok curriculum catalogue: "
        f"path={c.path} version={c.curriculum['version']} "
        f"hash={c.source_tree_hash[:12]} lessons={len(c.catalog['lessons'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
