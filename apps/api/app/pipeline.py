"""Canonical pipeline vocabulary — the single source of truth for job stages
and landscape statuses.

Before this module these strings were duplicated across the worker
(``landscape_job.STAGES``), the routes (SSE terminal checks), the models
(defaults), and the frontend (``jobs/[id]/page.tsx`` ``STAGE_DEFS``). They had
already drifted: ``_set_error`` emitted a ``"failed"`` stage that was absent
from the worker's ``STAGES`` list, and ``Landscape.status`` defaulted to
``"pending"`` while the rest of the system used ``queued/running/ready/failed``.

Keep ``apps/web/lib/pipeline.ts`` in sync with the keys/order defined here.
"""

from __future__ import annotations

from enum import Enum


class JobStage(str, Enum):
    """Ordered pipeline stages a ``SearchJob`` moves through, plus ``FAILED``.

    ``str`` mixin means members compare equal to their value
    (``JobStage.DONE == "done"``) and serialize cleanly to JSON.
    """

    QUEUED = "queued"
    SEARCHING = "searching"
    DEDUPLICATING = "deduplicating"
    EMBEDDING_RANKING = "embedding_ranking"
    DOWNLOADING_PDFS = "downloading_pdfs"
    PARSING_PDFS = "parsing_pdfs"
    EXTRACTING = "extracting"
    SYNTHESISING = "synthesising"
    CONCEPTS = "concepts"
    ACTIVE_RECALL = "active_recall"
    DONE = "done"
    # Terminal failure — not part of the ordered progression.
    FAILED = "failed"


class LandscapeStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


# Ordered stages for the progress UI (excludes the out-of-band FAILED).
PIPELINE_STAGES: list[str] = [
    JobStage.QUEUED.value,
    JobStage.SEARCHING.value,
    JobStage.DEDUPLICATING.value,
    JobStage.EMBEDDING_RANKING.value,
    JobStage.DOWNLOADING_PDFS.value,
    JobStage.PARSING_PDFS.value,
    JobStage.EXTRACTING.value,
    JobStage.SYNTHESISING.value,
    JobStage.CONCEPTS.value,
    JobStage.ACTIVE_RECALL.value,
    JobStage.DONE.value,
]

# Stages after which a job will emit no further progress.
TERMINAL_STAGES: frozenset[str] = frozenset({JobStage.DONE.value, JobStage.FAILED.value})

# Human-readable labels (the frontend mirror may localize/override these).
STAGE_LABELS: dict[str, str] = {
    JobStage.QUEUED.value: "Queued",
    JobStage.SEARCHING.value: "Searching papers",
    JobStage.DEDUPLICATING.value: "Deduplicating",
    JobStage.EMBEDDING_RANKING.value: "Embedding & ranking",
    JobStage.DOWNLOADING_PDFS.value: "Downloading PDFs",
    JobStage.PARSING_PDFS.value: "Parsing PDFs",
    JobStage.EXTRACTING.value: "Extracting notes",
    JobStage.SYNTHESISING.value: "Synthesising landscape",
    JobStage.CONCEPTS.value: "Generating concepts",
    JobStage.ACTIVE_RECALL.value: "Quiz & flashcards",
    JobStage.DONE.value: "Complete",
    JobStage.FAILED.value: "Failed",
}
