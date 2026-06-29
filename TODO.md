# FieldMap — TODO

Backlog of planned work. Keep items concrete and pointed at the code they touch.

## Shipped (PR #4 — branch `claude/spam-topics-fast-fail-bv26pw`)

Done and pushed; tracked here for the record.

- **Spam fast-fail topic guard** — `apps/api/app/services/topic_guard.py`
  rejects off-topic / spam topics (e.g. "gta", "bonnie blue") before any rows
  are created or the pipeline is enqueued; wired into `POST /api/landscapes`.
- **Off-topic landscape cleanup** — `services/landscape_cleanup.py` +
  `scripts/purge_offtopic_landscapes.py` to find and cascade-delete junk
  landscapes that predate the guard.
- **Prod worker internet egress fix** — `docker-compose.prod.yml`: the worker
  was stranded on the internal-only network, so every arXiv search returned
  zero candidates; it's now on the `public` network.
- **Login auth gate** — the UI blocks all entry until login; `POST
  /api/landscapes` requires a token. Seeded admin + demo accounts
  (stdlib PBKDF2 + signed tokens; `services/auth.py`, `api/deps.py`).
- **Admin landscape deletion** — admin-only `DELETE /api/landscapes/{id}` +
  Delete button on the Landscapes page, for cleaning up spam landscapes.

## Shipped (Sprint 1 — `main`)

- **Landscapes page mobile fit** — `apps/web/app/landscapes/page.tsx`
  reworks each row so [status dot + topic/meta] form one row that
  ellipsizes long titles, and the action chips (Papers/Map/Quiz/Cards/
  Delete) drop onto a second line below 768 px via the new
  `fm-landscapes-row` + existing `fm-mobile-stack` / `fm-mobile-wrap`
  helpers. Eliminates horizontal scroll at 360–420 px viewports.
- **Drop paper-attribution quiz questions** — `prompts/quiz.md` rewritten
  to ban "Which paper…" stems and drop the `compare` flashcard kind;
  `services/quiz_generation.py` adds `is_paper_attribution_stem` +
  module-level regex applied in `_sanitize_quizzes` and
  `_sanitize_flashcards`; three deterministic-fallback attribution MCQ
  blocks deleted and replaced with a concept-grounded method↔problem
  MCQ. `GET /api/landscapes/{id}/quiz` and `/flashcards` now filter
  existing rows on read so back-fill is automatic. New unit tests cover
  the regex, sanitizer behaviour, and absence of `compare` flashcards.

## Remaining

### 2. Optimise the relationship map on mobile

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

### 3. Learning pathways — breadth curriculum + depth tracks + exercises

> Big feature, planned in full below. Today FieldMap maps *fields* and produces
> a per-landscape reading plan + quizzes/flashcards. The pathways feature turns
> that into a **guided learning experience**: a breadth-first curriculum across
> LLM topics, depth-first tracks that go deep on one topic (e.g. RAG) through
> many papers, and games/exercises with mastery gating so users actually build
> and retain understanding — not just read.

#### 3.0 Vision & the three pillars

A **pathway** is an ordered list of **stages**; each stage groups a few
**items** (a concept to learn, a paper to read, an exercise to pass) and ends
with a **checkpoint** the learner must clear (by mastery, see 3C) before the
next stage unlocks. Three pillars share that spine:

- **3A — Breadth: the umbrella LLM curriculum.** One global, cross-landscape
  pathway that walks the major LLM topics in a natural progression
  (foundations → transformer architecture → pretraining → fine-tuning/PEFT →
  alignment/RLHF → evaluation → RAG → agents/tool-use → reasoning/test-time
  compute → efficiency/serving → multimodal → safety/interpretability).
  Each topic node links to (or spawns) a landscape for that topic. Optimises
  for **breadth and connective tissue** — "you learned X, which sets up Y".
- **3B — Depth: per-topic deep tracks.** Within a single topic (e.g. RAG), an
  ordered journey through *many* papers (foundational → refinements → SOTA →
  evaluation → open problems), grouped by the landscape's clusters, building
  **deep, expert-level** knowledge of that one area.
- **3C — Mastery: games/exercises + progression.** Expand active recall beyond
  MCQ/flashcard into varied exercises, track per-user mastery, and gate stage
  progression on it. This is what makes a pathway *teach* rather than *list*.

#### 3.1 What already exists (reuse, don't rebuild)

