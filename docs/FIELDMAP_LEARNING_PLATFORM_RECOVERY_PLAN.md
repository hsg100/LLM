# FieldMap Learning Platform Recovery and Transformation Plan

**Status:** Proposed implementation specification  
**Prepared:** 13 July 2026  
**Repository:** `hsg100/LLM`  
**Intended repository path:** `docs/FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md`  
**Observed baseline:** `main` at `6016bc8181c74387bc52a5f4b4b9ae8dfa24d5ca` (Fable must verify the current head before starting)

---

## 1. Executive decision

FieldMap should become an interactive LLM learning and research platform. The proposed animated LLM explainer is not a separate product: it is the teaching layer currently missing from FieldMap.

The product should be repositioned as:

> **An interactive learning and research environment for understanding LLMs from first principles to current research.**

FieldMap will have three primary user-facing surfaces:

1. **Learn** — the product home: a structured LLM pathway, interactive lessons, animated demonstrations, checkpoints and progress.
2. **Research** — the existing FieldMap system: landscapes, papers, field maps, reading plans, PDF reading, synthesis and Obsidian export.
3. **Review** — cross-topic retrieval practice, weak-area recovery and FSRS-spaced repetition.

The current research product is valuable and should be preserved. It becomes a top-level Research workspace rather than being compressed into one page or replaced.

---

## 2. Why this is a transformation, not a second project

The repository already contains most of the difficult learning-engine infrastructure:

- arXiv and research-paper discovery;
- PDF parsing and structured extraction;
- ranking, clustering and paper relationships;
- concepts, definitions and prerequisite signals;
- landscape synthesis and reading paths;
- quizzes and flashcards;
- review attempts, weak areas and FSRS scheduling;
- mobile research navigation and a landscape-scoped shell;
- deterministic fallbacks when model calls fail;
- Obsidian export;
- an existing learning-pathways proposal in `TODO.md`.

What is missing is a coherent pedagogical surface:

- an intentional LLM curriculum;
- interactive concept demonstrations;
- lessons ordered by prerequisites;
- real curriculum progress;
- a useful product home;
- an explicit bridge from accessible explanation to primary research.

Building a second app would duplicate authentication, progress, concepts, review, research linking and deployment. Building the teaching layer inside FieldMap creates a differentiated product in which a learner can move from intuition, to mechanism, to assessment, to the underlying papers without changing systems.

---

## 3. Repository findings and implications

This plan is based on an inspection of the current repository. Fable must re-verify each finding against the current branch before implementation.

### 3.1 Existing strengths to preserve

- The FastAPI, SQLModel, PostgreSQL/pgvector and RQ backend is already separated from the Next.js frontend.
- The pipeline is deterministic-first: useful skeleton output exists even when an LLM call is unavailable.
- The current shell distinguishes global navigation from landscape-scoped navigation.
- `/` currently redirects to `/landscapes`, providing a clean place to introduce a new product home.
- Existing landscape routes are internally consistent and should remain valid during the first transformation stages.
- `Concept.prerequisites`, `PaperRelationship`, `LandscapePaper.reading_order` and cluster ordinals provide useful research-derived ordering signals.
- `ReviewAttempt`, `ReviewState` and the FSRS service provide a meaningful foundation for long-term retention.
- Backend tests and a frontend build gate already exist in CI.

### 3.2 Existing risks to account for

- Recovery documentation has recorded deployment/API drift and user-visible defects.
- Research jobs depend on external sources, model providers, PDF parsing and worker health.
- Current concepts are landscape-scoped; the curriculum needs stable, global concept identities.
- Existing quizzes and flashcards are research-landscape objects rather than curriculum lesson objects.
- Some current learning states are presentational rather than genuinely persisted.
- Previous plans include attractive but distracting features such as a contextual AI chat panel.
- A large route move or universal data-model rewrite would create unnecessary regression risk.

