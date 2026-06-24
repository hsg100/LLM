# FieldMap — TODO

Backlog of planned work. Keep items concrete and pointed at the code they touch.

## 1. Drop "which paper uses this method" style questions

**Problem.** Quiz generation produces paper-attribution MCQs — e.g. *"Which
paper uses this method / introduced this contribution?"*. These test rote
source-attribution rather than understanding and feel like trivia.

**Goal.** Stop generating them; keep concept-understanding MCQs and flashcards.

**Where.**
- `apps/api/app/prompts/quiz.md` — remove the instruction to *"Include some
  **paper-comparison** questions (which paper a given method/contribution/
  limitation belongs to)"*, and reconsider the `compare` flashcard kind
  ("contrast two papers") if it produces the same attribution feel.
- `apps/api/app/services/quiz_generation.py` — add a sanitization filter so any
  generated item that is paper-attribution shaped is dropped even if the model
  emits one anyway (e.g. drop MCQs whose stem matches "which paper" /
  "what paper" / "which of these papers"). Belt-and-braces with the prompt
  change.
- Backfill: existing landscapes already have these quizzes persisted — decide
  whether to regenerate or filter on read (`GET /api/landscapes/{id}/quiz`).

**Done when.** New landscapes generate no paper-attribution questions, and a
test asserts the filter rejects a "Which paper uses ...?" stem.

## 2. Optimise the relationship map on mobile

**Problem.** The paper relationship graph is hard to use on small screens.

**Goal.** A relationship map that is legible and interactive on mobile.

**Where.**
- `apps/web/components/graph/RelationshipGraph.tsx` — the renderer.
- `apps/web/app/landscape/[id]/map/page.tsx` — the page wrapper.

**Ideas to evaluate.**
- Responsive sizing / viewport-aware layout instead of a fixed canvas.
- Touch gestures: pinch-zoom, pan, tap-to-focus a node and its edges.
- Reduce density on mobile (collapse to top-N nodes / cluster-level view, with
  drill-in) so labels don't overlap.
- Larger touch targets and a legend that doesn't occlude the graph.

**Done when.** The map is usable on a phone viewport (≤ 420px) without
horizontal scroll or overlapping unreadable labels.

## 3. Recommended learning pathway based on research

**Problem.** We have a reading plan, but not a guided, ordered learning pathway
derived from the field's structure (prerequisites, clusters, difficulty).

**Goal.** Generate a recommended pathway: an ordered sequence of papers/concepts
to learn the field, grounded in the synthesised research (prereq edges, cluster
ordering, must-read bucketing).

**Where.**
- Inputs already exist: `LandscapePaper.reading_order`, cluster ordinals,
  `PaperRelationship` of kind `prerequisite`, concept `prerequisites`, and the
  deterministic skeleton in `apps/api/app/services/synthesis.py`.
- Likely a new pathway builder service + an API endpoint, surfaced near
  `apps/web/app/landscape/[id]/reading-plan/page.tsx`.

**Ideas to evaluate.**
- Topologically order concepts/papers by prerequisite edges, then by cluster
  and must-read bucket within a level.
- Annotate each step with *why it's next* and what it unlocks.
- Keep it deterministic-first (skeleton pathway always available), LLM-augmented
  for rationale, consistent with the rest of the pipeline.

**Done when.** A landscape exposes an ordered, prerequisite-aware pathway in the
UI, with a deterministic fallback when the LLM is unavailable.
