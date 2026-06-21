"""Cross-source merge dedupe, Semantic Scholar mapping, quality-aware ranking."""
from __future__ import annotations

from app.services.paper_sources.base import PaperCandidate, dedupe
from app.services.paper_sources.semantic_scholar import _entry_to_candidate
from app.services.ranking import _bucket_categories


def test_merge_dedupe_combines_arxiv_pdf_with_s2_citations():
    arxiv = PaperCandidate(
        source="arxiv",
        external_id="2401.00001",
        title="Retrieval Augmented Generation",
        arxiv_id="2401.00001",
        pdf_url="https://arxiv.org/pdf/2401.00001.pdf",
    )
    s2 = PaperCandidate(
        source="semantic_scholar",
        external_id="s2abc",
        title="Retrieval Augmented Generation",
        arxiv_id="2401.00001",
        citation_count=128,
        doi="10.1/rag",
    )
    merged = dedupe([arxiv, s2])
    assert len(merged) == 1
    m = merged[0]
    # Identity from the higher-priority source (S2), PDF borrowed from arXiv,
    # citations + DOI preserved.
    assert m.source == "semantic_scholar"
    assert m.citation_count == 128
    assert m.doi == "10.1/rag"
    assert m.pdf_url == "https://arxiv.org/pdf/2401.00001.pdf"
    assert set(m.metadata["merged_sources"]) == {"arxiv", "semantic_scholar"}


def test_dedupe_keeps_distinct_papers():
    a = PaperCandidate(source="arxiv", external_id="1", title="Paper A", doi="10.1/a")
    b = PaperCandidate(source="arxiv", external_id="2", title="Paper B", doi="10.1/b")
    assert len(dedupe([a, b])) == 2


def test_s2_entry_mapping():
    cand = _entry_to_candidate(
        {
            "paperId": "abc",
            "title": "A Survey",
            "abstract": "x",
            "year": 2023,
            "venue": "NeurIPS",
            "authors": [{"name": "Jane Doe"}],
            "citationCount": 42,
            "influentialCitationCount": 7,
            "externalIds": {"DOI": "10.5/survey", "ArXiv": "2301.12345"},
            "openAccessPdf": {"url": "https://x/y.pdf"},
            "url": "https://semanticscholar.org/paper/abc",
        }
    )
    assert cand is not None
    assert cand.source == "semantic_scholar"
    assert cand.citation_count == 42
    assert cand.doi == "10.5/survey"
    assert cand.arxiv_id == "2301.12345"
    assert cand.pdf_url == "https://x/y.pdf"
    assert cand.metadata["influential_citation_count"] == 7


def test_ranking_tiers_are_absolute_not_quota():
    # A genuinely weak set must NOT be forced to yield many must-reads.
    weak = [0.30, 0.28, 0.26, 0.24, 0.22, 0.20, 0.18, 0.16, 0.14, 0.12]
    cats = _bucket_categories(weak)
    # Relative floor still surfaces an entry point...
    assert cats[0] == "must-read"
    # ...but the rest stay low on absolute quality (no quota of must-reads).
    assert cats.count("must-read") == 1
    assert cats[-1] == "skip-for-now"


def test_ranking_tiers_reward_strong_set():
    strong = [0.9, 0.85, 0.82, 0.7, 0.66, 0.61]
    cats = _bucket_categories(strong)
    # All clear the absolute must-read threshold.
    assert all(c == "must-read" for c in cats)