| Need | Existing primitive |
|---|---|
| Ordered papers within a field | `Synthesis.reading_path`, `LandscapePaper.reading_order`, cluster ordinals |
| Prerequisite signal | `Concept.prerequisites`, `PaperRelationship.kind == "prerequisite"`, `Synthesis.prerequisites` |
| Difficulty / importance | `LandscapePaper.category` (must-read…skip), `Concept.importance` |
| Concepts + glossary | `Concept` table, `services/concepts.py`, concept map |
| Active recall items | `Quiz` (MCQ), `Flashcard` (kinds: recall/explain/cloze/compare) |
| Spaced-repetition + scheduling | `services/fsrs.py` (full FSRS), `ReviewState`, `services/review.py` (`submit_review`, `get_queue`, `get_weak_areas`) |
| Deterministic-first generation pattern | `services/synthesis.py` skeleton + LLM augment |

The pathway builders should **layer on these**, staying deterministic-first
(a skeleton pathway is always available; the LLM only enriches ordering
rationale and exercise prose), exactly like synthesis.

#### 3.2 Pillar 3A — Umbrella LLM curriculum (breadth)

**Approach.**
- Introduce a curated **topic graph** as the curriculum backbone: ~12–18 topic
  nodes with prerequisite edges (a DAG), seeded as data (e.g.
  `app/curriculum/llm_curriculum.yaml`) so it's reviewable and versioned, not
  LLM-invented. Each node: `slug`, `title`, `summary`, `prereq_slugs`,
  `default_seed_topic` (the query used to build/refresh its landscape).
- Topological sort → linear "natural progression" with optional branches.
  Each topic node resolves to a landscape (existing one matched by topic, or
  built on demand via the normal pipeline).
- A stage in the breadth pathway = one topic node: read its 2–3 must-reads +
  learn its top concepts + pass a short checkpoint, then the next topic unlocks.

**Open questions to resolve in design review.**
- Curated-vs-generated topic graph (recommend: curated seed, LLM-suggested
  additions reviewed before commit — avoids hallucinated/duplicate topics, cf.
  the topic-guard rationale).
- Does selecting a topic auto-build its landscape, or only when the user starts
  that stage? (recommend: lazy build on stage start to control cost.)
- One global curriculum vs user-clonable/customisable. (recommend: ship the
  global one first; personalisation later.)

#### 3.3 Pillar 3B — Per-topic depth tracks

**Approach.**
- A depth track is generated **from one landscape**, but goes deeper than the
  current reading plan: include `useful` papers (not just `must-read`), order by
  prerequisite edges → cluster ordinal → recency/score, and segment into stages
  by cluster ("Retrieval basics" → "Re-ranking" → "Long-context RAG" →
  "Evaluation" → "Open problems").
- Each stage: read N papers, learn the cluster's key concepts, then a
  cluster-level checkpoint. Stage rationale ("why these, why now, what they
  unlock") is the LLM-augmented part; the ordering/segmentation is deterministic.
- Reuse `PaperRelationship` edges to show "this paper extends / benchmarks /
  contradicts that one" inline, so depth tracks teach the *debate*, not a list.

#### 3.4 Pillar 3C — Games, exercises & mastery (the learning engine)

**New exercise types** (generalise the current `Quiz`/`Flashcard` item model;
each maps to a Bloom level so a stage covers recall → application):
- **Recall MCQ / cloze / flashcard** — already have; keep (remember/understand).
- **Concept→definition & paper→contribution matching** — drag/tap matching game
  (understand). Buildable deterministically from `Concept` + extractions.
- **Sequencing / ordering** — arrange pipeline steps or a method's stages, or
  order papers on a timeline (understand/analyse). Deterministic from
  `reading_order` / `Synthesis.timeline`.
- **"Explain it back"** — free-text reconstruction, self-graded against the
  grounded answer (the existing `explain` flashcard kind, promoted to a
  first-class exercise) (understand/evaluate).
- **Scenario / application** — "given requirement X, which method and why?"
  MCQ grounded in tradeoffs from extractions (apply/analyse).
- **Relationship-graph challenge** — given two papers, pick the correct
  relationship kind (`extends`/`benchmarks`/…) from `PaperRelationship`
  (analyse). Doubles as a game on the map.

**Mastery + progression.**
- Track mastery per `(user, item)` and roll up to **stage mastery** and **topic
  mastery**. Reuse FSRS `ReviewState` for scheduling/retention; add a stage
  checkpoint score.
- **Gate**: a stage's checkpoint must be cleared (e.g. ≥80% + no item in
  "again" state) before the next stage unlocks. `get_weak_areas` already
  surfaces weak concepts → drive targeted review before re-attempting.
- Persist progress so a pathway is resumable; show a progress bar / streak
  (the search page already fakes "trending" sparklines — reuse that visual
  language for real progress).

#### 3.5 Data model (new)

- `Pathway` — `id`, `kind` (`breadth` | `depth`), `title`, `topic_slug`/
  `landscape_id` (null for breadth), `spec` (JSONB: ordered stages → items),
  `version`, timestamps. Deterministic skeleton stored here; resumable.