### 3.3 Architectural consequence

The learning system must work independently of the research pipeline while being enriched by it.

A learner opening an Attention lesson must not wait for arXiv search, PDF parsing or synthesis. Curated lesson content should render immediately. Related research should appear if available, build asynchronously if missing, and degrade gracefully if providers fail.

---

## 4. Product model and information architecture

### 4.1 Primary navigation

The primary product navigation should become:

- Home
- Learn
- Research
- Review
- Settings

Jobs and operational monitoring should remain accessible but should not occupy prime learner navigation.

### 4.2 Proposed routes

```text
/                              Learning dashboard
/learn                         LLM curriculum map
/learn/[topic]                 Topic overview
/learn/[topic]/[lesson]        Interactive lesson
/review                        Cross-topic review queue

/landscapes                    Existing research library
/landscape/[id]                Existing research overview
/landscape/[id]/map            Existing field map
/landscape/[id]/papers         Existing paper list
/landscape/[id]/reading-plan   Existing reading plan/depth-track precursor
/landscape/[id]/quiz           Existing landscape quiz
/landscape/[id]/flashcards     Existing landscape flashcards
/landscape/[id]/review         Existing landscape review
/landscape/[id]/export         Existing export
/paper/[id]                    Existing paper reader
```

Do not physically relocate the existing research routes in the first implementation. The new Research navigation item should link to `/landscapes`. This preserves bookmarks, route assumptions, current-landscape state and deployment stability.

### 4.3 Research workspace navigation

When the user enters a landscape, preserve the existing scoped navigation:

- Overview
- Field map
- Papers
- Reading/depth path
- Quiz
- Flashcards
- Review
- Obsidian export

The current research app therefore becomes a nested workspace under the product-level Research concept, not a single overloaded tab panel.

### 4.4 New home dashboard

The new `/` should answer three questions:

1. Where am I in the LLM pathway?
2. What should I do next?
3. What have I learned but need to review?

Suggested structure:

```text
Continue learning
Attention: How tokens exchange information
[Resume lesson — 8 minutes]

Your pathway
Foundations ✓  Tokens ✓  Embeddings ✓  Attention  Generation  Training ...

Due for review
7 concepts · approximately 5 minutes

Explore current research
RAG evaluation · Agents · Interpretability
```

The page should be organised around the learner's next action, not around creating or managing database objects.

---

## 5. Curriculum architecture

### 5.1 Core decision: curriculum in Git, progress in PostgreSQL

Canonical curriculum content must be curated, reviewable and version-controlled. It should not be invented live by an LLM or stored only as mutable JSON in the database.

Recommended structure:

```text
curriculum/
  curriculum.yaml
  concepts/
    token.yaml
    embedding.yaml
    attention.yaml
  topics/
    tokenisation.yaml
    embeddings.yaml
    attention.yaml
    generation.yaml
  lessons/
    tokens-and-tokenisers.mdx
    embedding-space.mdx
    attention-routing.mdx
    sampling-controls.mdx
```

The exact location may be adjusted to suit the monorepo, but curriculum content must have one canonical, validated source.

### 5.2 Topic contract

Each topic should declare at least:

```yaml
slug: attention
title: Attention
summary: How tokens selectively exchange information.
prerequisites:
  - tokens
  - embeddings
learning_objectives:
  - Explain queries, keys and values at an intuitive level
  - Interpret a simple attention matrix
  - Predict how causal masking changes information flow
lessons:
  - attention-intuition
  - attention-calculation
  - causal-masking
research_queries:
  - transformer attention mechanisms
```

### 5.3 Lesson contract

Each lesson should include:

- stable slug and version;
- topic and prerequisite concept slugs;
- learning objectives;
- estimated duration;
- narrative content;
- interactive demo IDs;
- prediction prompts;
- checkpoint specification;
- citations and further reading;
- reduced-motion/plain-text fallback requirements.

