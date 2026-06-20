"""Per-paper LLM extraction.

Builds a single prompt from extraction.md, sends it to the configured
LLM, validates the response against ``schemas.Extraction``. Returns the
validated dict ready to persist to ``extractions.data``.

If validation fails after the LLM's one retry, we fall back to the
Pydantic defaults (every field "Not reported" / empty) so the rest of
the pipeline keeps moving.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Optional

from pydantic import ValidationError

from app.config import get_settings
from app.schemas import Extraction
from app.services.llm import LLMHTTPError, LLMProvider
from app.services.prompts import render


DEFAULT_MAX_PAPER_TEXT_CHARS = 9000
COMPACT_RETRY_CHARS = 4500


@dataclass
class ExtractionResult:
    data: dict[str, Any]
    error: Optional[str] = None
    degraded: bool = False
    fallback_reason: Optional[str] = None
    diagnostics: dict[str, Any] = field(default_factory=dict)
    retry_used: bool = False


@dataclass
class ExtractionContextChunk:
    chunk_id: str
    section: Optional[str]
    page: Optional[int]
    chunk_ordinal: Optional[int]
    text: str


SECTION_PRIORITY = [
    "abstract",
    "introduction",
    "related work",
    "method",
    "approach",
    "experiments",
    "results",
    "limitations",
    "discussion",
    "conclusion",
]

COMPACT_SECTION_PRIORITY = [
    "abstract",
    "introduction",
    "method",
    "approach",
    "experiments",
    "results",
    "limitations",
    "conclusion",
]

_DROP_SECTION_RE = re.compile(
    r"\b(references|bibliography|appendix|appendices|supplementary|acknowledg(e)?ments)\b",
    re.IGNORECASE,
)
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", re.MULTILINE)
GROUNDING_FIELDS = [
    "problem",
    "motivation",
    "research_question",
    "method",
    "contribution",
    "novelty",
    "results",
    "limitations",
    "assumptions",
    "datasets",
    "benchmarks",
    "baselines",
    "metrics",
    "implementation_details",
    "mathematical_ideas",
    "open_questions",
]


async def extract_paper(
    llm: LLMProvider,
    *,
    paper_id: Optional[str] = None,
    title: str,
    abstract: Optional[str],
    authors: list[str],
    year: Optional[int],
    venue: Optional[str],
    paper_text: Optional[str],
    sections: Optional[list[tuple[Optional[str], str]]] = None,
    chunks: Optional[list[dict[str, Any]]] = None,
) -> ExtractionResult:
    """Return validated extraction data plus reliability metadata."""
    max_chars = max(2500, int(get_settings().max_paper_text_chars or DEFAULT_MAX_PAPER_TEXT_CHARS))
    messages = _build_messages(
        title=title,
        abstract=abstract,
        authors=authors,
        year=year,
        venue=venue,
        paper_text=paper_text,
        sections=sections,
        chunks=chunks,
        max_chars=max_chars,
        compact=False,
    )
    context_chunks = select_extraction_chunks(
        paper_text=paper_text,
        sections=sections,
        chunks=chunks,
        max_chars=max_chars,
        compact=False,
    )

    raw: dict[str, Any]
    diagnostics: dict[str, Any] = {
        "request_character_count": _message_char_count(messages),
        "approximate_prompt_tokens": max(1, _message_char_count(messages) // 4),
        "context_mode": "prioritised_sections",
        "max_paper_text_chars": max_chars,
        "chunks_supplied": len(context_chunks),
    }

    try:
        raw = await llm.complete_json(
            messages,
            stage="extraction",
            paper_id=paper_id,
            paper_title=title,
        )
    except LLMHTTPError as e:
        diagnostics.update(e.diagnostic_dict())
        if e.status_code == 400:
            retry_messages = _build_messages(
                title=title,
                abstract=abstract,
                authors=authors,
                year=year,
                venue=venue,
                paper_text=paper_text,
                sections=sections,
                chunks=chunks,
                max_chars=min(COMPACT_RETRY_CHARS, max_chars),
                compact=True,
            )
            retry_context_chunks = select_extraction_chunks(
                paper_text=paper_text,
                sections=sections,
                chunks=chunks,
                max_chars=min(COMPACT_RETRY_CHARS, max_chars),
                compact=True,
            )
            diagnostics["retry_request_character_count"] = _message_char_count(retry_messages)
            diagnostics["retry_approximate_prompt_tokens"] = max(1, _message_char_count(retry_messages) // 4)
            diagnostics["retry_context_mode"] = "compact_key_sections"
            diagnostics["retry_chunks_supplied"] = len(retry_context_chunks)
            try:
                raw = await llm.complete_json(
                    retry_messages,
                    stage="extraction_retry_compact",
                    paper_id=paper_id,
                    paper_title=title,
                )
                result = _validate_extraction(raw, retry_context_chunks)
                result.retry_used = True
                result.diagnostics.update(diagnostics)
                return result
            except Exception as retry_e:  # noqa: BLE001
                diagnostics["retry_error"] = _safe_error(retry_e)
                return _degraded_result(
                    "llm_400_compact_retry_failed",
                    f"llm failure: {_safe_error(retry_e)}",
                    diagnostics,
                    retry_used=True,
                )
        return _degraded_result("llm_http_failure", f"llm failure: {e!s}", diagnostics)
    except Exception as e:  # noqa: BLE001
        diagnostics["error"] = _safe_error(e)
        return _degraded_result("llm_failure", f"llm failure: {_safe_error(e)}", diagnostics)

    result = _validate_extraction(raw, context_chunks)
    result.diagnostics.update(diagnostics)
    return result


def select_extraction_context(
    *,
    paper_text: Optional[str],
    sections: Optional[list[tuple[Optional[str], str]]] = None,
    max_chars: int = DEFAULT_MAX_PAPER_TEXT_CHARS,
    compact: bool = False,
) -> str:
    """Select useful sections for extraction without references/appendices."""
    context_chunks = select_extraction_chunks(
        paper_text=paper_text,
        sections=sections,
        max_chars=max_chars,
        compact=compact,
    )
    return _format_context_chunks(context_chunks)


def select_extraction_chunks(
    *,
    paper_text: Optional[str],
    sections: Optional[list[tuple[Optional[str], str]]] = None,
    chunks: Optional[list[dict[str, Any]]] = None,
    max_chars: int = DEFAULT_MAX_PAPER_TEXT_CHARS,
    compact: bool = False,
) -> list[ExtractionContextChunk]:
    """Select useful chunk records and preserve grounding metadata."""
    max_chars = max(1000, int(max_chars))
    priority = COMPACT_SECTION_PRIORITY if compact else SECTION_PRIORITY

    chunk_rows: list[ExtractionContextChunk] = []
    for i, chunk in enumerate(chunks or []):
        text = _clean_text(str(chunk.get("text") or chunk.get("content") or ""))
        section = chunk.get("section") or chunk.get("section_heading")
        if not text or _is_drop_heading(section):
            continue
        chunk_rows.append(
            ExtractionContextChunk(
                chunk_id=str(chunk.get("chunk_id") or chunk.get("id") or f"chunk-{i}"),
                section=str(section).strip() if section else None,
                page=chunk.get("page") or chunk.get("page_start"),
                chunk_ordinal=chunk.get("chunk_ordinal") if chunk.get("chunk_ordinal") is not None else chunk.get("ordinal"),
                text=text,
            )
        )
    if chunk_rows:
        ranked_chunks = sorted(
            chunk_rows,
            key=lambda c: (_section_rank(c.section, priority), c.chunk_ordinal if c.chunk_ordinal is not None else 999999),
        )
        useful = [c for c in ranked_chunks if _section_rank(c.section, priority) < 100] or ranked_chunks
        return _budget_context_chunks(useful, max_chars)

    cleaned_sections = [
        (heading, _clean_text(content))
        for heading, content in (sections or [])
        if content and not _is_drop_heading(heading)
    ]
    labelled = [(h, c) for h, c in cleaned_sections if (h or "").strip()]

    if labelled:
        ranked = sorted(
            labelled,
            key=lambda item: (_section_rank(item[0], priority), len(item[1]) * -1),
        )
        useful = [(h, c) for h, c in ranked if _section_rank(h, priority) < 100]
        if not useful:
            useful = ranked
        synthetic = [
            ExtractionContextChunk(
                chunk_id=f"section-{i}",
                section=h,
                page=None,
                chunk_ordinal=i,
                text=c,
            )
            for i, (h, c) in enumerate(useful)
        ]
        return _budget_context_chunks(synthetic, max_chars)

    text = strip_references_and_appendices(paper_text or "")
    if not text.strip():
        return []
    return [
        ExtractionContextChunk(
            chunk_id="paper-text-0",
            section="Body",
            page=None,
            chunk_ordinal=0,
            text=_clean_text(text)[:max_chars].strip(),
        )
    ]


def strip_references_and_appendices(text: str) -> str:
    """Remove trailing references/appendix material from raw parsed markdown."""
    if not text:
        return ""
    matches = list(_HEADING_RE.finditer(text))
    for match in matches:
        heading = match.group(1)
        if _is_drop_heading(heading):
            return text[: match.start()].strip()
    lines: list[str] = []
    for line in text.splitlines():
        if _is_drop_heading(line):
            break
        lines.append(line)
    return "\n".join(lines).strip()


def _build_messages(
    *,
    title: str,
    abstract: Optional[str],
    authors: list[str],
    year: Optional[int],
    venue: Optional[str],
    paper_text: Optional[str],
    sections: Optional[list[tuple[Optional[str], str]]],
    chunks: Optional[list[dict[str, Any]]],
    max_chars: int,
    compact: bool,
) -> list[dict[str, str]]:
    context_chunks = select_extraction_chunks(
        paper_text=paper_text,
        sections=sections,
        chunks=chunks,
        max_chars=max_chars,
        compact=compact,
    )
    selected_text = _format_context_chunks(context_chunks)
    user_prompt = render(
        "extraction",
        title=title or "",
        authors=", ".join(authors or []),
        year=str(year or ""),
        venue=venue or "",
        abstract=(abstract or "").strip() or "Not reported",
        paper_text=selected_text or "(no parsed paper text available — use title + abstract only)",
    )
    return [
        {"role": "system", "content": "You are a careful ML/AI research assistant. Output valid JSON only."},
        {"role": "user", "content": user_prompt},
    ]


def _budget_context_chunks(chunks: list[ExtractionContextChunk], max_chars: int) -> list[ExtractionContextChunk]:
    out: list[ExtractionContextChunk] = []
    remaining = max_chars
    remaining_chunks = len(chunks)
    for chunk in chunks:
        if remaining <= 0:
            break
        remaining_chunks = max(1, remaining_chunks)
        meta_len = len(chunk.chunk_id) + len(chunk.section or "") + 80
        body_budget = max(200, (remaining // remaining_chunks) - meta_len)
        text = chunk.text[:body_budget].strip()
        if not text:
            remaining_chunks -= 1
            continue
        out.append(
            ExtractionContextChunk(
                chunk_id=chunk.chunk_id,
                section=chunk.section,
                page=chunk.page,
                chunk_ordinal=chunk.chunk_ordinal,
                text=text,
            )
        )
        remaining -= len(text) + meta_len
        remaining_chunks -= 1
    return out


def _format_context_chunks(chunks: list[ExtractionContextChunk]) -> str:
    blocks: list[str] = []
    for chunk in chunks:
        page = str(chunk.page) if chunk.page is not None else "unknown"
        section = chunk.section or "Unknown"
        ordinal = "" if chunk.chunk_ordinal is None else str(chunk.chunk_ordinal)
        blocks.append(
            "\n".join(
                [
                    f"[chunk_id: {chunk.chunk_id}]",
                    f"section: {section}",
                    f"page: {page}",
                    f"chunk_ordinal: {ordinal}",
                    "text:",
                    chunk.text,
                ]
            )
        )
    return "\n\n---\n\n".join(blocks)


def _validate_extraction(raw: dict[str, Any], context_chunks: Optional[list[ExtractionContextChunk]] = None) -> ExtractionResult:
    try:
        validated = Extraction.model_validate(raw)
        data, grounding_diag = validate_grounding(validated.model_dump(), context_chunks or [])
        degraded = grounding_diag["ungrounded_fields"] > grounding_diag["grounded_fields"] and grounding_diag["claim_fields"] > 0
        return ExtractionResult(
            data=_with_quality_meta(
                data,
                degraded=degraded,
                fallback_reason="weak_grounding" if degraded else None,
                grounding=grounding_diag,
            ),
            degraded=degraded,
            fallback_reason="weak_grounding" if degraded else None,
            diagnostics=grounding_diag,
        )
    except ValidationError as e:
        salvage: dict[str, Any] = Extraction().model_dump()
        for k, v in raw.items():
            if k in salvage:
                salvage[k] = v
        try:
            validated = Extraction.model_validate(salvage)
            data, grounding_diag = validate_grounding(validated.model_dump(), context_chunks or [])
            return ExtractionResult(
                data=_with_quality_meta(data, degraded=True, fallback_reason="partial_validation", grounding=grounding_diag),
                error=f"partial validation: {e.errors()[:3]}",
                degraded=True,
                fallback_reason="partial_validation",
                diagnostics=grounding_diag,
            )
        except ValidationError:
            return _degraded_result("validation_failed", f"validation failed: {e.errors()[:3]}", {})


def _degraded_result(
    fallback_reason: str,
    error: str,
    diagnostics: dict[str, Any],
    *,
    retry_used: bool = False,
) -> ExtractionResult:
    data = _with_quality_meta(Extraction().model_dump(), degraded=True, fallback_reason=fallback_reason)
    return ExtractionResult(
        data=data,
        error=error,
        degraded=True,
        fallback_reason=fallback_reason,
        diagnostics=diagnostics,
        retry_used=retry_used,
    )


def _with_quality_meta(
    data: dict[str, Any],
    *,
    degraded: bool,
    fallback_reason: Optional[str] = None,
    grounding: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    data = dict(data)
    data["_fieldmap"] = {
        "degraded": degraded,
        "fallback_reason": fallback_reason,
        "grounding": grounding or {
            "grounded_fields": 0,
            "ungrounded_fields": 0,
            "claim_fields": 0,
            "invalid_groundings": 0,
            "average_grounding_confidence": 0.0,
        },
    }
    return data


def validate_grounding(
    data: dict[str, Any],
    context_chunks: list[ExtractionContextChunk],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate structured grounding against supplied context chunks."""
    chunk_by_id = {c.chunk_id: c for c in context_chunks}
    raw_groundings = data.get("source_grounding") or []
    valid_groundings: list[dict[str, Any]] = []
    invalid_count = 0
    confidence_sum = 0.0

    for item in raw_groundings:
        grounding = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        field_name = str(grounding.get("field") or "").strip()
        if not field_name:
            invalid_count += 1
            continue
        chunk_id = grounding.get("chunk_id")
        chunk = chunk_by_id.get(str(chunk_id)) if chunk_id else None
        if chunk_id and chunk is None:
            invalid_count += 1
            continue
        quote = _clean_quote(grounding.get("quote"))
        if quote and chunk and not _quote_supported_by_chunk(quote, chunk.text):
            invalid_count += 1
            grounding["confidence"] = min(float(grounding.get("confidence") or 0.0), 0.35)
        grounding["quote"] = quote
        if chunk:
            grounding["section"] = grounding.get("section") or chunk.section
            grounding["page"] = grounding.get("page") if grounding.get("page") is not None else chunk.page
            grounding["chunk_ordinal"] = (
                grounding.get("chunk_ordinal")
                if grounding.get("chunk_ordinal") is not None
                else chunk.chunk_ordinal
            )
        grounding["confidence"] = max(0.0, min(1.0, float(grounding.get("confidence") or 0.0)))
        confidence_sum += grounding["confidence"]
        valid_groundings.append(grounding)

    data = dict(data)
    data["source_grounding"] = valid_groundings

    grounded_fields = {g["field"] for g in valid_groundings if g.get("confidence", 0) > 0}
    claim_fields = [field_name for field_name in GROUNDING_FIELDS if _field_has_claim(data.get(field_name))]
    ungrounded = [field_name for field_name in claim_fields if field_name not in grounded_fields]
    if ungrounded:
        data["confidence"] = min(float(data.get("confidence") or 0.0), 0.45)

    return data, {
        "grounded_fields": len([f for f in claim_fields if f in grounded_fields]),
        "ungrounded_fields": len(ungrounded),
        "ungrounded_field_names": ungrounded,
        "claim_fields": len(claim_fields),
        "invalid_groundings": invalid_count,
        "average_grounding_confidence": round(confidence_sum / max(1, len(valid_groundings)), 3),
    }


