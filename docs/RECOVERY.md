# FieldMap — Full-Scale Recovery Specification

> **Status:** DRAFT — working document. We refine this feature by feature.
> **Companion to:** [`VISION.md`](./VISION.md) (the north star / intended product).
> **Scope agreed:** recovery + targeted re-architecture + optimization. We may
> recommend real refactors, not just patches, where the current design blocks
> the vision.
> **Method agreed:** code-audit-first. Every problem below cites `file:line`
> from the current tree so claims are checkable.

---

## 0. How to read this document

This is the recovery plan to take FieldMap from "too many features built too
fast, buggy and suboptimal" to "coherent, working, optimal — and faithful to
the vision."

It is organized in three layers:

1. **Current-state assessment** — what works, what's fragile, what's missing.
2. **Cross-cutting recovery** (§2) — architectural problems that touch many
   features. These are sequenced *first* because most per-feature work depends
   on them.
3. **Feature-by-feature recovery** (§3) — one section per feature in the
   product loop. Each section uses a fixed template:
   - **Current state** — what exists today.
   - **Problems found** — concrete, tagged, with `file:line`.
   - **Target (optimal) state** — what "recovered" means for this feature.
   - **Recovery actions** — the work.
   - **Interactions** — the seams with other features (the part the vision
     calls out as equally important).
   - **Decisions needed** — what we must agree before building.

**Severity tags used throughout:**

| Tag | Meaning |
|-----|---------|
| 🐞 **Bug** | Incorrect behaviour / latent failure. |
| ⚠️ **Suboptimal** | Works, but quality/perf/maintainability is poor. |
| 🎯 **Vision-gap** | Diverges from or omits something `VISION.md` promises. |
| 🏗 **Re-arch** | Structural change; affects multiple features. |
| 💀 **Dead code** | Built then orphaned; remove or revive. |

---

## 1. Current-state assessment

FieldMap is **not** a skeleton. The entire vision loop is scaffolded and the
backend pipeline runs end-to-end (with a deterministic stub when no API keys
are present). The problem is the opposite of "unfinished": breadth was built
faster than depth and coherence, so several features are shallow, several
interactions are fragile, and the system leans heavily on stub/degraded
fallbacks that mask whether the *real* paths work.

### 1.1 What is genuinely solid (protect during recovery)

- **Per-paper extraction + source grounding** — `app/services/extraction.py`.
  Real chunk-level grounding: quotes are validated against the supplied chunk
  text (`_quote_supported_by_chunk`, extraction.py:548), confidence is
  down-weighted when unsupported, and "Not reported" is respected. This is the
  vision's "trustworthiness" principle, actually implemented.
- **Obsidian Git exporter** — `app/exporters/obsidian_git.py` (891 lines).
  Content-hash idempotency, dry-run preview (`preview_plan`), ahead/behind
  reporting, path-traversal guards, frontmatter, concept/paper/landscape/quiz
  notes, PDF copy. Matches the vision's "deterministic, Git-backed" model.
- **Concept layer engine** — `app/services/concepts.py` +
  `components/concepts/ConceptText.tsx`. Candidate harvesting, LLM definitions
  with deterministic fallback, markdown-safe inline highlighting, Obsidian
  `[[wikilink]]` rendering.
- **PDF acquisition resilience** — `app/parsers/pdf_parser.py` +
  `workers/landscape_job.py:_download_and_parse`. Streamed size-capped
  downloads, caching, bounded concurrency, per-paper failure isolation.
- **Provider error transparency** — `LLMHTTPError` (llm.py:31) carries
  structured diagnostics into job events. Good operability.
- **Unit tests** exist for concepts, embeddings, extraction, grounding/export,
  PDF support, quiz fallback, relationships, and API contract shapes.

### 1.2 What is fragile or shallow

- The **pipeline orchestration** writes progress by re-reading and rewriting a
  growing JSONB blob on every event, from concurrent tasks (§2.2). Correctness
  and scaling risk.
- **Discovery is arXiv-only** despite config for Semantic Scholar / OpenAlex,
  so citation/influence ranking signals are effectively dead (§3.2, §3.3).
- **Field structure, reading rationales, and the relationship graph are
  templated/heuristic**, so every landscape looks structurally similar and the
  "why read this" reasoning is a metrics dump, not pedagogy (§3.3, §3.6, §3.7).
- **Active recall is display-only** — no answer recording, no scheduling, no
  weak-area review, despite a `ReviewAttempt` table existing (§3.9).
- **No migrations**; schema evolves via `create_all` + hand-written idempotent
  `ALTER TABLE` patches (§2.1).

### 1.3 What is missing vs. the vision

- Local/free embeddings (bge / MiniLM) — vision's *default*; not implemented (§3.3, §2.4).
- Semantic Scholar, OpenAlex, Crossref, GitHub, user-PDF, Obsidian-notes sources (§3.2).
- Spaced repetition / FSRS, weak-area review, daily queue (§3.9).
- Page-level grounding, figure/table extraction (§3.4, §3.5).
- Multi-user / auth (the `User` model exists but is never used) (§2.6).
- Runtime-editable settings (PATCH is a no-op) (§3.13).

---

## 2. Cross-cutting recovery (do these first)

These are the load-bearing fixes. Most per-feature improvements assume them.

### 2.1 🏗 Database schema & migrations

**Problem.** There is no migration framework. `db.py:init_db()` calls
`SQLModel.metadata.create_all` and then runs hand-maintained idempotent DDL:
`_ensure_chunk_metadata_columns` (db.py:132) and `_ensure_concept_columns`
(db.py:148), including data backfills (`UPDATE concepts SET slug = …`). This is
migration-by-accretion: it cannot drop/rename columns, has no version history,
no down-migrations, and silently diverges between fresh and existing DBs.

**Target.** Alembic-managed migrations. `create_all` + ad-hoc `ALTER` removed
from the hot startup path. A single source of truth for schema; reproducible
on a clean DB and on existing alpha DBs.

**Actions.**
- Introduce Alembic; generate an initial migration from current models.
- Convert the two `_ensure_*` patch sets into real migrations; delete them
  from `init_db`.
- Keep the pgvector dimension guard (`_validate_vector_columns`, db.py:101) but
  move it behind migrations (changing `EMBEDDING_DIM` must become a migration,
  not a runtime assertion — see §2.4).

**Decisions needed.** Alembic vs. a lighter approach? Are there existing
deployed DBs we must migrate in place, or can the alpha DB be recreated?

---

### 2.2 🏗🐞 Job orchestration, progress events & SSE

**Problem.** Job progress is stored as a JSONB list on `SearchJob.events`
(models.py:74). Every `_set_stage` / `_append_event`
(landscape_job.py:1098–1132) opens a session, reads the **entire** events list,
appends one item, and rewrites the whole column.

- 🐞 **Lost updates under concurrency.** Download, parse, and extraction emit
  events from `asyncio.gather` tasks (e.g. landscape_job.py:871). Concurrent
  read-modify-write on the same JSONB column has no locking → events clobber
  each other and `progress` can go backwards.
- ⚠️ **O(n²) writes.** With 50 papers each emitting multiple per-paper events,
  the events blob is rewritten hundreds of times, each time serializing the
  whole growing list.
- ⚠️ **SSE polls the DB every 1s** (routes.py:347) re-fetching the job each
  loop, with no heartbeat and no idle/stall timeout.

**Target.** An append-only event store and a push-based stream.

**Actions.**
- Move events to a dedicated append-only `job_events` table (one row per
  event), or to Redis Streams. Single-row inserts remove the read-modify-write
  race and the O(n²) rewrite.
