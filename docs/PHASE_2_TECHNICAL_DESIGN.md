# Phase 2 Technical Design — Curriculum & Progress Foundation

**Status:** DESIGN FOR APPROVAL — no branch, migration or implementation exists yet.
**Governing spec:** [`FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md`](./FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md) §5, §9, §11 (Phase 2)
**Baseline:** `main` at `d5438fd` (Phases 0–1 merged, PR #7)
**Locked product decisions this design implements:** repo-root `curriculum/`; YAML contracts + Markdown lessons with validated frontmatter; demo IDs as metadata only (no executable MDX/JSX, no demo implementations); exactly three progress tables (`CurriculumProgress`, `LessonProgress`, `CheckpointAttempt` — **no** `LessonAttempt`); canonical concepts in Git only (no changes to the landscape `Concept` table, no landscape↔canonical mapping until Phase 4); Phase 2 ships on a fresh branch as a separate draft PR.

---

## 1. Architecture overview

```
Git (single source of truth)                     Consumers
────────────────────────────                     ─────────
curriculum/
  curriculum.yaml      ─┐
  schemas/              │  python -m curriculum_tools.build
  concepts/*.yaml       ├────────────────────────────────►  curriculum/build/catalog.json
  topics/*.yaml         │  (validate + compile;                 (committed, immutable per
  lessons/*.md          ─┘   CI drift-gate)                      commit, content-hashed)
                                                                   │
                                              ┌────────────────────┴──────────────────┐
                                              ▼                                       ▼
                                   Next.js (Vercel)                        FastAPI (VPS Docker)
                                   imports catalog.json at build           loads catalog.json at startup
                                   → /learn pages statically               → validates progress writes,
                                     generated, zero backend                 serves progress APIs,
                                     dependency                              reports version on /ready
                                                                                    │
                                                                                    ▼
                                                                          PostgreSQL (progress only:
                                                                          3 new tables, migration 0007)
```

One compiler, one committed artifact, two read-only consumers. PostgreSQL stores
learner state only — never curriculum content (spec §5.1).

---

## 2. Curriculum parsing and build/runtime ownership

### Decision

A single Python package, `curriculum_tools` (living at repo root next to
`curriculum/`, installed into the api dev environment), owns **all** parsing and
validation. It has two entry points:

- `python -m curriculum_tools.validate` — runs every check in §10 and exits
  non-zero with per-file, per-rule errors.
- `python -m curriculum_tools.build` — validate, then compile the sources into
  one deterministic artifact: `curriculum/build/catalog.json` (stable key
  ordering, no timestamps, plus a `content_hash` of the source tree so identical
  sources always produce byte-identical output).

The compiled catalogue **is committed to Git**. CI recompiles and fails if the
committed artifact differs from the sources (a lockfile-style drift gate,
mirroring the repo's existing Alembic drift-check idiom).

Neither Next.js nor FastAPI ever parses YAML/Markdown at runtime. Next.js
imports the JSON at build time; FastAPI loads it once at startup into an
immutable in-memory index.

### Why build-time compilation with a committed artifact

The deployment split is Vercel (Node-only build) for the web app and a VPS
Docker image (Python-only) for the api. Any "parse at build" scheme therefore
needs either the compiler in both languages or one language's toolchain
injected into the other's build. Committing the compiled artifact removes the
problem: both builds consume plain JSON with zero new toolchain requirements,
the deployed catalogue is reviewable in the PR diff, and the drift gate makes
hand-editing the artifact impossible to merge.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| FastAPI parses YAML at runtime; Next.js fetches via API | `/learn` would depend on backend availability — violates spec §11 Phase 2 task 8 and §13.8 (lessons must render when the backend is down) |
| Two parsers (TS for web, Python for api) over the raw YAML | Duplicated truth in two languages — exactly the drift class the recovery plan §2.5/§3.8 spent Sprint 7 eliminating for concept annotation |
| Compile during each build, artifact not committed | Vercel build lacks Python; api image lacks Node; CI-only artifact would need artifact-passing infrastructure the repo doesn't have |
| Executable MDX lessons | Locked out by product decision (no executable lesson content in Phase 2); also widens the review/audit surface for content PRs |
| Store curriculum in PostgreSQL, seeded by migration | Spec §5.1 explicitly forbids DB-as-source (drift between environments, unreviewable content changes) |

---

## 3. Source formats and contracts

### 3.1 Layout (as locked)

```
curriculum/
  curriculum.yaml          # curriculum manifest: slug, version, ordered topic slugs
  schemas/                 # JSON Schema files for each contract (editor + CI use)
    curriculum.schema.json
    topic.schema.json
    concept.schema.json
    lesson-frontmatter.schema.json
  concepts/<slug>.yaml     # canonical concepts (Git-only in Phase 2)
  topics/<slug>.yaml       # topic contracts
  lessons/<slug>.md        # Markdown narrative + validated YAML frontmatter
  build/catalog.json       # compiled artifact (committed; drift-gated)
```

### 3.2 Contracts (spec §5.2–§5.4, constrained to Phase 2)

`curriculum.yaml`: `slug`, `title`, `version` (integer), `topics` (ordered list
of topic slugs; presence + order is the pathway).

`topics/<slug>.yaml`: `slug`, `title`, `summary`, `status`
(`active | planned`), `prerequisites` (topic slugs), `learning_objectives`,
`lessons` (ordered lesson slugs; empty allowed only when `planned`),
`concepts` (canonical concept slugs introduced by the topic).

`concepts/<slug>.yaml`: `slug`, `name`, `short_definition`, `prerequisites`
(concept slugs). Deliberately minimal; enrichment belongs to later phases.

`lessons/<slug>.md` frontmatter: `slug`, `topic`, `version` (integer),
`duration_minutes`, `objectives`, `concepts`, `demos` (list of **stable demo
IDs — strings only**; implementations are Phase 3), `demo_fallbacks` (required
map: demo ID → plain-text fallback conveying the same point), `checkpoint`
(`slug`, `kind: concept-check`, `pass_score`, `questions`: MCQ list with
`id`, `prompt`, `options`, `correct_index`, `concept`), `sources` (each with
`id` and `url` required). Body: plain Markdown split by the compiler into
ordered blocks at `##` headings; block IDs are slugified headings, uniqueness
enforced — these IDs are the resumable positions stored in
`LessonProgress.last_block_id`.

Because checkpoint answer keys live in the catalogue, the compiler emits **two
views** of each checkpoint: the public view (no `correct_index`) placed in the
main catalogue consumed by the web build, and a grading view in a separate
`catalog.grading.json` **not** imported by the frontend and only read by the
api. This keeps answers out of the client bundle while preserving one compiler.

Demo IDs must appear in `curriculum/schemas/demo-registry.yaml` — in Phase 2 a
plain declared-IDs manifest (the typed runtime registry is Phase 3), so
"lesson references an unknown demo" is CI-checkable now.

---

## 4. Docker and production packaging

Current constraint: both compose files build the api with context
`./apps/api`, so a repo-root `curriculum/` would not reach the image.

**Decision:** change the api/worker service build context to the repo root
with an explicit dockerfile path —

```yaml
build:
  context: .
  dockerfile: apps/api/Dockerfile
```

and in `apps/api/Dockerfile`, copy the app as today plus
`COPY curriculum/build/ /app/curriculum/build/`. A new setting
`curriculum_catalog_path` (default: repo-relative `curriculum/build/` for
local dev/tests; `/app/curriculum/build/` via env in the images) tells the api
where to load `catalog.json` and `catalog.grading.json` from. Startup fails
loudly if the catalogue is missing or its `content_hash` doesn't match its
contents; `/ready` gains `curriculum_version` and `curriculum_hash` fields.

Vercel: the web project already builds from the monorepo; `apps/web` imports
`../../curriculum/build/catalog.json` directly (JSON import, statically
bundled). No Vercel configuration change expected; verified in the Phase 2 PR
preview.

**Version-skew policy:** web and api may briefly serve different commits'
catalogues during a deploy. Writes are validated against the **api's**
catalogue; slugs are stable and versions only ever appear (never mutate), so
the failure mode is a 422 on a just-removed version, surfaced honestly in the
UI. Deploy order: api first, then web.

Alternative considered: keep the `apps/api` context and copy `curriculum/`
into `apps/api/` at build via a Makefile step — rejected as an invisible,
easy-to-forget mutation of the build inputs; an explicit context is the
standard compose answer and a two-line diff per compose file.

---

## 5. Progress data model — exact DDL (Alembic migration `0007_learning_progress`)

Conventions follow the existing models (`ReviewState`/`ReviewAttempt`): string
UUID PKs, `users.id` FKs, naive-UTC timestamps, SQLModel table classes.

```sql
CREATE TABLE curriculum_progress (
    id                 VARCHAR PRIMARY KEY,
    user_id            VARCHAR NOT NULL REFERENCES users(id),
    curriculum_slug    VARCHAR NOT NULL,
    curriculum_version INTEGER NOT NULL,
    status             VARCHAR NOT NULL DEFAULT 'active',       -- active | completed
    current_topic_slug VARCHAR NULL,
    started_at         TIMESTAMP NOT NULL,
    completed_at       TIMESTAMP NULL,
    updated_at         TIMESTAMP NOT NULL,
    CONSTRAINT uq_curriculum_progress UNIQUE (user_id, curriculum_slug, curriculum_version),
    CONSTRAINT ck_curriculum_progress_status CHECK (status IN ('active','completed'))
);
CREATE INDEX ix_curriculum_progress_user_id ON curriculum_progress (user_id);

CREATE TABLE lesson_progress (
    id                    VARCHAR PRIMARY KEY,
    user_id               VARCHAR NOT NULL REFERENCES users(id),
    lesson_slug           VARCHAR NOT NULL,
    lesson_version        INTEGER NOT NULL,
    status                VARCHAR NOT NULL DEFAULT 'in_progress', -- in_progress | completed
    last_block_id         VARCHAR NULL,                           -- resumable position
    best_checkpoint_score DOUBLE PRECISION NULL,                  -- 0.0–1.0
    started_at            TIMESTAMP NOT NULL,
    completed_at          TIMESTAMP NULL,
    updated_at            TIMESTAMP NOT NULL,
    CONSTRAINT uq_lesson_progress UNIQUE (user_id, lesson_slug, lesson_version),
    CONSTRAINT ck_lesson_progress_status CHECK (status IN ('in_progress','completed')),
    CONSTRAINT ck_lesson_progress_score CHECK (
        best_checkpoint_score IS NULL OR (best_checkpoint_score >= 0 AND best_checkpoint_score <= 1))
);
CREATE INDEX ix_lesson_progress_user_id ON lesson_progress (user_id);
CREATE INDEX ix_lesson_progress_user_status ON lesson_progress (user_id, status, updated_at);
                                              -- "continue learning" dashboard query

CREATE TABLE checkpoint_attempts (
    id                VARCHAR PRIMARY KEY,
    user_id           VARCHAR NOT NULL REFERENCES users(id),
    lesson_slug       VARCHAR NOT NULL,
    lesson_version    INTEGER NOT NULL,
    checkpoint_slug   VARCHAR NOT NULL,
    score             DOUBLE PRECISION NOT NULL,
    passed            BOOLEAN NOT NULL,
    responses         JSONB NULL,            -- submitted answers + per-question evaluation
    client_attempt_id VARCHAR NULL,          -- idempotency key (client-generated UUID)
    created_at        TIMESTAMP NOT NULL,
    CONSTRAINT uq_checkpoint_attempt_client UNIQUE (user_id, client_attempt_id)
);
CREATE INDEX ix_checkpoint_attempts_user_lesson
    ON checkpoint_attempts (user_id, lesson_slug, lesson_version, created_at);
```

Notes: `checkpoint_attempts` is append-only — no `updated_at`, no UPDATE path
in code. No FK to curriculum entities (they are files); slug+version validity
is enforced at the API layer against the loaded catalogue. `LessonAttempt` is
intentionally absent per the locked decision; `lesson_progress` carries the
resumable position and `checkpoint_attempts` the assessment history.
Reconsidered only in Phase 3 with demonstrated analytics need.

**Downgrade:** `DROP TABLE` × 3 (order: attempts, lesson, curriculum). Purely
additive upgrade; no existing table is touched.

---

## 6. Versioning semantics

- `curriculum_version` (from `curriculum.yaml`) and `lesson_version` (per
  lesson frontmatter) are integers, bumped **only** on changes that alter
  progress semantics: objectives, checkpoint questions/threshold, block
  structure (renamed/removed block IDs), topic membership. Typo/copy fixes do
  not bump.
- Progress rows are keyed to (slug, version). A version bump therefore starts
  a fresh row; prior rows remain forever interpretable (spec §13.6). Read APIs
  return the caller's rows for the deployed versions plus a
  `completed_prior_version` flag computed from older rows, so the UI can say
  "completed v1" honestly instead of silently zeroing progress.
- Slugs are immutable and never reused; retirement = topic `status: planned`
  removal path is forbidden — a released topic may only move `active →
  retired` (field exists in the enum from day one, rendering as "no longer
  offered").
- The api rejects writes referencing a (slug, version) not present in its
  catalogue with 422 and the known-version list, so stale clients degrade
  loudly, not corruptly.

---

## 7. API contracts

All under the existing router/auth stack. **Reads of curriculum content have
no API** — content ships in the web bundle; the api serves only learner state.

| Method & path | Auth | Semantics |
|---|---|---|
| `GET /api/learn/progress` | Bearer | All progress for the authenticated user: curriculum rows + lesson rows + last 20 checkpoint attempts. One round-trip for the dashboard/`/learn`. |
| `PUT /api/learn/lessons/{lesson_slug}/progress` | Bearer | **Idempotent upsert** on (user, slug, `lesson_version` from body). Body: `{lesson_version, last_block_id?, status?}`. Server sets `started_at` on first write, `updated_at` always; `status` may only move `in_progress → completed` via checkpoint pass (direct `completed` writes rejected 422); repeating a request yields the identical row. Invalid slug/version/block-id vs catalogue → 422. |
| `POST /api/learn/lessons/{lesson_slug}/checkpoint-attempts` | Bearer | Body: `{lesson_version, checkpoint_slug, responses: {question_id: option_index}, client_attempt_id}`. Server grades against `catalog.grading.json`, inserts the append-only attempt, updates `lesson_progress.best_checkpoint_score`/`status` and the derived `curriculum_progress` row transactionally. **Idempotent** via `uq_checkpoint_attempt_client`: a retried `client_attempt_id` returns the original result (200, `duplicate: true`) with no second insert. Response: `{score, passed, per_question, best_checkpoint_score, lesson_status}`. |

`curriculum_progress` is **server-maintained only** (created on first lesson
write; `current_topic_slug` = topic of the most recently touched lesson;
`completed` when every lesson of every `active` topic is completed). No direct
client write — fewer contracts, no client/server disagreement about pathway
state.

### Authentication and user isolation

- Reuses `get_current_user` (Bearer token; `require_auth=false` dev fallback
  to the default user, matching the review loop).
- `user_id` is always taken from the token, never the body.
- Every query filters by `user_id`; contract tests must include a two-user
  isolation test (user B cannot read or affect user A's rows) and a
  401-without-token test per endpoint, mirroring `test_review_fsrs.py` idioms.
- Unlike landscapes (deliberately a shared library), learner progress is
  strictly per-user from day one.

---

## 8. Backup, migration, downgrade and rollback procedure

Ordered production procedure (spec §13.4/§13.9):

1. `make prod-backup-db` (`scripts/backup_db.sh`) — **mandatory before
   applying 0007**; Phases 0–1 shipped no migration, so this is the first
   schema change of the transformation.
2. `alembic upgrade head` on the VPS (additive only; existing tables
   untouched; `/ready` confirms `schema_rev == schema_head`).
3. Deploy api image (new compose build context + catalogue baked in).
4. Deploy web (Vercel) from the same commit.

Rollback tiers:
- **Code-only rollback (preferred):** revert the Phase 2 commits / redeploy
  the previous images. The three new tables are inert to old code — no
  downgrade required, no data lost.
- **Full rollback:** `alembic downgrade -1` drops the three tables — loses
  learner progress only (documented, acceptable in Phase 2), never research
  data.
- CI runs `upgrade head` + `downgrade -1` + `upgrade head` against pgvector
  PG16 to prove both directions before merge.

---

## 9. Validation and CI strategy

Backend CI job gains two steps (before pytest):
`python -m curriculum_tools.validate` and a drift gate
(`python -m curriculum_tools.build --check` fails if `curriculum/build/*` ≠
recompiled output).

Validator rule classes (each with a red-path fixture test so "invalid
curriculum cannot merge" is itself tested, spec §5.5):

1. Schema violations (missing/unknown fields, wrong types) per contract.
2. Unknown slug references: topic→topic prereqs, topic→lesson, topic/lesson→concept, concept→concept prereqs, curriculum→topic.
3. Duplicate slugs across curriculum/topics/lessons/concepts; duplicate block IDs within a lesson.
4. Cycles in the topic-prerequisite and concept-prerequisite graphs (topological sort).
5. Unknown demo IDs (not in `demo-registry.yaml`).
6. Missing demo fallbacks (`demos` ⊄ `demo_fallbacks` keys).
7. Citations missing `id` or `url`; checkpoint questions with out-of-range `correct_index`; `pass_score` outside (0,1]; `active` topics with zero lessons.

Backend pytest additions: catalogue-load tests, progress/checkpoint contract
tests (idempotency: same `client_attempt_id` twice → one row; same PUT twice →
identical row), auth/user-isolation tests, migration up/down test.
Frontend vitest additions: `/learn`, `/learn/[topic]`, `/learn/[topic]/[lesson]`
render from the bundled catalogue with the api mocked away (proving
backend-independence), unknown-slug 404s, and "progress unavailable" states
when progress fetches fail.

---

## 10. Phase 2 acceptance criteria (exit gate)

1. `/learn`, `/learn/[topic]` and `/learn/[topic]/[lesson]` render
   deterministically from the committed catalogue **with the api, worker and
   model provider all unavailable** (static content + honest
   "progress unavailable" notice).
2. Authenticated lesson progress (including `last_block_id` resume position)
   and checkpoint attempts persist across sessions and api restarts.
3. Both write APIs are demonstrably idempotent (retried requests produce
   byte-identical state; attempts table gains exactly one row per
   `client_attempt_id`).
4. Every validator rule class in §9 has a fixture proven to fail CI.
5. Committed catalogue drift (hand-edited artifact or stale rebuild) fails CI.
6. Migration 0007 upgrades and downgrades cleanly in CI against pgvector PG16;
   the production runbook (§8) is committed alongside.
7. All Phase 0–1 tests remain green; no research route, table or contract is
   touched except the compose build-context change, which is verified by the
   existing docker builds.
8. Checkpoint answer keys are absent from the web bundle (grep gate on the
   built client chunks in CI).
9. First curriculum content seeded: the "How an LLM generates text" unit's
   topics/lessons/concepts pass validation — content completeness itself is a
   Phase 3 concern.

Out of scope, restated: interactive demo implementations, lesson runtime
components beyond static narrative + checkpoint forms, `LessonAttempt`,
landscape↔canonical concept mapping, FSRS integration for curriculum items,
any change to review/quiz/flashcard tables.

---

## 11. Why this is the safest fit for this repository

- **Additive everywhere:** three new tables, two new API routes, one new
  static route group, zero modifications to research tables or routes — the
  same property that made Phases 0–1 trivially reversible.
- **Follows proven house idioms:** Alembic with drift gates, deterministic-
  first rendering, pydantic validation, Bearer auth deps, contract tests per
  route — every mechanism already exists in the repo; Phase 2 adds no novel
  infrastructure category.
- **One source of truth with a mechanical enforcement path** (compiler + CI
  drift gate) rather than convention — the exact remedy this repo already
  applied to its last duplicated-truth problem (concept annotation, Sprint 7).
- **Failure modes are honest and local:** backend down → lessons still render;
  stale client → 422 with explanation; bad content → unmergeable, not
  undeployable.

## 12. Requested approvals before implementation

1. This design overall (esp. committed-artifact + drift-gate approach, §2).
2. The compose build-context change (§4) — the one diff that touches existing
   deployment configuration.
3. The split `catalog.json` / `catalog.grading.json` (§3.2).
4. DDL as specified (§5), including the `client_attempt_id` idempotency key.
5. Confirmation that a production DB backup can be taken at implementation
   time (§8 step 1) — hard precondition for applying migration 0007.