Example lesson metadata:

```yaml
slug: attention-intuition
topic: attention
version: 1
duration_minutes: 10
objectives:
  - Explain why attention is content-dependent routing
demos:
  - attention-token-links
checkpoint:
  kind: concept-check
  pass_score: 0.8
sources:
  - id: vaswani-2017
    url: https://arxiv.org/abs/1706.03762
```

### 5.4 Canonical concepts

The current `Concept` table is landscape-scoped. Do not destructively convert it into the curriculum registry.

Introduce a canonical concept layer with stable slugs such as:

- `token`
- `embedding`
- `position`
- `attention`
- `causal-mask`
- `context-window`
- `kv-cache`
- `sampling`

Research-derived landscape concepts should be linkable to canonical concept slugs through an explicit mapping. This permits the curriculum to remain stable even as landscapes are rebuilt.

### 5.5 Validation

CI should fail when:

- a prerequisite slug does not exist;
- the curriculum graph contains a cycle;
- a lesson references an unknown demo;
- a checkpoint references an unknown concept;
- a citation lacks a required identifier or URL;
- topic or lesson slugs collide;
- required fallbacks are absent.

---

## 6. Interactive lesson engine

### 6.1 Learning loop

Every lesson should follow a consistent teaching loop:

1. Present the intuition.
2. Ask the learner to predict what will happen.
3. Let the learner manipulate the mechanism.
4. Show the consequence.
5. Explain why it happened.
6. Offer the formal/technical layer.
7. Check understanding.
8. Connect the concept to primary research.

The product should not be a collection of autoplaying animations. Interaction and prediction are what turn visual content into learning.

### 6.2 Reusable runtime

Recommended component structure:

```text
LessonPage
├── LessonHeader
├── LessonNarrative
├── PredictionPrompt
├── InteractiveDemo
├── TechnicalExpansion
├── EvidenceAndSources
├── Checkpoint
└── LessonCompletion
```

Interactive demos should be registered by stable ID rather than imported ad hoc by each lesson. A typed registry lets the content validator confirm that every requested demonstration exists.

### 6.3 Rendering technology

Use the smallest appropriate browser technology:

- CSS and SVG for most diagrams and transitions;
- a React animation library for timelines and state transitions;
- D3 modules only for scales, layouts or dense data visualisation;
- Canvas only when SVG performance is inadequate;
- KaTeX for mathematical notation and progressive formal explanations;
- WebGL only after a demonstrated need.

Do not introduce a large graphics stack globally for the first vertical slice.

### 6.4 Demo requirements

Every interactive demonstration must support:

- mobile widths from 360px upward;
- touch and pointer input;
- keyboard operation where meaningful;
- replay/reset;
- deterministic starting state;
- visible focus states;
- reduced-motion mode;
- a text/table fallback that conveys the same learning point;
- bounded CPU and memory usage;
- lazy loading so lesson JavaScript does not inflate every route.

---

## 7. First vertical slice

Do not begin by creating shallow pages for the full curriculum. Build one complete, high-quality sequence.

### 7.1 Unit: How an LLM generates text

The unit should connect these mechanisms:

1. Text becomes tokens.
2. Tokens become vectors.
3. Position information is added.
4. Attention moves information between tokens.
5. The model produces next-token probabilities.
6. Sampling selects the next token.

The same learner-provided sentence should travel through the sequence so that the lessons feel like one explanatory system rather than disconnected demos.

### 7.2 Tokenisation laboratory

- Accept learner-entered text.
- Animate text splitting into tokens.
- Reveal token IDs and optional byte representation.
- Compare words, rare terms, numbers, punctuation and emoji.
- Connect token count to context and cost.
- Clearly distinguish the chosen tokenizer from tokenization in general.

### 7.3 Embedding-space explorer