- Have the worker publish progress to Redis pub/sub; SSE subscribes instead of
  polling (keep a slow DB poll as fallback). Add SSE heartbeat + stall timeout.
- Define the canonical stage enum once (it's duplicated: `STAGES` in
  landscape_job.py:71 vs. the `"failed"` stage emitted by `_set_error`
  (landscape_job.py:1153) which isn't in `STAGES`, vs. `landscape.status`
  values `queued/running/ready/failed`). Unify and share with the frontend.

**Interactions.** Touches Jobs/Progress UI (§3.11) and every pipeline stage.

**Decisions needed.** Redis Streams vs. a relational `job_events` table? (Redis
is already a dependency; a table is simpler to query/replay. Recommend table +
pub/sub for live push.)

---

### 2.3 ⚠️ N+1 query patterns

**Problem.** Per-link `s.get(Paper, …)` loops appear in `get_landscape_papers`
(routes.py:127), `get_landscape_graph` (routes.py:203), `_build_export_plan`
(routes.py:520), `_load_landscape_bundle` (landscape_job.py:937),
`_load_landscape_paper_meta` (landscape_job.py:476), and `_persist_synthesis`
re-queries each link individually (landscape_job.py:997–1030).

**Target.** Batched joins / `WHERE id IN (...)` and single round-trips.

**Actions.** Replace per-row `get` loops with joined selects; in
`_persist_synthesis`, load all links once into a dict keyed by `paper_id`.

**Decisions needed.** None — straightforward; sequence after §2.2.

---

### 2.4 🎯🏗 Provider strategy: LLM + embeddings

**Problem.**
- 🎯 LLM defaults are `llm_provider="openai"`, `gpt-4o` / `gpt-4o-mini`
  (config.py:20–22). The vision says default to the latest Claude models. An
  `AnthropicLLM` provider exists (llm.py:185) but isn't the default and uses a
  pinned `anthropic-version: 2023-06-01` header.
- 🎯 **No local embeddings.** Vision's cost-free default is
  `bge-small-en-v1.5` / `all-MiniLM-L6-v2`. Only `openai` + `stub` exist
  (embeddings.py:137). The default is `stub` (hash-based, not semantic), so the
  out-of-the-box ranking/clustering quality is poor.
- ⚠️ **Stub coupling.** `StubLLM` matches prompts by sniffing substrings
  (`_stub_response`, llm.py:341). If a prompt's wording changes, the stub
  silently returns `{"stub": true, "note": "no shape matched"}`.

**Target.** Anthropic (Claude) as the recommended/default LLM; a real local
embedding provider as the default cost-free path; stub demoted to an explicit
"demo mode," not the silent default.

**Actions.**
- **Decided:** default LLM provider → `deepseek` (the `DeepSeekLLM` provider
  already exists, so this is config, not new code). Tiering: **DeepSeek V4 Pro**
  for hard reasoning (extraction, synthesis, relationships, concept
  definitions); a cheaper DeepSeek model for simpler generation (quiz/flashcards,
  short rationales). *Confirm exact model IDs (e.g. `deepseek-chat` /
  `deepseek-reasoner` / the V4 Pro identifier) and pricing at build time.*
- Add a `local`/`sentence-transformers` embedding provider (bge-small = 384-d,
  MiniLM = 384-d). Make it the default; set `EMBEDDING_DIM` accordingly. This
  interacts with §2.1 (pgvector column width is fixed → dimension change is a
  migration).
- Replace prompt-sniffing stub with an explicit demo provider keyed off
  `stage`, or gate stub behind `ENV=development` only.

**Interactions.** Ranking (§3.3), synthesis/concepts/quiz quality (§3.6/§3.8/§3.9),
DB schema (§2.1, vector dims), Settings (§3.13).

**Decisions needed.**
- Confirm Claude as default and the exact model tier mapping (cost vs. quality).
- Local embeddings on the VPS (CPU) acceptable for latency, or keep an API
  embedding option as default? Recommend local-default + optional API.

---

### 2.5 💀 Dead / duplicated code to remove or consolidate

- 💀 `components/ui/PhoneFrame.tsx` — defined, **never imported**. It's the
  abandoned "fake phone mockup" the vision explicitly rejects. Delete.
- 💀 `lib/useViewport.ts:useIsMobile` — defined, never used. The app is
  CSS-responsive (Tailwind `md:`), which is correct; remove the unused hook or
  adopt it intentionally.
- 💀 `extraction.py:_join_sections` (line 572) — superseded by chunk-based
  selection; unused.
- ⚠️ **Duplicated chunking.** `pdf_parser._chunk_markdown` (returns `list[str]`)
  vs. worker `_chunk_text_with_ranges` (returns ranges, landscape_job.py:721).
  The parser's `chunks` field is computed and then ignored by the worker.
  Consolidate on the range-aware version; stop computing the unused one.
- ⚠️ **Duplicated concept annotation.** `concepts.annotate_text` (Python) and
  `ConceptText.annotate` (TS) are parallel reimplementations that must be kept
  in sync. Decide one owner (see §3.8).

**Decisions needed.** For concept annotation: server-rendered segments (single
source of truth, an extra request) vs. keep client-side (zero latency, drift
risk). Recommend a shared contract + server endpoint, client as progressive
enhancement.

---

### 2.6 🎯 Auth & multi-user

**Problem.** `User` model exists (models.py:37) and `Landscape.user_id` is
nullable, but nothing sets or filters by it. All landscapes are global. The
vision ("personal research OS," progress tracking, "what the user has read")
implies per-user data.

**Target.** Decide v1 posture: single-user personal instance (no auth, simplest)
vs. multi-user (auth + per-user scoping everywhere).

**Decisions needed.** This is a genuine fork in the road — answer early, it
shapes routes, queries, and export paths. Recommend: single-user for the
recovery milestone, with `user_id` plumbed through so multi-user is additive
later.

---

## 3. Feature-by-feature recovery

### 3.1 Topic intake & landscape creation

**Current state.** `POST /api/landscapes` (routes.py:78) creates a `Landscape`
+ `SearchJob` and enqueues `run_landscape_job`. Frontend entry at
`app/search/page.tsx`.

**Problems found.**
- ⚠️ If `enqueue` fails, the landscape + job rows were already `flush`ed; the
  raised `HTTPException` (routes.py:101) rolls back the transaction, so they
  don't persist — acceptable, but the flow is implicit. Verify it under a real
  Redis outage.
- 🎯 No validation/normalization of the topic beyond length (schemas.py:20),
  and no de-duplication against existing landscapes for the same topic.

**Target.** Robust creation: enqueue failure surfaces cleanly; optional
"existing landscape for this topic?" prompt; topic normalization feeds ranking.

**Recovery actions.** Confirm rollback behaviour with a test; add topic
normalization; consider returning existing landscape on duplicate topic.

**Interactions.** Jobs (§3.11), Discovery (§3.2).

**Decisions needed.** Should re-running a topic update the existing landscape
or always create a new one?

---

### 3.2 Paper discovery (sources)

**Current state.** `ArxivSource` (paper_sources/arxiv.py) + `StubSource`. Source
registry in `paper_sources/__init__.py`. arXiv search never raises; failures
become `SearchOutcome` diagnostics.

**Problems found.**
- 🎯 **arXiv-only.** Config has `semantic_scholar_api_key` and `openalex_email`
  (config.py:17–18) but **no** Semantic Scholar / OpenAlex / Crossref sources
  exist. Vision lists all of these + GitHub + user PDFs + Obsidian notes.
- 🐞 **Citation signal is dead.** arXiv candidates never set `citation_count`,
  so ranking's citation component (§3.3) is always the default 0.3. The one
  field that needs Semantic Scholar/OpenAlex isn't fed by the only real source.