- `PathwayProgress` — `(user_id, pathway_id, stage_index)`, `status`
  (`locked`/`unlocked`/`in_progress`/`mastered`), `score`, `updated_at`.
- `Exercise` — generalises beyond `Quiz`/`Flashcard`: `id`, `landscape_id`/
  `pathway_id`, `kind` (enum above), `payload` JSONB, `concept`, `bloom_level`,
  `difficulty`. (Could extend `Quiz`/`Flashcard` instead; decide in design — a
  unified `Exercise` table is cleaner long-term but bigger migration.)
- Extend `ITEM_KINDS` in `services/review.py` so new exercises flow through the
  existing FSRS review loop.

#### 3.6 API (sketch)

- `GET /api/curriculum` — the breadth topic graph + the user's progress.
- `POST /api/curriculum/{topic_slug}/start` — resolve/build the topic landscape,
  create/return its stage.
- `GET /api/landscapes/{id}/pathway?kind=depth` — depth track for a landscape
  (deterministic skeleton always; LLM rationale when available).
- `GET /api/pathways/{id}` / `POST /api/pathways/{id}/stages/{i}/checkpoint` —
  fetch a pathway and submit a checkpoint attempt (updates progress + FSRS).
- Exercises ride the existing `/review` endpoints once `ITEM_KINDS` is extended.

#### 3.7 Frontend (sketch)

- `/learn` — curriculum home: the LLM progression as a stepped map with locked/
  unlocked/mastered states and a resume CTA.
- `/landscape/[id]/pathway` — depth track for a field (evolve the current
  `reading-plan/page.tsx`, which already renders stepped `reading_path` with
  done/next/queued — replace its *faked* status with real `PathwayProgress`).
- Exercise player components (matching, sequencing, scenario, explain-back),
  reusing the existing quiz/flashcard review screens and FSRS queue UI.
- Real progress bars/streaks replacing the search page's faked sparklines.

#### 3.8 Pedagogy principles (the bar for "actually teaches")

- **Retrieval practice + spaced repetition** — already have FSRS; make every
  stage end in active retrieval, not passive reading.
- **Mastery learning / prerequisite gating** — don't advance until the current
  stage is mastered; use prerequisite edges so nothing is shown before its
  basis.
- **Interleaving & scaffolding** — breadth pathway interleaves topics; depth
  track scaffolds basics → SOTA. Exercises climb Bloom levels within a stage.
- **Feedback** — every exercise gives a grounded explanation (source-cited where
  possible), reusing extraction grounding.

#### 3.9 Phased delivery

- **Phase 1 (MVP, deterministic):** depth track per landscape (3B) reusing
  `reading_path`/clusters with real stage gating; persist `Pathway` +
  `PathwayProgress`; replace faked reading-plan status. No new exercise types
  yet (use existing quizzes/flashcards as checkpoints).
- **Phase 2 (breadth):** curated LLM curriculum graph (3A), `/learn` home, lazy
  landscape build per topic, cross-topic progression.
- **Phase 3 (exercises/games):** unified `Exercise` model + new exercise types
  (3C), Bloom-leveled stage checkpoints, weak-area-driven targeted review,
  progress/streak UI.

**Done when (per phase).**
- P1: a landscape exposes an ordered, prerequisite-aware **depth** pathway with
  real, resumable per-user progress and stage gating; deterministic fallback
  when the LLM is unavailable.
- P2: `/learn` shows the LLM curriculum; completing one topic's stage unlocks
  the next; topics build their landscapes on demand.
- P3: at least 3 new exercise types are playable, ride the FSRS review loop, and
  a stage cannot be cleared without demonstrated mastery (checkpoint + no item
  left in "again").

### 5. PDF reader: fullscreen mode (mobile + desktop)

**Problem.** The in-page PDF reader (the `pdf` tab on the paper page) is cramped;
there's no way to read a paper fullscreen.

**Goal.** A fullscreen reading mode for the PDF, on both mobile and desktop.

**Where.**
- `apps/web/app/paper/[id]/page.tsx` — the `pdf` tab renders the local PDF blob
  (`localPdfUrl` / `pdfPreviewUrl`).

**Ideas to evaluate.**
- A fullscreen toggle that expands the viewer to the whole viewport (Fullscreen
  API where available, CSS fixed-overlay fallback for iOS Safari which doesn't
  support it on arbitrary elements).
- Keep zoom/scroll working inside fullscreen; provide a clear close affordance
  and Esc-to-exit on desktop.
- Preserve the existing blob-URL preview + cleanup logic when toggling.

**Done when.** A user can open the PDF fullscreen on desktop and mobile, read
and scroll it, and exit back to the paper page cleanly.
