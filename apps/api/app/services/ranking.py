"""Paper ranking.

Composite score combines:
  - semantic relevance (topic vs title+abstract embedding)
  - recency (gentle exponential decay by year)
  - citation count log-scaled (when available)
  - keyword boosts: survey/tutorial/review/benchmark/evaluation
  - MMR re-ranking for diversity

Then maps score percentiles to: must-read / useful / optional / skip-for-now.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional

from app.services.embeddings import EmbeddingDimensionError, EmbeddingProvider, cosine
from app.services.paper_sources.base import PaperCandidate
from app.services.vectors import to_list


SURVEY_KEYWORDS = ("survey", "tutorial", "review", "overview", "introduction to")
BENCHMARK_KEYWORDS = ("benchmark", "evaluation", "evaluating", "leaderboard", "dataset for")


@dataclass
class RankedPaper:
    candidate: PaperCandidate
    embedding: list[float]
    score: float
    category: str
    rationale: str


async def rank_papers(
    topic: str,
    candidates: list[PaperCandidate],
    provider: EmbeddingProvider,
    max_papers: int,
    mmr_lambda: float = 0.7,
) -> list[RankedPaper]:
    if not candidates:
        return []

    # 1) Embed topic + papers in one batch.
    texts = [topic] + [_paper_text(c) for c in candidates]
    raw_embs = await provider.embed(texts)
    if len(raw_embs) != len(texts):
        raise EmbeddingDimensionError(f"expected {len(texts)} embeddings, got {len(raw_embs)}")
    embs = []
    for i, emb in enumerate(raw_embs):
        plain = to_list(emb)
        if plain is None:
            raise EmbeddingDimensionError(f"embedding {i} is empty")
        if len(plain) != provider.dim:
            raise EmbeddingDimensionError(
                f"embedding {i} has dimension {len(plain)}; expected EMBEDDING_DIM={provider.dim}"
            )
        embs.append(plain)
    topic_emb, paper_embs = embs[0], embs[1:]

    # 2) Raw component scores per paper.
    rows: list[tuple[PaperCandidate, list[float], float, dict[str, float]]] = []
    this_year = datetime.utcnow().year
    for cand, emb in zip(candidates, paper_embs):
        comps = {
            "relevance": _scaled01(cosine(topic_emb, emb)),
            "recency": _recency_score(cand.year, this_year),
            "citations": _citation_score(cand.citation_count),
            "survey_boost": _kw_boost(cand, SURVEY_KEYWORDS, 0.10),
            "benchmark_boost": _kw_boost(cand, BENCHMARK_KEYWORDS, 0.07),
        }
        base = (
            0.55 * comps["relevance"]
            + 0.15 * comps["recency"]
            + 0.15 * comps["citations"]
            + comps["survey_boost"]
            + comps["benchmark_boost"]
        )
        rows.append((cand, emb, min(1.0, base), comps))

    # 3) MMR re-rank for diversity.
    selected_idx = _mmr_select(
        [r[1] for r in rows],
        [r[2] for r in rows],
        k=min(max_papers, len(rows)),
        lambda_=mmr_lambda,
    )
    selected = [rows[i] for i in selected_idx]

    # 4) Bucket categories by score quantile.
    scores = [s for *_x, s, _c in [(c, e, s, comps) for c, e, s, comps in selected]]  # noqa
    scores = [r[2] for r in selected]
    cats = _bucket_categories(scores)

    out: list[RankedPaper] = []
    for (cand, emb, score, comps), category in zip(selected, cats):
        out.append(
            RankedPaper(
                candidate=cand,
                embedding=emb,
                score=score,
                category=category,
                rationale=_format_rationale(comps, category),
            )
        )
    # Sort by score descending so reading order makes sense.
    out.sort(key=lambda r: r.score, reverse=True)
    return out


# ---------------------------------------------------------------------------
def _paper_text(c: PaperCandidate) -> str:
    abs_ = (c.abstract or "").strip()
    return f"{c.title}\n\n{abs_}" if abs_ else c.title


def _scaled01(x: float) -> float:
    # Cosine is in [-1, 1]; squash to [0, 1] with mild stretch.
    return max(0.0, min(1.0, (x + 1.0) / 2.0))


def _recency_score(year: Optional[int], this_year: int) -> float:
    if not year:
        return 0.4
    age = max(0, this_year - year)
    return math.exp(-age / 6.0)


def _citation_score(citations: Optional[int]) -> float:
    if not citations or citations < 0:
        return 0.3
    return min(1.0, math.log1p(citations) / math.log1p(2000))


def _kw_boost(cand: PaperCandidate, keywords: Iterable[str], amount: float) -> float:
    text = f"{cand.title} {cand.abstract or ''}".lower()
    return amount if any(kw in text for kw in keywords) else 0.0


def _bucket_categories(scores: list[float]) -> list[str]:
    if not scores:
        return []
    s_sorted = sorted(scores, reverse=True)
    n = len(s_sorted)
    if n == 0:
        return []
    cuts = {
        "must": s_sorted[max(0, int(n * 0.15) - 1)],
        "useful": s_sorted[max(0, int(n * 0.45) - 1)],
        "optional": s_sorted[max(0, int(n * 0.80) - 1)],
    }
    cats: list[str] = []
    for s in scores:
        if s >= cuts["must"]:
            cats.append("must-read")
        elif s >= cuts["useful"]:
            cats.append("useful")
        elif s >= cuts["optional"]:
            cats.append("optional")
        else:
            cats.append("skip-for-now")
    return cats


def _format_rationale(comps: dict[str, float], category: str) -> str:
    parts = [
        f"relevance={comps['relevance']:.2f}",
        f"recency={comps['recency']:.2f}",
        f"citations={comps['citations']:.2f}",
    ]
    if comps["survey_boost"] > 0:
        parts.append("survey/tutorial")
    if comps["benchmark_boost"] > 0:
        parts.append("benchmark/eval")
    return f"{category}: " + ", ".join(parts)


def _mmr_select(
    embeddings: list[list[float]],
    relevances: list[float],
    k: int,
    lambda_: float,
) -> list[int]:
    """Maximal Marginal Relevance selection.

    Picks an item that balances relevance against similarity to already
    selected items.
    """
    remaining = set(range(len(embeddings)))
    selected: list[int] = []
    if not remaining:
        return selected

    first = max(remaining, key=lambda i: relevances[i])
    selected.append(first)
    remaining.remove(first)

    while remaining and len(selected) < k:
        def mmr(i: int) -> float:
            sim_to_sel = max(cosine(embeddings[i], embeddings[j]) for j in selected)
            return lambda_ * relevances[i] - (1.0 - lambda_) * sim_to_sel

        best = max(remaining, key=mmr)
        selected.append(best)
        remaining.remove(best)
    return selected