- Display a small, curated embedding dataset.
- Let the learner inspect similarity and neighbours.
- Ask the learner to predict clusters before revealing them.
- Explain that any 2D layout is a projection rather than the model's actual high-dimensional space.
- Avoid presenting semantic geometry as perfectly stable or universal.

### 7.4 Attention explorer

- Display token-to-token connections with variable weights.
- Allow token selection.
- Toggle between heads or curated patterns.
- Toggle causal masking.
- Provide intuitive and mathematical views.
- Avoid suggesting that raw attention weight is a complete explanation of model reasoning.

### 7.5 Sampling laboratory

- Show a next-token probability distribution.
- Allow temperature and top-p manipulation.
- Ask the learner to predict the direction of change.
- Generate repeated samples so diversity is observable.
- Distinguish changes to the distribution from the random sampling event.

### 7.6 Vertical-slice success condition

A learner can:

- begin from the home page;
- complete all four interactive lessons;
- understand how the lessons connect;
- pass a checkpoint;
- leave and resume on another session;
- receive an appropriate review item;
- open related foundational research without being blocked by a research job.

---

## 8. Research integration

### 8.1 Related research panel

Each topic should expose a Research deeper section with:

- foundational papers;
- associated FieldMap landscape;
- current debates and limitations;
- recent developments;
- open problems;
- an action to build or refresh the landscape.

### 8.2 Non-blocking enrichment

Required behaviour:

1. Curated lesson loads immediately.
2. Existing related landscape is displayed if available.
3. Missing or stale research can build asynchronously.
4. The learner continues while the job runs.
5. Research appears when ready.
6. Provider failure leaves the lesson intact and explains that enrichment could not be refreshed.

### 8.3 Landscape resolution

Do not resolve curriculum topics by fragile title equality alone. Introduce an explicit association between a curriculum topic slug and an optional landscape ID, plus refresh/version metadata.

### 8.4 Depth tracks

After the breadth pathway is proven, evolve the current reading-plan page into a depth pathway:

```text
Learn core concept
→ Read foundational paper
→ Compare later methods
→ Inspect benchmarks and criticism
→ Complete synthesis checkpoint
```

Depth ordering can reuse:

- prerequisite paper relationships;
- cluster ordinals;
- paper reading order;
- importance/category;
- recency and score;
- deterministic skeleton plus optional LLM rationale.

---

## 9. Learner state, mastery and review

### 9.1 Minimal new state model

Begin with narrowly scoped learner-state tables rather than a universal learning schema:

- `CurriculumProgress`
- `LessonProgress`
- `LessonAttempt`
- `CheckpointAttempt`

Exact names may be adjusted to repository conventions. Required properties include user, stable curriculum/lesson version, status, score, timestamps and resumable interaction position where appropriate.

### 9.2 Defer universal Exercise migration

The existing `Quiz` and `Flashcard` tables already work with the FSRS review loop. Do not migrate every learning object to a new universal `Exercise` table during the first vertical slice.

Instead:

- add curriculum associations to existing reviewable items where safe;
- introduce one narrowly defined checkpoint representation;
- observe actual needs from interactive lessons;
- design a unified model only when multiple stable exercise types justify it.

### 9.3 Mastery behaviour

Initial rule:

- a checkpoint score of at least 80% marks the lesson/topic as mastered;
- failure recommends a specific explanation or review action;
- prerequisites are strongly recommended;
- users may override progression with a clear warning.

Do not hard-lock the entire pathway until checkpoint quality has been validated. Poorly calibrated assessments would trap capable learners and make the platform feel arbitrary.

### 9.4 FSRS integration

Reuse the existing review system so that:

- lesson checkpoint concepts can create reviewable items;
- research-derived and curriculum-curated items remain visibly distinguishable;
- weak areas map to canonical concept slugs;
- the home dashboard recommends due review;
- the next-action engine considers both pathway progress and retention.

---

## 10. Initial curriculum map

The planned long-term curriculum is:

1. What language models do
2. Tokens and tokenisation
3. Embeddings and representation
4. Neural-network foundations
5. Transformer architecture
6. Attention
7. Training and next-token prediction
8. Inference and sampling
9. Context windows and KV cache
10. Instruction tuning and PEFT
11. Alignment, RLHF and DPO
12. Evaluation and hallucination
13. Embeddings, retrieval and RAG
14. Tools, agents and memory
15. Reasoning and test-time compute
16. Efficiency and serving
17. Multimodality
18. Safety and interpretability

Only topics 1–8 need to be active for the first public curriculum. Later topics may be displayed as planned only if the UI makes their status unambiguous. Do not launch hollow placeholder lessons.

---

## 11. Phased execution plan

### Phase 0 — Establish a trustworthy baseline

**Goal:** Make the current system reproducible and distinguish inherited defects from new work.

Tasks:

1. Verify current `main`, deployment configuration and repository instructions.
2. Create a dedicated feature/recovery branch; do not work directly on `main`.
3. Record current environment and dependency versions.
4. Back up the production database before any schema migration.
5. Run backend lint/tests, migrations and frontend build from a clean checkout.
6. Exercise login, landscapes, jobs, papers, quizzes, flashcards, review and export.
7. Capture desktop/mobile screenshots or equivalent visual baseline.
8. Consolidate known defects from recovery documentation into blocking, relevant and deferred groups.
9. Add missing route/API contract tests required to trust the baseline.

**Exit gate:** A clean checkout can start, migrate and exercise the existing core journey without undocumented manual repair.

### Phase 1 — Introduce the learning-first shell

**Goal:** Change product hierarchy without relocating or rewriting the research app.

Tasks:

1. Replace the root redirect with a learning dashboard shell.
2. Add product-level Home, Learn, Research and Review navigation.
3. Link Research to the existing `/landscapes` route.
4. Preserve landscape-scoped navigation when inside research routes.
5. Update mobile bottom navigation consistently.
6. Add empty/loading/error states appropriate to a learner home.
7. Update metadata/positioning from “Research OS” to the new learning-and-research proposition while retaining the FieldMap name.
8. Add route and navigation tests, including bookmarked old routes.

**Exit gate:** Every existing surface remains reachable, while a first-time user can identify the learning pathway as the product's primary experience.

### Phase 2 — Add the curriculum and progress foundation

**Goal:** Create the versioned curriculum contract and persisted learner state.

Tasks:

1. Add curriculum/topic/lesson/concept schemas and validators.
2. Seed the first unit and its canonical concepts.
3. Add cycle and broken-reference validation to CI.
4. Add minimal progress/checkpoint migrations.
5. Add read APIs for curriculum and authenticated progress.
6. Add idempotent progress/checkpoint write APIs.
7. Render `/learn` and topic/lesson routes from the canonical curriculum source.
8. Ensure the content renders when the backend, worker or model provider is unavailable.

**Exit gate:** The curriculum and static lesson shell render deterministically; authenticated progress persists; invalid curriculum cannot merge.

### Phase 3 — Deliver the interactive vertical slice

**Goal:** Ship one excellent end-to-end learning unit.

Tasks:

1. Build the typed interactive-demo registry.
2. Build reusable lesson runtime components.
3. Implement tokenisation, embeddings, attention and sampling demos.
4. Use one learner-provided sentence across the connected journey where technically sensible.
5. Add prediction prompts and checkpoints.
6. Add reduced-motion and plain-text fallbacks.
7. Add mobile, keyboard and performance tests.
8. Persist completion and resumption.

**Exit gate:** A learner can complete the unit, pass its checkpoint, resume progress and understand the relationship between its mechanisms.

### Phase 4 — Connect lessons to FieldMap research

**Goal:** Bridge approachable learning and current research without coupling their availability.

Tasks:

1. Add curriculum-topic-to-landscape associations.
2. Build the Related research panel.
3. Link curated foundational sources.
4. Add asynchronous build/refresh status.
5. Guarantee lessons remain usable when research enrichment fails.
6. Add observability and tests for topic resolution and failed jobs.
7. Begin converting the reading-plan page into an optional depth-track surface.

**Exit gate:** Every active curriculum topic can connect to research while neither the lesson nor research system blocks the other.

### Phase 5 — Integrate mastery and cross-topic review

**Goal:** Make the platform retain learning rather than merely present it.

Tasks:

1. Connect lesson concepts and checkpoint outcomes to reviewable items.
2. Extend FSRS item support only as required by the proven lesson types.
3. Build global `/review` and weak-area recommendations.
4. Add next-best-action logic to the home dashboard.
5. Distinguish curated curriculum items from generated research items.
6. Validate the initial 80% mastery rule and override experience.

**Exit gate:** The system can explain why it recommends the learner's next lesson or review action.

### Phase 6 — Harden and release

**Goal:** Make the new product home safe to release.

Tasks:

1. Rehearse production migration and rollback.
2. Add route compatibility and curriculum validation gates.
3. Add visual regression coverage for core lesson states.
4. Test 360–430px mobile widths and representative desktop widths.
5. Complete keyboard, focus and reduced-motion QA.
6. Enforce bundle/performance budgets and lazy loading.
7. Instrument lesson starts, completions, resets, checkpoint failures and research-link use.
8. Review every lesson for factual accuracy, caveats and source quality.
9. Release `/learn` behind a preview flag, then expose navigation, then make `/` the learning home.

**Exit gate:** The release is reversible, observable, accessible and does not regress the existing research workflow.

---

## 12. Testing strategy

### 12.1 Backend

- Unit tests for curriculum parsing and validation.
- DAG cycle and missing-reference tests.
- Progress/checkpoint API contract tests.
- Migration upgrade and downgrade tests where the repository supports them.
- Auth and user-isolation tests.
- Research-enrichment failure tests.
- FSRS regression tests when item support changes.

### 12.2 Frontend

- Next.js production build on every PR.
- Component tests for lesson state and controls.
- Route/navigation tests for new and legacy paths.
- Demo deterministic-state tests.
- Accessibility tests for labels, focus and keyboard controls.
- Reduced-motion tests.
- Mobile overflow and touch interaction tests.
- Error/loading/empty state coverage.

### 12.3 End to end

Critical journey:

1. Log in.
2. Open home.
3. Start first lesson.
4. Interact with a demo.
5. Complete checkpoint.
6. Resume later.
7. Review a concept.
8. Open associated research.
9. Continue learning even if research refresh fails.

### 12.4 Content quality

- Human-review the initial learning objectives and explanations.
- Source every durable technical claim.
- Mark simplifications and projection artefacts explicitly.
- Avoid equating attention visualisation with complete mechanistic explanation.
- Test explanations with beginner and technically experienced readers.

---

## 13. Migration and compatibility rules

1. Never delete or rewrite existing user landscapes as part of curriculum introduction.
2. Preserve old URLs during the initial transformation.
3. Prefer additive migrations.
4. Back up production data before applying new migrations.
5. Keep curriculum content deployable without database seeding that can drift independently.
6. Version lesson content so progress semantics remain interpretable after edits.
7. Do not silently remap research concepts to curriculum concepts; mappings must be explicit and auditable.
8. Do not make an external model call a prerequisite for opening a lesson.
9. Keep rollback instructions with every phase that changes runtime or data.

---