- ⚠️ Unknown sources are silently skipped (landscape_job.py:120) — fine, but
  the default `sources: ["arxiv"]` means the others are never exercised.

**Target.** Multi-source discovery with real influence signals; user-uploaded
PDFs as a first-class source; dedup across sources by DOI/arXiv-id/title.

**Recovery actions.**
- Implement `SemanticScholarSource` (citations, references, influential-citation
  count, `isOpenAccess` PDF) and `OpenAlexSource` (works API, cited_by_count).
- Feed `citation_count` (and ideally reference/citation graph) into `Paper`.
- Add user-PDF ingestion path (upload → store → parse → treat as a candidate).
- Strengthen `dedupe` to merge the same paper across sources (DOI > arXiv id >
  normalized title).

**Interactions.** Ranking (§3.3) depends on citations; Relationships (§3.7)
could use real citation edges; PDF parsing (§3.4) for uploads.

**Decisions needed.** Which sources for the recovery milestone? Recommend
Semantic Scholar + arXiv + user-PDF first (covers relevance, citations, and
"bring your own paper"); OpenAlex/Crossref/GitHub later.

---

### 3.3 Ranking & categorization

**Current state.** `rank_papers` (ranking.py:38): embedding cosine relevance +
recency + citations + survey/benchmark keyword boosts, MMR diversity, then
**quantile** bucketing into must-read/useful/optional/skip-for-now.

**Problems found.**
- 🎯 **Rationale is a metrics dump.** `_format_rationale` (ranking.py:169)
  produces `"must-read: relevance=0.62, recency=0.41, citations=0.30"`. The
  vision's headline feature is a *pedagogical* "why read this" ("Read this
  first because it defines the core problem"). This is the single biggest
  ranking gap.
- ⚠️ **Purely relative categories.** Quantile cuts (ranking.py:151) force ~15%
  must-read / ~80% non-must regardless of absolute quality. 50 great papers →
  most get demoted; 50 weak papers → 15% still "must-read."
- 🐞 Dead line `ranking.py:95` (computed then overwritten on :96).
- 🐞 Citations effectively constant until §3.2 lands.

**Target.** Hybrid ranking: keep the cheap deterministic score for ordering,
but generate **human reasons** per paper and **quality-aware** categories;
ranking categories should be reconcilable with the LLM's per-paper
`reading_priority` (currently the extraction step overwrites the link category
at landscape_job.py:836 — these two category sources must be reconciled, not
silently last-writer-wins).

**Recovery actions.**
- Add an LLM (or synthesis-stage) pass that writes a one-line "why read this /
  why skip" grounded in the extraction, replacing the metrics string.
- Make categories quality-aware (absolute thresholds + relative), and define a
  single owner for `LandscapePaper.category` (ranking vs. extraction vs.
  synthesis reading-path) — today three stages write it.
- Remove dead line; add citation signal via §3.2.

**Interactions.** Discovery (§3.2 citations), Extraction (§3.5 sets priority),
Synthesis (§3.6 reading path), the reading-plan UI (§3.6).

**Decisions needed.** Where should the "why read this" be authored — ranking,
extraction, or synthesis? Recommend synthesis (it has cross-paper context) and
have ranking own only the initial ordering.

---

### 3.4 PDF download, storage & parsing

**Current state.** Streamed capped download, deterministic filenames, parse via
`pymupdf4llm`, sections split on markdown headings, chunks with char ranges.

**Problems found.**
- 🎯 **No page numbers.** `page_start/page_end` are always `None`
  (landscape_job.py:697, :711). The vision's grounding promise ("page 4, chunk
  12") can only ever populate chunk ordinals, never pages.
- 🎯 **No figures/tables.** Vision wants figures+captions+tables; not extracted.
- ⚠️ Duplicate chunking (see §2.5).

**Target.** Page-aware parsing (PyMuPDF4LLM supports page chunking / page
metadata) so grounding can cite pages; optional figure/table capture.

**Recovery actions.** Switch to page-aware extraction to populate
`page_start/page_end` on sections/chunks; thread pages into grounding
(§3.5); evaluate table/figure-caption extraction.

**Interactions.** Extraction grounding (§3.5), Paper detail UI (§3.12), Export
(§3.10 renders grounding).

**Decisions needed.** Is figure/table extraction in scope for recovery, or a
later enhancement? Recommend page numbers now, figures/tables later.

---

### 3.5 Structured extraction & source grounding

**Current state.** Strong. `extract_paper` (extraction.py:99): prioritized
chunk selection, char-budgeted context, compact retry on HTTP 400, schema
validation with salvage, and **grounding validation** that checks quotes
against chunk text and down-weights confidence.

**Problems found.**
- ⚠️ Grounding can cite `chunk_ordinal` but not `page` (blocked by §3.4).
- ⚠️ `_is_low_signal_extraction` / `_extraction_needs_refresh`
  (landscape_job.py:893–922) have subtle logic (`not meta and …` at :899 is
  effectively dead because the prior branch returns) — refresh detection should
  be tightened so cached degraded extractions are re-tried when a real provider
  is later configured.

**Target.** Keep the architecture; add page grounding; make
"refresh stale/degraded extraction" deterministic and correct.

**Recovery actions.** Thread page numbers; rewrite the refresh predicate with
explicit cases + tests; ensure switching stub→real provider invalidates
degraded extractions.

**Interactions.** PDF parsing (§3.4), Synthesis (§3.6 consumes extractions),
Concepts (§3.8 harvests key_terms), Quiz (§3.9 uses extracted fields).

**Decisions needed.** None major — this module is close. Confirm page-grounding
priority.

---

### 3.6 Field synthesis (overview, clusters, DAG, timeline, reading path)

**Current state.** `synthesise` (synthesis.py:79) always builds a deterministic
skeleton, then lets the LLM augment and backfills empty fields.

**Problems found.**
- 🎯 **Templated field structure.** `build_fallback_field_structure`
  (synthesis.py:217) emits the same three-node spine — "Field foundations →
  Methods and systems → Evaluation" — for *every* topic. When the LLM doesn't
  return a `field_structure`, every landscape's DAG looks identical, undercutting
  the vision's promise of a genuine field-specific map.
- ⚠️ Skeleton `field_overview`/`why_it_matters` default to `""`
  (synthesis.py:156); if the LLM fails, the landscape's headline prose is empty
  while structure shows — degraded mode looks broken rather than honestly
  "couldn't synthesize."
- ⚠️ Reading-path / cluster paper references are matched by title-or-id
  (landscape_job.py:992, :1009); brittle if titles repeat or differ slightly.

**Target.** A field structure that is genuinely topic-specific (LLM-authored,
deterministic only as a labelled fallback); honest, non-empty degraded copy;
robust id-based linking.

**Recovery actions.** Improve the synthesis prompt to require a topic-specific
DAG; when falling back, label it as "auto-generated outline" in the UI; prefer
stable `paper_id` references end-to-end (assign ids the LLM must echo).

**Interactions.** Ranking (§3.3 reading path/why), Concepts (§3.8 harvests
field-structure nodes), Relationships (§3.7), Landscape UI (§3.12), Export
(§3.10).

