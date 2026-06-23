"""Purge off-topic / spam landscapes that predate the topic guard.

Applies ``app.services.topic_guard`` to every existing landscape and removes the
ones that fail (cascade-deleting jobs, events, links, clusters, concepts,
quizzes, flashcards, relationships, review state and exports — shared papers are
kept). Safe by default: prints what it *would* delete and does nothing until
``--apply`` is passed.

Run inside the API environment:

    # Preview every off-topic landscape (no changes):
    python -m app.scripts.purge_offtopic_landscapes

    # Actually delete them:
    python -m app.scripts.purge_offtopic_landscapes --apply

    # Force-remove specific topics regardless of the guard verdict:
    python -m app.scripts.purge_offtopic_landscapes --topic "gta" --topic "bonnie blue" --apply
"""

from __future__ import annotations

import argparse
import sys

from sqlmodel import select

from app.db import session_scope
from app.models import Landscape
from app.services.landscape_cleanup import (
    delete_landscape_cascade,
    find_offtopic_landscapes,
)
from app.services.topic_guard import evaluate_topic


def _matches_topic_filters(topic: str, filters: list[str]) -> bool:
    t = topic.strip().lower()
    return any(t == f.strip().lower() for f in filters)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete (default is a dry run that only prints).",
    )
    parser.add_argument(
        "--topic",
        action="append",
        default=[],
        metavar="TOPIC",
        help="Force-remove landscapes whose topic matches exactly (case-insensitive). Repeatable.",
    )
    args = parser.parse_args(argv)

    with session_scope() as s:
        targets: dict[str, tuple[str, str]] = {}  # id -> (topic, reason)

        for offtopic in find_offtopic_landscapes(s):
            targets[offtopic.id] = (offtopic.topic, offtopic.verdict.reason)

        if args.topic:
            for ls in s.exec(select(Landscape)).all():
                if ls.id not in targets and _matches_topic_filters(ls.topic, args.topic):
                    verdict = evaluate_topic(ls.topic)
                    targets[ls.id] = (
                        ls.topic,
                        verdict.reason or "matched --topic filter",
                    )

        if not targets:
            print("No off-topic landscapes found. Nothing to do.")
            return 0

        verb = "Deleting" if args.apply else "Would delete"
        print(f"{verb} {len(targets)} landscape(s):")
        for ls_id, (topic, reason) in targets.items():
            print(f"  - {ls_id}  {topic!r}\n      reason: {reason}")

        if not args.apply:
            print("\nDry run — no changes made. Re-run with --apply to delete.")
            return 0

        total: dict[str, int] = {}
        for ls_id in targets:
            counts = delete_landscape_cascade(s, ls_id)
            for table, n in counts.items():
                total[table] = total.get(table, 0) + n

        print("\nDeleted rows by table:")
        for table, n in sorted(total.items()):
            print(f"  {table}: {n}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