## 14. Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Big-bang rewrite | Existing research product regresses | Add learning shell around current routes; migrate incrementally |
| Curriculum generated live | Incorrect or inconsistent teaching order | Curated, Git-versioned DAG with CI validation |
| Landscape pipeline blocks lessons | Slow or broken learning experience | Non-blocking asynchronous enrichment |
| Over-generalised data model | Long migration with unclear value | Minimal progress model; defer universal Exercise table |
| Attractive feature sprawl | Core learning loop never becomes excellent | Freeze AI chat, social and broad gamification until vertical slice passes |
| Animation without pedagogy | Beautiful but passive content | Prediction → manipulation → consequence → explanation → checkpoint loop |
| Mobile/performance problems | Primary usage becomes frustrating | SVG-first, lazy demos, budgets and mobile gates |
| Hard gating is poorly calibrated | Learners become trapped | Soft prerequisite guidance and override during validation |
| Research and curriculum concepts drift | Incorrect progress/review links | Stable canonical slugs plus explicit mappings |
| Content oversimplifies model behaviour | Learners gain false confidence | Sources, caveats, technical expansions and review |

---

## 15. Explicitly deferred work

Until the first vertical slice works, defer:

- general-purpose contextual AI chat;
- dynamically generated curriculum structure;
- user-customisable curriculum builders;
- social features, leaderboards and broad streak gamification;
- a universal Exercise-table migration;
- wholesale renaming or movement of research routes;
- complex WebGL/3D visualisation;
- automatic research jobs that block lessons;
- broad visual redesign of every legacy page;
- all eighteen topics as shallow placeholders.

Existing defect fixes that protect the core experience—such as jobs API contracts, flashcard readability and meaningful cluster labels—remain in scope when they block a phase.

---

## 16. Delivery and Git strategy

### 16.1 Branch and PR discipline

- Work from the latest verified `main`.
- Use a dedicated feature branch; do not commit directly to `main`.
- Open a draft PR early so the transformation is visible and reviewable.
- Keep phase commits coherent and reversible.
- Do not mix unrelated cleanup into recovery commits.
- Record assumptions and deviations in the PR description and this document.

### 16.2 Recommended initial commits

1. `docs: add learning platform recovery plan`
2. `test: establish recovery baseline contracts`
3. `feat(shell): add learning-first product navigation`
4. `feat(home): introduce learner dashboard foundation`
5. `docs: record phase 0 and phase 1 verification results`

Phase 2 should begin only after the Phase 1 exit gate is demonstrably met.

### 16.3 Required reporting after each phase

- What changed.
- Files and migrations affected.
- Tests and manual checks run.
- Known limitations.
- Any deviation from this plan and why.
- Rollback instructions.
- Whether the phase exit gate passed.
- The next proposed phase.

---

## 17. Success measures

### Product

- A new user understands the product without knowing what a research landscape is.
- Users can begin the first lesson from `/` in one action.
- Existing research users can reach landscapes without additional confusion.
- Lessons continue to work during research-provider failures.

### Learning

- Users complete the first connected unit.
- Checkpoint performance improves after targeted review.
- Users can correctly explain the relationship between tokens, embeddings, attention and sampling.
- Learners open primary research after completing accessible explanations.

### Engineering

- Existing research routes and data remain intact.
- Invalid curriculum cannot pass CI.
- New migrations are reversible or have explicit recovery instructions.
- Interactive demos remain within agreed performance budgets.
- No lesson requires an external model call to render.

---

## 18. Final definition of done

The transformation is complete when:

1. FieldMap opens to a useful learning dashboard.
2. Learn, Research and Review are coherent parts of one product.
3. The first LLM unit teaches a connected mechanism through genuine interaction.
4. Learner progress and checkpoints persist.
5. Review uses the existing FSRS foundation.
6. Curriculum concepts link cleanly to related FieldMap research.
7. Research enrichment is asynchronous and failure-tolerant.
8. Existing landscapes, paper reading and Obsidian export continue to work.
9. The system is accessible, mobile-capable, observable and reversible.
10. Further topics can be added through validated content contracts rather than bespoke page construction.

The central implementation principle is:

> **Teach immediately, enrich with research asynchronously, and preserve the working research engine throughout the transformation.**

