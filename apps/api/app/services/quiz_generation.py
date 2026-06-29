"""MCQ + flashcard generation from per-paper extractions."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional

from app.services.llm import LLMProvider
from app.services.prompts import render
from app.services.synthesis import build_papers_json

# Reject MCQs whose stem asks the learner to attribute a method/contribution
# /limitation to a specific paper. Tests rote source-attribution rather than
# understanding.
_PAPER_ATTRIBUTION_RE = re.compile(
    r"\b(which|what)\s+(?:of\s+(?:these|the|the\s+following)\s+)?papers?\b",
    re.IGNORECASE,
)


def is_paper_attribution_stem(stem: str) -> bool:
    return bool(_PAPER_ATTRIBUTION_RE.search(stem or ""))


async def generate_quizzes_and_flashcards(
    llm: LLMProvider,
    *,
    topic: str,
    landscape_papers: list[dict[str, Any]],
    timeout_seconds: int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not landscape_papers:
        return [], []

    user_prompt = render(
        "quiz",
        topic=topic,
        papers_json=build_papers_json(landscape_papers),
    )
    messages = [
        {"role": "system", "content": "You are a study-material author. Output valid JSON only."},
        {"role": "user", "content": user_prompt},
    ]

    try:
        call = llm.complete_json(messages, stage="active_recall")
        raw = await asyncio.wait_for(call, timeout=timeout_seconds) if timeout_seconds else await call
    except Exception:  # noqa: BLE001
        return _fallback_quizzes_and_flashcards(landscape_papers)

    quizzes = _sanitize_quizzes(raw.get("quizzes") or [])
    flashcards = _sanitize_flashcards(raw.get("flashcards") or [])
    if not quizzes and not flashcards:
        return _fallback_quizzes_and_flashcards(landscape_papers)
    return quizzes, flashcards


def _sanitize_quizzes(items: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        question = (it.get("question") or "").strip()
        options = [str(o).strip() for o in (it.get("options") or []) if str(o).strip()]
        if not question or len(options) < 2:
            continue
        if is_paper_attribution_stem(question):
            continue
        try:
            correct = int(it.get("correct_index", 0))
        except Exception:  # noqa: BLE001
            correct = 0
        correct = max(0, min(len(options) - 1, correct))
        out.append(
            {
                "question": question,
                "options": options[:6],
                "correct_index": correct,
                "explanation": (it.get("explanation") or "").strip() or None,
                "paper_id": _coerce_id(it.get("paper_id")),
                "concept": (it.get("concept") or "").strip() or None,
                "difficulty": _clamp_int(it.get("difficulty"), 1, 5, 1),
            }
        )
    return out


def _sanitize_flashcards(items: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        front = (it.get("front") or "").strip()
        back = (it.get("back") or "").strip()
        if not front or not back:
            continue
        kind = (it.get("kind") or "recall").strip().lower()
        if kind == "compare":
            # Paper-comparison cards test source attribution, not understanding.
            continue
        if kind not in {"recall", "explain", "cloze"}:
            kind = "recall"
        out.append(
            {
                "front": front,
                "back": back,
                "paper_id": _coerce_id(it.get("paper_id")),
                "concept": (it.get("concept") or "").strip() or None,
                "kind": kind,
            }
        )
    return out


def _coerce_id(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() in {"null", "none"}:
        return None
    return s


def _clamp_int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except Exception:  # noqa: BLE001
        return default


def _fallback_quizzes_and_flashcards(
    landscape_papers: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    quizzes: list[dict[str, Any]] = []
    flashcards: list[dict[str, Any]] = []

    for p in landscape_papers:
        ext = p.get("extraction") or {}
        paper_id = _coerce_id(p.get("paper_id"))
        title = str(p.get("title") or "this paper")
        method = _clean_answer(ext.get("method"))
        problem = _clean_answer(ext.get("problem"))
        results = [_clean_answer(x) for x in (ext.get("results") or []) if _clean_answer(x)]
        limitations = [_clean_answer(x) for x in (ext.get("limitations") or []) if _clean_answer(x)]

        if method:
            flashcards.append(
                {
                    "front": f"What method does '{title}' use?",
                    "back": method,
                    "paper_id": paper_id,
                    "concept": "method",
                    "kind": "recall",
                }
            )
        if problem:
            flashcards.append(
                {
                    "front": f"What problem does '{title}' address?",
                    "back": problem,
                    "paper_id": paper_id,
                    "concept": "problem",
                    "kind": "recall",
                }
            )
        if results:
            flashcards.append(
                {
                    "front": f"What is one reported result from '{title}'?",
                    "back": results[0],
                    "paper_id": paper_id,
                    "concept": "result",
                    "kind": "recall",
                }
            )
        if limitations:
            flashcards.append(
                {
                    "front": f"What is one limitation of '{title}'?",
                    "back": limitations[0],
                    "paper_id": paper_id,
                    "concept": "limitation",
                    "kind": "recall",
                }
            )

        # Explain-before-reveal: prompt the learner to reconstruct the idea, then
        # reveal the grounded answer.
        explain_answer = method or _clean_answer(ext.get("contribution")) or problem
        if explain_answer:
            flashcards.append(
                {
                    "front": (
                        f"Explain in your own words how '{title}' approaches its "
                        "problem, then reveal to check."
                    ),
                    "back": explain_answer,
                    "paper_id": paper_id,
                    "concept": "explanation",
                    "kind": "explain",
                }
            )

        # Concept-grounded MCQ: ask about the method itself, not which paper.
        if method and problem:
            other_problems = [
                _clean_answer((q.get("extraction") or {}).get("problem"))
                for q in landscape_papers
                if q is not p
            ]
            distractors = [x for x in other_problems if x and x != problem][:3]
            if len(distractors) >= 2:
                options = [problem, *distractors[:3]]
                quizzes.append(
                    {
                        "question": (
                            f"What problem does the method '{method[:160]}' "
                            "primarily address?"
                        ),
                        "options": options,
                        "correct_index": 0,
                        "explanation": (
                            f"From the extraction for '{title}': "
                            f"the method targets '{problem[:160]}'."
                        ),
                        "paper_id": paper_id,
                        "concept": "method ↔ problem",
                        "difficulty": _clamp_int(ext.get("difficulty_level"), 1, 5, 2),
                    }
                )

    return quizzes[:12], flashcards[:16]


def _clean_answer(value: Any) -> str:
    s = str(value or "").strip()
    if s.lower() in {"", "not reported", "not reported."}:
        return ""
    return s
