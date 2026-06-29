"""Deterministic relevance gate for landscape topics — the *fast fail*.

FieldMap maps **research** fields (primarily ML/AI and adjacent science).
Without a guard, anyone can spam the pipeline with off-topic queries — video
games, adult/social-media personalities, sports, celebrities — and each one
burns a full arXiv search + embedding + PDF parse + LLM extraction/synthesis
run and leaves a junk landscape behind.

This module is the gate. It is intentionally:

* **Cheap** — pure Python, no network, no LLM, no DB. Safe to run inline in the
  request path before a ``Landscape``/``SearchJob`` is ever created.
* **Precise over exhaustive** — it only rejects topics it is confident are
  off-topic or structurally meaningless, so it never blocks a legitimate niche
  research query. A denylisted word inside a real research phrase
  ("reinforcement learning in Minecraft") is allowed; a bare "gta" is not.

If a fuzzier semantic gate is ever wanted, an LLM classifier can be layered on
*after* this check — but the cheap deterministic pass should always run first.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------
# Reason codes (the ``category`` field) — stable strings so callers/tests can
# branch on them without parsing the human message.
CATEGORY_OK = ""
CATEGORY_TOO_SHORT = "too_short"
CATEGORY_NO_LETTERS = "no_letters"
CATEGORY_GIBBERISH = "gibberish"
CATEGORY_OFFTOPIC = "offtopic"  # paired with a sub-category, e.g. "offtopic:games"


@dataclass(frozen=True)
class TopicVerdict:
    """Outcome of evaluating a topic string."""

    ok: bool
    normalized: str
    category: str = CATEGORY_OK
    reason: str = ""


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------
# Research-signal terms. If any appears as a whole word, the topic is treated as
# a genuine research query and the off-topic blocklist is *skipped*. This is the
# escape hatch that keeps "RL in Minecraft" or "GAN-generated game assets" from
# being rejected, while bare entertainment nouns still fail.
RESEARCH_SIGNAL_TERMS: frozenset[str] = frozenset(
    {
        "learning", "model", "models", "neural", "network", "networks", "deep",
        "transformer", "transformers", "attention", "embedding", "embeddings",
        "training", "fine", "finetuning", "pretraining", "inference",
        "algorithm", "algorithms", "optimization", "optimisation", "gradient",
        "reinforcement", "supervised", "unsupervised", "self", "semi",
        "generative", "discriminative", "diffusion", "gan", "gans", "vae",
        "language", "vision", "multimodal", "speech", "audio", "nlp",
        "agent", "agents", "agentic", "rlhf", "alignment", "interpretability",
        "evaluation", "benchmark", "benchmarks", "dataset", "datasets",
        "classification", "regression", "detection", "segmentation",
        "prediction", "forecasting", "clustering", "retrieval", "ranking",
        "architecture", "architectures", "scaling", "quantization", "pruning",
        "distillation", "tokenization", "tokenizer", "decoding",
        "research", "paper", "papers", "survey", "study", "theory", "analysis",
        "method", "methods", "approach", "framework", "system", "systems",
        "robotics", "robot", "control", "planning", "perception",
        "quantum", "physics", "chemistry", "biology", "genomics", "protein",
        "proteins", "molecular", "medical", "clinical", "climate", "materials",
        "graph", "graphs", "bayesian", "probabilistic", "statistical",
        "convolutional", "recurrent", "sequence", "representation",
        "knowledge", "reasoning", "causal", "transfer", "federated",
        "adversarial", "robustness", "privacy", "fairness", "safety",
        "simulation", "estimation", "sampling", "variational",
    }
)

# Off-topic blocklist by sub-category. Entries are matched as whole
# words/phrases (word boundaries) against the lower-cased topic, and only fire
# when no research signal is present. Keep entries lowercase.
OFFTOPIC_BLOCKLIST: dict[str, tuple[str, ...]] = {
    "adult_or_creator": (
        "bonnie blue", "onlyfans", "only fans", "pornhub", "porn", "nsfw",
        "xxx", "camgirl", "escort",
    ),
    "video_games": (
        "gta", "grand theft auto", "fortnite", "minecraft", "call of duty",
        "warzone", "league of legends", "valorant", "roblox", "elden ring",
        "pokemon", "pokémon", "zelda", "mario", "fifa", "cyberpunk 2077",
        "genshin impact", "counter strike", "counter-strike", "overwatch",
        "apex legends", "the sims", "candy crush", "clash of clans",
    ),
    "sports_entertainment": (
        "premier league", "champions league", "world cup", "super bowl",
        "cristiano ronaldo", "lionel messi", "lebron james",
        "taylor swift", "kim kardashian", "kanye west", "mrbeast",
        "tiktok", "instagram reels", "netflix series", "marvel movie",
        "kardashian", "celebrity gossip",
    ),
    "spam_placeholder": (
        "lorem ipsum", "asdf", "asdfgh", "qwerty", "test test",
    ),
}

# Pre-compiled matchers. ``(?<![a-z0-9])phrase(?![a-z0-9])`` gives word-boundary
# matching that also works for short tokens like "gta" and multiword phrases.
_BLOCKLIST_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = tuple(
    (category, phrase, re.compile(rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])"))
    for category, phrases in OFFTOPIC_BLOCKLIST.items()
    for phrase in phrases
)

_WORD_RE = re.compile(r"[a-z0-9]+")
_MIN_CHARS = 2


def normalize_topic(topic: str) -> str:
    """Trim and collapse internal whitespace. Casing is preserved."""
    return re.sub(r"\s+", " ", (topic or "").strip())


def _has_research_signal(lowered: str) -> bool:
    return any(tok in RESEARCH_SIGNAL_TERMS for tok in _WORD_RE.findall(lowered))


def _looks_like_gibberish(normalized: str, lowered: str) -> bool:
    """Heuristics for keyboard-mash / symbol-spam, kept conservative.

    Only fires on clearly meaningless input so legitimate short topics (e.g.
    "GPT-4", "RAG", "C++") are never caught.
    """
    no_space = normalized.replace(" ", "")
    if not no_space:
        return True
    letters = sum(c.isalpha() for c in no_space)
    # Mostly symbols/digits with little alphabetic content, e.g. "$$$$", "123456".
    if len(no_space) >= 4 and letters / len(no_space) < 0.4:
        return True
    # A single token that is one character repeated, e.g. "aaaa", "!!!!".
    if " " not in normalized and len(no_space) >= 4 and len(set(no_space.lower())) == 1:
        return True
    return False


def evaluate_topic(topic: str) -> TopicVerdict:
    """Classify a topic string. ``ok=False`` means: do not start a landscape."""
    normalized = normalize_topic(topic)
    lowered = normalized.lower()

    if len(normalized) < _MIN_CHARS:
        return TopicVerdict(
            ok=False,
            normalized=normalized,
            category=CATEGORY_TOO_SHORT,
            reason="Topic is too short. Enter a research area, e.g. “RAG evaluation”.",
        )

    if not any(c.isalpha() for c in normalized):
        return TopicVerdict(
            ok=False,
            normalized=normalized,
            category=CATEGORY_NO_LETTERS,
            reason="Topic must contain words describing a research area.",
        )

    if _looks_like_gibberish(normalized, lowered):
        return TopicVerdict(
            ok=False,
            normalized=normalized,
            category=CATEGORY_GIBBERISH,
            reason="That doesn’t look like a research topic. Try something like “mechanistic interpretability”.",
        )

    # A genuine research framing around an otherwise off-topic noun is allowed.
    if not _has_research_signal(lowered):
        for category, phrase, pattern in _BLOCKLIST_PATTERNS:
            if pattern.search(lowered):
                return TopicVerdict(
                    ok=False,
                    normalized=normalized,
                    category=f"{CATEGORY_OFFTOPIC}:{category}",
                    reason=(
                        "FieldMap maps ML/AI research fields, not general topics like "
                        f"“{normalized}”. Try a research area such as “LLM agents” or "
                        "“diffusion models”."
                    ),
                )

    return TopicVerdict(ok=True, normalized=normalized)


def is_offtopic(topic: str) -> bool:
    """Convenience predicate for cleanup tooling."""
    return not evaluate_topic(topic).ok