def _field_has_claim(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in {"", "not reported", "not reported."}
    if isinstance(value, list):
        return any(_field_has_claim(item) for item in value)
    return False


def _clean_quote(value: Any) -> Optional[str]:
    if value is None:
        return None
    quote = " ".join(str(value).split())
    return quote[:500] if quote else None


def _quote_supported_by_chunk(quote: str, chunk_text: str) -> bool:
    q = _normalize_for_match(quote)
    c = _normalize_for_match(chunk_text)
    if not q:
        return False
    if q in c:
        return True
    if len(q) < 30:
        return False
    return SequenceMatcher(None, q, c).quick_ratio() > 0.62


def _normalize_for_match(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())).strip()


def _section_rank(heading: Optional[str], priority: list[str]) -> int:
    norm = _normalize_heading(heading)
    for i, wanted in enumerate(priority):
        if wanted in norm:
            return i
    return 100


def _join_sections(sections: list[tuple[Optional[str], str]], max_chars: int) -> str:
    chunks: list[str] = []
    remaining = max_chars
    remaining_sections = len(sections)
    for heading, content in sections:
        if remaining <= 0:
            break
        remaining_sections = max(1, remaining_sections)
        header = f"\n\n## {heading.strip()}\n" if (heading or "").strip() else "\n\n"
        body_budget = max(0, (remaining // remaining_sections) - len(header))
        if body_budget <= 0:
            break
        body = content[:body_budget].strip()
        if not body:
            remaining_sections -= 1
            continue
        chunk = f"{header}{body}"
        chunks.append(chunk)
        remaining -= len(chunk)
        remaining_sections -= 1
    text = "".join(chunks).strip()
    if remaining <= 0:
        text += "\n\n[... truncated for length ...]"
    return text


def _is_drop_heading(heading: Optional[str]) -> bool:
    return bool(_DROP_SECTION_RE.search(_normalize_heading(heading)))


def _normalize_heading(heading: Optional[str]) -> str:
    h = (heading or "").strip().lower()
    h = re.sub(r"^\s*(\d+(\.\d+)*|[ivxlcdm]+)\s*[\).\:-]?\s+", "", h)
    h = h.strip("#*:_-. ")
    return h


def _clean_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", (text or "").strip())


def _message_char_count(messages: list[dict[str, str]]) -> int:
    return sum(len(m.get("content") or "") for m in messages)


def _safe_error(e: BaseException) -> str:
    if isinstance(e, LLMHTTPError):
        return str(e)
    return f"{type(e).__name__}: {str(e)[:240]}"
