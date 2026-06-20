"""Deterministic stub paper source.

Used as a development fallback when no real source returns usable
candidates. Generates exactly ten paper candidates whose titles,
abstracts, years, citation counts and authors are derived purely from
the topic string (hash-stable), so re-running with the same topic gives
the same papers.

The point is to let the rest of the pipeline (ranking, parsing, extraction,
synthesis, quiz, frontend, export) be exercised end-to-end even when
external APIs are unavailable. The PDFs are intentionally absent — the
parser will report ``no pdf url`` and extraction falls back to title +
abstract, which is exactly the behaviour we want to surface in dev.
"""

from __future__ import annotations

import hashlib
import re
from typing import Optional

from app.services.paper_sources.base import (
    PaperCandidate,
    PaperSource,
    SearchOutcome,
)


# Title, optional keyword-boost flavour ("survey"/"benchmark"/"tutorial"),
# offset year (subtracted from a base year), and citation count.
_TEMPLATES: list[tuple[str, Optional[str], int, int]] = [
    ("A Survey of {topic}", "survey", 1, 612),
    ("{topic} Benchmark: Methods and Metrics", "benchmark", 0, 184),
    ("Foundations of {topic}: Theory and Applications", None, 4, 980),
    ("Improving {topic} with Self-Supervised Learning", None, 0, 47),
    ("{topic} for Large Language Models", None, -1, 22),
    ("Limitations of {topic}: A Critical Analysis", None, 1, 73),
    ("Towards Robust {topic}: Challenges and Solutions", None, 2, 138),
    ("An Empirical Study of {topic} on Real-World Tasks", "benchmark", 0, 41),
    ("Tutorial: Getting Started with {topic}", "tutorial", 1, 162),
    ("{topic} in Practice: Industry Perspectives", None, 0, 26),
]

_BASE_YEAR = 2024


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return out or "topic"


def _normalize(s: str) -> str:
    s = re.sub(r"\s+", " ", (s or "")).strip()
    return s or "Topic"


def _author_pool(topic: str) -> list[str]:
    """Deterministic author names derived from the topic hash."""
    first_names = [
        "A.", "B.", "C.", "D.", "E.", "F.", "G.", "H.", "J.", "K.",
        "L.", "M.", "N.", "P.", "R.", "S.", "T.", "V.", "W.", "Y.",
    ]
    last_names = [
        "Alvarez", "Bose", "Chen", "Davies", "Eriksen", "Fang", "Gomez",
        "Halder", "Iyer", "Johansson", "Kowalski", "Lee", "Müller",
        "Nakamura", "O'Brien", "Patel", "Quinn", "Rao", "Schneider",
        "Tanaka", "Ueno", "Velasquez", "Williams", "Xu", "Yamamoto",
        "Zhao",
    ]
    h = hashlib.blake2b(topic.encode(), digest_size=16).digest()
    out: list[str] = []
    for i in range(3):
        f = first_names[h[i] % len(first_names)]
        l = last_names[h[i + 3] % len(last_names)]
        out.append(f"{f} {l}")
    return out


def _abstract(topic: str, title: str, flavour: Optional[str], idx: int) -> str:
    t = topic
    if flavour == "survey":
        return (
            f"We survey recent work on {t}, covering core methods, evaluation "
            f"setups, and open problems. We organise the literature into "
            f"thematic clusters and discuss tradeoffs between approaches."
        )
    if flavour == "benchmark":
        return (
            f"We introduce a benchmark for {t}, including datasets, evaluation "
            f"protocols and baselines. We report results across {3 + (idx % 4)} "
            f"settings and highlight cases where current methods underperform."
        )
    if flavour == "tutorial":
        return (
            f"This tutorial introduces {t} to readers familiar with general "
            f"machine learning. We cover prerequisites, walk through a worked "
            f"example, and point to resources for further study."
        )
    variants = [
        f"We propose a new approach to {t} and show empirical improvements over strong baselines on standard datasets.",
        f"We study failure modes of existing {t} methods and propose mitigations grounded in their underlying assumptions.",
        f"We present a unifying framework for {t} that recovers several prior methods as special cases.",
        f"We give an empirical analysis of {t} across model and data scales, with implications for practitioners.",
    ]
    return variants[idx % len(variants)]


class StubSource(PaperSource):
    """Deterministic stub paper source.

    ``search`` always returns a populated :class:`SearchOutcome` with
    ``succeeded=True``.
    """

    name = "stub"

    async def search(self, topic: str, max_results: int) -> SearchOutcome:
        topic = _normalize(topic)
        slug = _slug(topic)
        candidates: list[PaperCandidate] = []
        for i, (title_t, flavour, year_offset, citations) in enumerate(_TEMPLATES):
            title = title_t.format(topic=topic)
            cand = PaperCandidate(
                source=self.name,
                external_id=f"stub-{slug}-{i:02d}",
                title=title,
                abstract=_abstract(topic, title, flavour, i),
                authors=_author_pool(f"{topic}/{i}"),
                year=_BASE_YEAR - year_offset,
                venue="StubVenue",
                citation_count=citations,
                pdf_url=None,
                arxiv_id=None,
                doi=None,
                url=None,
                metadata={"stub": True, "flavour": flavour or "general"},
            )
            candidates.append(cand)
        return SearchOutcome(
            source=self.name,
            query=f"stub:{topic}",
            candidates=candidates[: max(1, int(max_results))],
            raw_entry_count=len(candidates),
            succeeded=True,
        )