**Decisions needed.** Acceptable degraded UX when synthesis LLM fails — show
skeleton labelled as such, or block the landscape as "incomplete"?
*(Resolved — decision #9: labelled skeleton.)*

**Status: reliability + quality hardening implemented & verified
(Sprint 5 follow-on).** The single biggest defect — `synthesise()` wrapping the
whole call in `try/except Exception: return skeleton`, which silently collapsed
*every* failure (parse error, one bad nested item, timeout, HTTP 400,
validation) to the deterministic skeleton with no diagnostics — is gone.
What changed:

- **Structured outcome + telemetry.** `synthesise_with_meta()` (new entry point;
  `synthesise()` kept as a thin wrapper) returns a `SynthesisResult` carrying a
  named `cause` (`real` / `no_papers` / `stub` / `json_parse` / `validation` /
  `timeout` / `http_400` / `http_error` / `empty_fields` / `error`) and a
  `degraded` flag. The worker now emits a `synthesising` job event naming the
  exact cause when it degrades, persists `synthesis.synthesis_quality`, and sets
  `content_quality="degraded"` honestly (the FE banner already labels it as an
  "auto-generated outline" per decision #9).
- **Partial-field salvage.** `_validate_with_salvage` validates each nested item
  (clusters / reading_path / paper_rationales / field-structure nodes & edges)
  **item-by-item**, so one malformed cluster or out-of-range node no longer sinks
  the entire synthesis — the good content survives and the run still counts as
  `real`.
- **JSON robustness.** `_try_parse_json` (llm.py) now strips trailing commas and
  salvages truncated objects (max_tokens cut-offs) by closing open
  brackets/strings, on top of the existing fence/prose handling.
- **Token budget / compact retry.** `build_papers_json(..., compact=True)` trims
  the bundle (cap count, drop bulky list fields); on an HTTP 400 the synthesis
  call retries with the compact bundle, mirroring extraction.py.
- **`field_structure_generated` is now honest:** True only when ≥1 LLM node
  survives validation; the deterministic fallback is never mislabelled as
  LLM-authored.
- **Identity seam (§4.2) made observable.** The synthesis prompt hard-demands
  exact `paper_id` echoes; `_persist_synthesis` counts how references resolve
  (`id_hit` / `title_fallback` / `unmatched`), logs fallbacks, and folds the
  counts into `synthesis.synthesis_quality.identity_resolution`. Title matching
  remains a last resort only.

Tests: `tests/test_synthesis_reliability.py` covers each failure mode
(parse/truncation, one-bad-item salvage, timeout, validation, empty, HTTP 400
compact retry, non-400 error, stub gating, compact-bundle sizing,
field-structure-generated honesty) plus a DB-backed identity-resolution test.
Verified: ruff clean, 109 tests pass (DB-backed on pgvector PG16), Alembic
`upgrade head` + autogenerate drift-clean (no model changes), `next build` green.
**Deferred (unchanged):** decomposing the one-giant-prompt into a multi-pass
design (current single prompt + salvage is reliable enough); citation-edge
seeding for the DAG; a dedicated field-structure UI (graph viz lands in Sprint 7
scope).

---

### 3.7 Paper relationship graph

**Current state.** `generate_paper_relationships` (relationships.py:24) is
**100% deterministic heuristics**: title-token matching for `related_papers`,
shared-benchmark/dataset/metric buckets, and fallbacks that connect "adjacent
papers in ranking order" and link survey papers to the first 8 others.

**Problems found.**
- 🎯 **Edges are largely fabricated adjacency.** "Adjacent in ranking order =
  related" (relationships.py:107) and "survey → first 8 papers"
  (relationships.py:96) produce edges with no real semantic meaning. The vision
  wants true relationships ("B critiques A's benchmark," "C improves D's
  metric").
- ⚠️ `_resolve_paper_ref` token-overlap matching (relationships.py:112) is
  noisy and can mis-link.

**Target.** LLM-authored, extraction-grounded relationships with typed edges
and rationales; deterministic heuristics demoted to a labelled fallback;
optionally seed from real citation edges (§3.2).

**Recovery actions.** Add a synthesis-stage relationship pass over the
extraction bundle (it already has method/contribution/limitations/related);
keep deterministic edges only to fill gaps and mark them as such; use real
citation links where Semantic Scholar/OpenAlex provide them.

**Interactions.** Discovery (§3.2 citations), Synthesis (§3.6), Map UI (§3.12).

**Decisions needed.** Cost tolerance for an extra LLM pass per landscape vs.
heuristic-only. Recommend LLM with citation seeding.

---

### 3.8 Concept layer & interactive glossary

**Current state.** Strong on both ends. Candidate harvesting from extractions +
field structure (`collect_concept_candidates`, concepts.py:125), LLM
definitions with deterministic fallback, markdown-safe highlighting
(`annotate_text`), Obsidian wikilinks, concept detail + concept-map endpoints,
`ConceptText.tsx` client rendering.

**Problems found.**
- ⚠️ **Logic duplicated** in Python (`annotate_text`) and TS
  (`ConceptText.annotate`) — must be kept in sync by hand (§2.5).
- ⚠️ `AnnotatedTextSegment` schema exists (schemas.py:274) but **no endpoint
  returns annotated segments** — the contract is half-built; the client
  re-derives annotation.
- ⚠️ Fallback definitions are generic ("A recurring concept in this {topic}
  landscape", concepts.py:335) — acceptable as a stub but weak without a real LLM.

**Target.** One annotation source of truth; concept definitions are reliably
LLM-authored under the default (Claude) provider.

**Recovery actions.** Either (a) serve annotated segments from the backend and
have the client consume them, or (b) formally designate the client as the
renderer and delete the unused server contract — and add a shared test fixture
that guards parity. Recommend (a) for the long-form landscape prose, (a/b)
pragmatic for short fields.

**Interactions.** Synthesis/Extraction (source text), Export (§3.10 wikilinks),
Landscape/Paper/Reading-plan UIs (§3.12, all render `ConceptText`).

**Decisions needed.** Server-rendered vs. client-rendered annotation (see §2.5).

---

### 3.9 Active recall: quizzes, flashcards, review & spaced repetition

**Current state.** `generate_quizzes_and_flashcards` (quiz_generation.py) with a
solid extraction-grounded fallback. `GET` endpoints for quiz/flashcards.
Frontend `QuizInterior` / `FlashcardInterior`.

**Problems found.**
- 🎯 **No review loop.** `ReviewAttempt` table exists (models.py:285) but
  **nothing writes to it** — there is no `POST` review endpoint. So: no answer
  recording, no scoring, no weak-area detection, no daily queue, no FSRS/spaced
  repetition. This is a headline vision feature (the thing that "separates it
  from normal research tools") and it's absent.
- ⚠️ Quiz distractors in fallback are just other paper titles
  (quiz_generation.py:172) — weak pedagogically.
- 🎯 No explain-before-reveal or paper-comparison question types as first-class.

**Target.** A real review system: record attempts, schedule with FSRS, surface
weak areas, generate a daily review queue; richer question types.

**Recovery actions.**
- Add `POST /api/.../review` to record `ReviewAttempt` (correct/rating).
- Implement FSRS scheduling (state per item); add a review-queue endpoint and a
  weak-area view.
- Add explain-before-reveal + comparison question generation.

**Interactions.** Concepts (§3.8 concept checks), Mobile review UX (§3.12),
Progress tracking (long-term vision), Export (§3.10 flashcards).

**Decisions needed.** FSRS now or simple SM-2 first? Recommend FSRS (the vision
names it) but ship attempt-recording + a basic scheduler first, then tune.

---

### 3.10 Obsidian export

**Current state.** Strong (§1.1). `obsidian_git.py` renders the full vault
layout with frontmatter, idempotent writes, preview, optional push.

**Problems found.**
- ⚠️ `export_obsidian` raises 500 on any git error with a helpful message
  (routes.py:454) but there's no automatic `git init` surfaced to the user in
  the UI flow; preview vs. write paths build the plan twice
  (`_build_export_plan` runs on every preview and export).
- ⚠️ Export is **not part of the pipeline** (by design) — fine, but the vision's
  loop ends in "export + review," so the hand-off from "landscape ready" to
  "exported" should be a guided step, not a separate page the user must find.

**Target.** Keep the engine; tighten UX and error reporting; make export a
first-class, discoverable step in the loop.

**Recovery actions.** Surface preview diffs prominently; one-click init+commit;
optionally offer auto-export-on-complete as a setting.

**Interactions.** Concepts (§3.8 wikilinks), Synthesis/Extraction (content),
Settings (§3.13 repo path/push), Deployment (§3.14 volume mount).

**Decisions needed.** Auto-export on pipeline completion (opt-in) — yes/no?

---

### 3.11 Pipeline orchestration & progress (jobs)

**Current state.** `run_landscape_job` (landscape_job.py) runs all stages with
per-stage events; SSE at `/api/jobs/{id}/events`; rich frontend job page
(738 lines) consuming `EventSource`.

**Problems found.** Covered in §2.2 (event store race + O(n²) + polling SSE).
Additionally:
- ⚠️ **Stage vocabulary is inconsistent** across `STAGES` (landscape_job.py:71),
  `_set_error`'s `"failed"`, and `landscape.status` values. The frontend has to
  guess the terminal states.
- ⚠️ No job cancellation, no resume, no per-stage retry; a stuck stage has no
  watchdog.

**Target.** Reliable, observable, resumable-ish jobs with a single shared stage
contract and push-based progress.

**Recovery actions.** Implement §2.2; publish a shared stage enum to the
frontend; add a stall watchdog and a cancel endpoint.

**Interactions.** Everything (it's the spine), plus the Jobs UI (§3.12).

**Decisions needed.** Is job cancel/resume in scope for recovery? Recommend
cancel yes, resume later.

---

### 3.12 Frontend / UX (desktop deep-research + mobile review)

**Current state.** Full page set (search, jobs, landscape, papers, paper detail,
map, concepts, reading-plan, quiz, flashcards, export, settings, landscapes,
design-system). CSS-responsive via Tailwind `md:`. Some very large page
components (landscape 1014 lines, paper 988, jobs 738).

**Problems found.**
- 💀 `PhoneFrame` + `useIsMobile` dead code (§2.5) — leftovers from the
  abandoned fake-phone approach the vision rejects. The current responsive
  approach is correct; just remove the orphans.
- ⚠️ **Very large page files** mixing data-fetching, state, and presentation —
  hard to maintain, likely where "things don't function properly" bugs hide.
- ⚠️ Graph/map pages exist but there's **no real graph visualization library**
  in deps (vision wants graph exploration) — confirm whether map pages render
  actual interactive graphs or static lists.
- ⚠️ Mobile review mode: the components are responsive, but the vision's
  dedicated mobile flows (flashcards / MCQ / weak-area / daily queue) depend on
  §3.9 which doesn't exist yet.

**Target.** Cohesive, componentized UI; genuine interactive graph for
map/concept-map; first-class mobile review screens once §3.9 lands.

**Recovery actions.** Decompose the giant pages into components + data hooks;
adopt a graph viz lib for §3.6/§3.7/§3.8 maps; remove dead UI code; build mobile
review screens against the new review API.

**Interactions.** All backend features; §3.9 (mobile review), §2.2 (jobs
stream contract).

**Decisions needed.** Graph library choice; how far to push the page
decomposition during recovery vs. later.

---

### 3.13 Settings & provider configuration

**Current state.** `GET /api/settings` reflects runtime config; `PATCH` is a
**no-op** (routes.py:432, returns current view). Settings page
(`app/settings/page.tsx`) is intentionally read-only; `/ready/embeddings`
smoke-tests the embedding provider.

**Problems found.**
- 🎯 **Settings can't be changed in-app.** Provider, models, repo path,
  max_papers all live in `.env`. The vision's settings/management surface
  implies runtime control (at least repo path, auto-push, max_papers,
  provider/model selection).
- ⚠️ Read-only PATCH is a stub contract that looks functional but isn't.

**Target.** Persisted, runtime-editable settings (DB-backed) for the safe
subset, with secrets staying in env. `get_settings()` is `@lru_cache`d
(config.py:60) — runtime changes need a settings store that the services read,
not just env.

**Recovery actions.** Introduce a DB-backed settings record for editable fields;
make services read effective settings (env defaults + DB overrides); wire the
settings page form to a real PATCH. Keep API keys env-only.

**Interactions.** Provider strategy (§2.4), Export (§3.10 repo/push), Ranking
(§3.3 max_papers), Discovery (§3.2 sources).

**Decisions needed.** Which settings become runtime-editable vs. env-only?
Recommend editable: provider/model selection, max_papers, sources, obsidian
repo path + auto-push; env-only: secrets, DB/Redis URLs, embedding dim.

---

### 3.14 Deployment & infrastructure

**Current state.** `docker-compose.yml` (dev) + `docker-compose.prod.yml`,
`deploy/`, Caddy/Nginx implied by README, Vercel-frontend + VPS-backend split
matching the vision. `init_db` and `wait_for_redis` retry loops handle the
compose boot race.

**Problems found.**
- ⚠️ `@app.on_event("startup")` (main.py:42) is deprecated — migrate to
  lifespan handlers.
- ⚠️ Startup swallows `init_db` / redis failures to keep `/health` up
  (main.py:49,53) — good for debugging, but a misconfigured deploy can look
  "healthy" while broken. `/ready` distinguishes them; ensure deploy probes use
  `/ready`, not `/health`.
- ⚠️ pgvector dimension is fixed at deploy; changing embedding provider/dim
  (§2.4) requires a migration + reindex — must be documented.

**Target.** Clean lifespan startup; deploy probes on `/ready`; documented
embedding-dimension migration path.

**Recovery actions.** Migrate to lifespan; document `/ready` as the readiness
probe; document the embedding-dim change procedure (tie to §2.1/§2.4).

**Decisions needed.** None blocking; sequence with §2.1/§2.4.

---

## 4. Feature-interaction map (the seams)

The vision stresses optimizing *interactions*, not just features. The
highest-risk seams:

1. **Category ownership** — `LandscapePaper.category` is written by ranking
   (§3.3), overwritten by extraction's `reading_priority`
   (landscape_job.py:836), and implied again by synthesis reading-path order.
   → **One owner, reconciled.**
2. **Paper identity** — references flow as title *or* id across ranking →
   synthesis (clusters/reading-path) → relationships → export. Title matching
   is brittle. → **Stable `paper_id` everywhere; LLM must echo ids.**
3. **Progress/event contract** — worker stages, `_set_error` "failed", and
   `landscape.status` use different vocabularies; the SSE/UI must agree.
   → **Shared stage enum (§2.2/§3.11).**
4. **Grounding chain** — pages must survive parse (§3.4) → chunk → extraction
   grounding (§3.5) → paper UI (§3.12) → export (§3.10). Today pages drop at
   the first step.
5. **Concept annotation parity** — Python and TS annotators must agree
   (§2.5/§3.8).
6. **Provider/dimension coupling** — LLM/embedding choice (§2.4) ↔ pgvector
   schema (§2.1) ↔ settings (§3.13).
7. **Discovery → ranking signal** — citations only exist if non-arXiv sources
   land (§3.2 → §3.3 → §3.7).

---

## 5. Suggested phasing

A pragmatic order (we'll adjust as we work through sections):

- **Phase 0 — Foundations:** §2.1 migrations, §2.2 job events/SSE, §2.5 dead
  code, define shared stage/identity contracts (§4.1–4.3). *Unblocks everything.*
- **Phase 1 — Quality of the core loop:** §2.4 providers (Claude + local
  embeddings), §3.3 ranking rationales, §3.6 real field structure, §3.7 real
  relationships. *Makes outputs actually good.*
- **Phase 2 — Breadth & trust:** §3.2 sources + citations, §3.4 page grounding,
  §3.5 refresh correctness.
- **Phase 3 — The differentiator:** §3.9 review/FSRS + mobile review (§3.12).
- **Phase 4 — Polish:** §3.10 export UX, §3.13 runtime settings, §3.8 annotation
  consolidation, §3.14 deploy hygiene, frontend decomposition.

---

## 6. Resolved decisions

All shaping decisions are locked. The sprint plan (§7) is built on these.

| # | Decision | Resolution | Affects |
|---|----------|-----------|---------|
| 1 | **Auth posture** | **Single-user now.** No login; plumb `user_id` through models/queries so multi-user is additive later. | §2.6 |
| 2 | **LLM provider** | **DeepSeek.** V4 Pro for hard tasks (extraction, synthesis, relationships, concepts); cheaper DeepSeek model for simpler ones (quiz/flashcards). Confirm exact model IDs at build. | §2.4, §3.5/3.6/3.7/3.8/3.9 |
| 3 | **Embeddings** | **Local default + optional API.** Add sentence-transformers (bge-small / MiniLM, 384-d) as the cost-free default; keep OpenAI embeddings optional. | §2.4, §2.1 |
| 4 | **Event store** | **`job_events` table + Redis pub/sub.** Append-only rows; pub/sub for live SSE push (DB poll as fallback). | §2.2, §3.11 |
| 5 | **Sources** | **Semantic Scholar + arXiv + user-PDF.** OpenAlex/Crossref/GitHub later. | §3.2, §3.3 |
| 6 | **"Why read this" owner** | **Synthesis stage** (cross-paper context). Ranking owns only initial ordering. | §3.3, §3.6 |
| 7 | **Concept annotation** | **Server-rendered + parity test.** Backend returns annotated segments; client consumes; shared fixture guards parity. | §3.8, §2.5 |
| 8 | **Review scheduler** | **Attempt-recording first, then FSRS.** Ship `POST review` + recording + basic scheduler, then layer FSRS. | §3.9 |
| 9 | **Degraded synthesis UX** | **Labelled skeleton** — show deterministic structure clearly marked "auto-generated outline / synthesis unavailable." | §3.6 |
| 10 | **Migrations** | **Alembic.** Up/down migrations; remove `create_all` + ad-hoc `ALTER`s from the startup hot path. | §2.1 |
| 11 | **Alpha DB** | **Recreate from scratch.** No data to preserve; baseline a clean initial migration and drop the legacy backfill patches. | §2.1 |

---

## 7. Sprint plan

Eight sprints, each independently shippable and verifiable. Dependencies are
strict left-to-right where noted; within a sprint, items can parallelize.
Each sprint lists **Goal → Scope → Acceptance** and the spec sections it closes.

### Sprint 0 — Foundations & cleanup *(closes §2.1, §2.5, §2.6, parts of §3.14, §4.1–4.3)*

> **Goal:** A clean, contract-driven base so later sprints aren't built on sand.
>
> **Status: implemented (pending CI/dev verification).** Done: Alembic +
> baseline/seed migrations (`create_all` + `_ensure_*` removed); dead code
> deleted; canonical `app/pipeline.py` (+ `lib/pipeline.ts`) stage/status
> vocabulary; single-user `user_id` plumbing; lifespan startup; `/ready` as a
> 503-capable readiness probe. **Deferred to Sprint 4:** enforcing "LLM must
> echo `paper_id`" (the prompt + validation change belongs with the synthesis
> rework, where stable ids are also listed). Tests/migrations were
> compile-checked only — the suite and a live `alembic upgrade` must run in CI /
> a DB-backed env (deps weren't installable in the authoring sandbox).

- **Alembic** with a single baseline migration generated from current models
  (recreate-from-scratch). Remove `_ensure_chunk_metadata_columns`,
  `_ensure_concept_columns`, and `create_all` from `init_db`.
- **Remove dead code:** `PhoneFrame.tsx`, `useViewport.useIsMobile`,
  `extraction._join_sections`, the unused parser `chunks` field.
- **Shared contracts:** one canonical **stage enum** + **`landscape.status`
  enum**, exported to the frontend; adopt **stable `paper_id`** as the only
  cross-stage reference (LLM must echo ids).
- **Single-user plumbing:** thread `user_id` through models/queries (no login).
- **Startup hygiene:** replace deprecated `@app.on_event` with lifespan; deploy
  readiness probe → `/ready`.
- **Acceptance:** fresh DB boots purely via Alembic; no dead code remains;
  frontend imports the shared stage/status constants; `paper_id` used everywhere.

### Sprint 1 — Job orchestration & progress *(closes §2.2, §2.3, §3.11)*

> **Goal:** Reliable, race-free, push-based pipeline progress.
>
> **Status: implemented & verified.** Append-only `job_events` table (DB-assigned
> monotonic `seq`); worker does single-row inserts + atomic `GREATEST` progress
> (race + O(n²) gone); Redis pub/sub push SSE with DB-poll fallback, stall
> watchdog, and lifetime cap; cooperative cancellation (`CANCELLED` stage,
> `POST /jobs/{id}/cancel`, jobs-page Cancel button); N+1 batched in the five
> listed call sites. Also froze the Alembic baseline as explicit DDL so
> incremental migrations are now real (drift-checked: baseline == models).
> Verified on pgvector Postgres 16 (incl. a 25-way concurrent-append test) +
> CI green; frontend builds.

- **`job_events` table** (append-only, one row per event); worker emits
  single-row inserts — kills the JSONB read-modify-write race and O(n²) rewrite.
- **Redis pub/sub**; SSE subscribes (slow DB poll as fallback) with heartbeat +
  **stall watchdog**.
- **Cancel endpoint**; unify terminal-state vocabulary (`done`/`failed`).
- **Fix N+1** in `get_landscape_papers`, `get_landscape_graph`,
  `_build_export_plan`, `_load_landscape_bundle`, `_persist_synthesis`.
- **Acceptance:** concurrent download/parse/extract events never lost; progress
  monotonic; UI updates via push; cancel works; no per-row paper `get` loops.

### Sprint 2 — Providers & runtime config *(closes §2.4, §3.13)*

> **Goal:** Out-of-the-box real pipeline on DeepSeek + local embeddings.
>
> **Status: implemented & verified.** Default LLM provider is DeepSeek
> (reasoner/chat tiers, env-overridable); `StubLLM` is gated to
> `ENV=development` and raises otherwise. Local `fastembed` embeddings
> (bge-small, 384-d) are the cost-free default with migration 0003 resizing the
> pgvector columns. DB-backed runtime settings (migration 0004) make LLM
> provider/models, max-papers, and Obsidian auto-push editable via a real
> `PATCH /settings` + settings-page form, taking effect without redeploy.
> Verified on pgvector Postgres 16 (migrations drift-clean) + next build green.
> **Deferred:** exact DeepSeek "V4 Pro" model id (env-overridable; using
> `deepseek-reasoner`/`deepseek-chat` defaults — confirm against the account's
> catalog); Obsidian repo path + default sources remain env-only.

- **DeepSeek default** with the V4-Pro/cheap tier mapping; demote `StubLLM` to
  explicit `ENV=development` (drop silent prompt-sniffing default).
- **Local embeddings provider** (sentence-transformers, 384-d) as default; set
  `EMBEDDING_DIM=384`; Alembic migration to resize pgvector columns + reindex;
  keep OpenAI embeddings optional.
- **DB-backed runtime settings** for the editable subset (provider/model,
  max_papers, sources, obsidian repo path + auto-push); make `PATCH /settings`
  real and wire the settings page form. Secrets stay env-only.
- **Acceptance:** clean install runs a real landscape with only a DeepSeek key
  configured; editable settings persist and take effect without redeploy.

### Sprint 3 — Discovery & ranking quality *(closes §3.2, §3.3)*

> **Goal:** Multi-source discovery with real signals and quality-aware ranking.
>
> **Status: implemented & verified.** Added a Semantic Scholar source
> (citations/influence/OA-PDF/DOI), made `[arxiv, semantic_scholar]` the
> default, and rewrote dedupe to *merge* across sources via union-find over
> DOI/arXiv-id/title (so citations + PDF combine into one record). Ranking
> categories are now absolute-quality tiers with a thin relative floor (no fixed
> must-read quota), and ranking is the **single owner** of `category`
> (extraction no longer overwrites it). Citation counts feed `Paper` and refresh
> on re-runs. **User-PDF upload ingestion** done: `POST .../papers/upload` +
> `ingest_uploaded_pdf` (store/parse/sections/link, idempotent) + an Upload-PDF
> control on the papers page. 55 tests pass; ruff clean; next build green.
> **Later (unchanged from plan):** OpenAlex/Crossref/GitHub sources; uploaded
> papers fold into extraction/synthesis on the next landscape run.

- **`SemanticScholarSource`** (citations / influential-citation count / OA PDF)
  + **user-PDF ingestion** (upload → store → parse → candidate); cross-source
  **dedupe** by DOI > arXiv id > normalized title; feed `citation_count` into
  `Paper`.
- **Ranking:** quality-aware categories (absolute + relative), remove dead line
  `ranking.py:95`, and establish a **single owner** for `LandscapePaper.category`
  (stop ranking/extraction/synthesis silently overwriting each other).
- **Acceptance:** results merge across sources with citations populated;
  categories reflect absolute quality; exactly one stage writes `category`.

### Sprint 4 — Synthesis, field structure & relationships *(closes §3.6, §3.7, parts of §3.3)*

> **Goal:** Topic-specific maps and genuinely pedagogical reasoning.
>
> **Status: implemented & verified.** Synthesis now owns a per-paper
> `paper_rationales` ("why read / why skip", grounded in extraction), persisted
> onto `LandscapePaper.rationale` and shown in the UI — replacing ranking's
> metric string. The prompt demands a topic-specific field-structure DAG and a
> `field_structure_generated` flag marks LLM-authored vs the deterministic
> fallback. Relationships are LLM-authored grounded typed edges
> (`generate_relationships`, validated + deduped) with the heuristics demoted to
> a labelled fallback. The landscape page shows a degraded/auto-generated-outline
> banner (decision #9). 59 tests pass; ruff clean; next build green.
> **Note:** the field-structure DAG still has no dedicated UI (gets graph viz in
> Sprint 7); citation-edge seeding from S2 references is a later enhancement.

- **Topic-specific field-structure DAG** (LLM-authored; deterministic spine only
  as a **labelled** fallback per decision #9).
- **"Why read this / why skip"** authored in **synthesis**, grounded in
  extractions, replacing the metrics-string rationale; stable `paper_id`
  references end-to-end.
- **LLM-authored, extraction-grounded relationship graph** (typed edges +
  rationale); heuristics demoted to labelled fallback; **seed from Semantic
  Scholar citation edges**.
- **Acceptance:** two different topics yield structurally different DAGs; reading
  path shows real reasons; relationship edges are meaningful (not adjacency).

### Sprint 5 — Grounding depth & extraction correctness *(closes §3.4, §3.5)*

> **Goal:** Trustworthy, page-level source grounding.
>
> **Status: implemented & verified.** PDF parsing is now **page-aware**: the
> parser renders pages individually (`page_chunks=True`), assembles one markdown
> document while recording a per-page char-span map (`ParsedPdf.page_spans`), and
> emits `ParsedSection`s carrying `page_start/page_end` + the content's absolute
> `doc_offset`. The worker's `_replace_sections_and_chunks` maps each derived
> chunk's char-range back through the page map to a 1-based PDF page, so
> `page_start/page_end` are populated on both `paper_sections` and `chunks`
> (previously always `None`). The existing grounding chain already threads
> `chunk.page_start` → extraction context → `validate_grounding` → the export
> renderer; with real pages flowing it now cites "section · page N · chunk N".
> Added a **Source grounding** card to the paper-detail UI showing field →
> section · page · chunk + quote + confidence. The extraction-refresh predicate
> (`_extraction_needs_refresh`) was rewritten with explicit, tested cases and now
> takes `provider_is_real`: degraded extractions are invalidated (re-extracted)
> when a real LLM is configured but kept under the dev stub (no pointless churn);
> low-signal healthy extractions also refresh only under a real provider.
> Chunking was already consolidated on the worker's range-aware
> `_chunk_text_with_ranges` in Sprint 0 (verified — the parser no longer chunks).
> 74 tests pass (incl. a DB-backed chunk→page persistence test); ruff clean;
> migrations drift-clean (page columns already existed — no migration needed);
> `next build` green.
> **Deferred (unchanged from plan):** figure/table extraction (§3.4) remains a
> later enhancement.

- **Page-aware PDF parsing** → populate `page_start/page_end` on sections/chunks;
  thread pages through grounding → paper UI → export.
- **Consolidate chunking** to one implementation.
- **Rewrite the extraction refresh predicate** (`_extraction_needs_refresh` /
  `_is_low_signal_extraction`) with explicit cases + tests; switching
  stub→real provider invalidates degraded extractions.
- **Acceptance:** grounding cites page + chunk; configuring a real provider
  re-extracts previously degraded papers.

### Sprint 6 — Active recall & review loop *(closes §3.9, mobile parts of §3.12)*

> **Goal:** The differentiator — prove understanding, not just consume.
>
> **Status: implemented & verified.** The review loop is real now. A pure-Python
> **FSRS-4.5 scheduler** (`app/services/fsrs.py`, no new deps) models per-item
> stability/difficulty and grades reviews on the 4-point Again/Hard/Good/Easy
> scale; `POST /landscapes/{id}/review` records a `ReviewAttempt` *and* advances a
> new per-item `ReviewState` (migration 0005; `review_attempts.user_id` added).
> `GET …/review/queue` returns a daily queue (overdue first, then unseen) and
> `GET …/review/weak-areas` aggregates accuracy per concept (lowest first).
> Question types are richer: the quiz fallback + prompt now emit
> **explain-before-reveal** flashcards (`kind=explain`) and **paper-comparison**
> MCQs/`compare` cards. A responsive **/landscape/[id]/review** screen drives
> flashcards (reveal → self-grade) and MCQs (pick → grade from correctness),
> posts each review, and has a weak-areas tab; the landscape page links to it.
> 83 tests pass (7 FSRS property tests + 1 generator test + a DB-backed
> review-service test; plus an HTTP TestClient smoke); ruff clean; migrations
> drift-clean; `next build` green.
> **Deferred / later:** parameter optimisation/tuning of the FSRS weights from a
> user's own history (defaults shipped); cloze generation; review history on the
> Obsidian export.

- **`POST review`** → record `ReviewAttempt`; basic scheduler → **FSRS**;
  **review-queue** + **weak-area** endpoints.
- **Richer question types:** explain-before-reveal + paper-comparison.
- **Mobile review screens** (responsive) against the new API.
- **Acceptance:** answering records attempts; daily queue + weak areas surface;
  FSRS schedules; mobile review usable.

### Sprint 7 — Annotation, export UX & frontend polish *(closes §3.8, §3.10, rest of §3.12)*

> **Goal:** Coherence and finish across the loop.
>
> **Status: implemented & verified.** **Annotation** is now single-source
> (decision #7): `POST /landscapes/{id}/annotate` serves segments from the
> canonical `annotate_text`; the client (`lib/annotation.ts`) batches all
> requests in a microtask into one round-trip and caches per (landscape, text),
> and `ConceptText` consumes server segments — the duplicated TS `annotate()`
> algorithm is deleted, so there's nothing left to drift. A golden-fixture parity
> test pins the segmentation (code/headings protected, generic terms skipped,
> lossless round-trip) plus a DB-backed endpoint test. **Export UX:** a shared
> `export_service` builds the plan + writes/records in one place (route preview,
> route export, and the worker all use it — the route's duplicated builder is
> gone); one-click init was already covered (`write_plan` inits a non-git repo)
> and the export page already shows prominent preview diffs + commit; added
> **opt-in auto-export-on-complete** (`obsidian_auto_export` runtime setting →
> worker exports on a successful finish, best-effort, with a settings toggle).
> **Graph viz:** a dependency-free interactive SVG **RelationshipGraph**
> (force layout, draggable nodes, zoom/pan, edge hover with type + rationale,
> click-through) on a new Clusters/Relationships toggle on the map page,
> consuming the Sprint-4 `/graph` edges. 88 backend tests pass; ruff clean;
> migrations drift-clean; `next build` green.
> **Deferred (honest):** full decomposition of the remaining giant pages
> (landscape ~1014 / paper ~988 / jobs ~738) into hooks+components — one
> substantial component (RelationshipGraph) was extracted and the map page
> branched, but the big pages are otherwise unchanged; a concept-map graph view
> (the relationship graph shipped) and richer graph styling are later polish.

- **Server-rendered concept annotation** + parity test; client consumes the
  segment contract.
- **Export UX:** prominent preview diffs, one-click init+commit, opt-in
  auto-export-on-complete.
- **Frontend decomposition:** break up the giant pages (landscape 1014 / paper
  988 / jobs 738) into components + data hooks; adopt a **graph viz library**
  for map / concept-map / relationship views.
- **Acceptance:** one annotation source of truth; export is a discoverable step
  in the loop; pages componentized; interactive graphs render.

### Sprint 8 — Navigation, information architecture & app shell *(new; closes the IA gaps in §3.12)*

> **Goal:** A coherent two-scope shell where global vs. landscape-scoped actions
> are obvious, the active landscape is always indicated, and switching/exiting a
> landscape is one click.
>
> **Status: implemented & verified.** Both the headline fix and the planned
> follow-ups shipped: a **global Jobs index** (`GET /api/jobs` + `/jobs` page)
> makes every run reachable (sidebar "Job monitor" now resolves); a **⌘K command
> palette** (`components/shell/CommandPalette.tsx`, opened by ⌘/Ctrl-K or the
> topbar search box) jumps to any landscape / scoped page / action and doubles as
> the landscape switcher; `/` now lands on `/landscapes` (workspace, not the
> create form); the design-system link is gated out of production nav. Backend
> 110 tests pass (incl. a jobs-index test); ruff clean; `next build` green.
> Mobile parity is now done too: the bottom-tab scoped tabs (Read/Learn/Map) are
> muted + locked (with a tap that routes to the landscape picker) when no
> landscape is selected, mirroring the desktop sidebar. **All 10 audit items are
> resolved.**
>
> The headline fix shipped first:
> `components/shell/Sidebar.tsx` was reworked into two explicit scopes — a GLOBAL
> group (All landscapes / New landscape / Settings) that always works, and a
> CURRENT-LANDSCAPE group (Overview, Cluster map, Papers, Reading plan, Quiz,
> Flashcards, **Review**, Obsidian export) that is **locked (greyed + lock icon)
> when no landscape is selected** and otherwise targets the resolved landscape.
> A **context card** now always shows which landscape the scoped section targets
> (name + status), distinguishes "current" (you're inside it) from "recent"
> (remembered via `lib/landscape/recent`, shared with the mobile bottom bar), and
> gives a one-click **✕ exit / switch** back to all landscapes. The misleading
> global **"Job monitor → /landscapes"** item was removed; the **Review** route
> (shipped Sprint 6 but never linked) was added; the **Topbar Export CTA** no
> longer dead-links when no landscape is active. `next build` green.

**Audit findings (the "issues like this"):**

| # | Finding | Severity | State |
|---|---------|----------|-------|
| 1 | Sidebar showed 7 landscape-scoped items globally; dead-linked to `/landscapes` with no landscape; no active-landscape indicator; clunky exit. | 🐞/🎯 | **Fixed** (this sprint) |
| 2 | "Job monitor" linked to `/landscapes`, not a job — and there was **no global Jobs index**; `/jobs/{id}` was only reachable from the create flow. | 🐞/🎯 | **Fixed** — `GET /api/jobs` + `/jobs` index; sidebar item resolves |
| 3 | The `/landscape/[id]/review` screen (Sprint 6) was missing from the sidebar entirely. | 🎯 | **Fixed** |
| 4 | Topbar Export CTA dead-linked to `/landscapes` when no landscape was active. | ⚠️ | **Fixed** |
| 5 | No landscape **switcher** — changing landscapes means going to `/landscapes` and clicking. | ⚠️ | **Fixed** — ⌘K palette switches landscapes; context card "switch" too |
| 6 | `FakeSearch` ⌘K box was **non-functional** (visual only). | 🎯 | **Fixed** — real command palette (⌘K / topbar / `fm:open-cmdk`) |
| 7 | `/` redirected to `/search` (the create form) as "home"; the truer home is `/landscapes`. | ⚠️ | **Fixed** — `/` → `/landscapes` |
| 8 | **Design-system** link exposed in production nav (dev-only tool). | ⚠️ | **Fixed** — gated behind `NODE_ENV !== "production"` |
| 9 | Mobile `BottomTabBar` routed scoped tabs to `/landscapes` when no landscape (same root cause as #1); should mirror the locked/disabled treatment. | ⚠️ | **Fixed** — scoped tabs muted + locked, tap routes to the picker |
| 10 | Giant page components (landscape ~1014 / paper ~988 / jobs ~738) mix fetch+state+view — already logged under Sprint 7 deferred; revisit alongside shell work. | ⚠️ | Deferred (Sprint 7) |

**Remaining follow-up (nice-to-haves):**
- `GET /api/jobs?landscape_id=` exists and the index covers reachability; a per-landscape
  "current job" shortcut on the Overview page is a nice-to-have on top.
- **Acceptance (met):** no nav item dead-links; the active landscape is always visible and
  switchable in ≤1 click (context card + ⌘K); scoped actions are visibly unavailable until a
  landscape exists; jobs are reachable for any run via `/jobs`.

---

### Dependency summary

```
Sprint 0 ──► Sprint 1 ──► Sprint 2 ──► Sprint 3 ──► Sprint 4
                 │                          │           │
                 └────────────► Sprint 5 ◄──┘           │
                                                Sprint 6 (after 2; 4 helps)
                                                Sprint 7 (after 4, 6)
```

- **0 → everything** (contracts, migrations, identity).
- **1** before any sprint relying on clean progress/queries.
- **2** before 3/4/5/6 (real provider + embeddings drive output quality).
- **5** needs page data from parsing; independent of 3/4 otherwise.
- **7** is the finishing pass once content (4) and review (6) exist.

---

*End of draft. Pick a sprint (Sprint 0 is the recommended start) and I'll turn
its section into a concrete, buildable task list.*
