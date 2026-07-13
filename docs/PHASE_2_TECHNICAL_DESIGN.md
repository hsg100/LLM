# Phase 2 Technical Design — Curriculum & Progress Foundation

**Status:** REVISED DESIGN FOR FINAL APPROVAL — hardened after review; no branch, migration or implementation exists yet.
**Governing spec:** [`FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md`](./FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md) §5, §9, §11 (Phase 2)
**Baseline:** `main` at `d5438fd` (Phases 0–1 merged, PR #7)
**Review outcome incorporated:** architecture APPROVED WITH AMENDMENTS; docker build-context change APPROVED WITH AMENDMENTS; split catalogue APPROVED WITH CLARIFICATION; DDL REVISED per review; production backup approved as a hard **deployment gate** (not as confirmation that a backup exists or that production access is currently available).
**Locked product decisions this design implements:** repo-root `curriculum/`; YAML contracts + Markdown lessons with validated frontmatter; demo IDs as metadata only (no executable MDX/JSX, no demo implementations); exactly three progress tables (`CurriculumProgress`, `LessonProgress`, `CheckpointAttempt` — **no** `LessonAttempt`); canonical concepts in Git only (no changes to the landscape `Concept` table, no landscape↔canonical mapping until Phase 4); Phase 2 ships on a fresh branch as a separate draft PR.

---

## 1. Architecture overview

```
Git (single source of truth)                     Consumers
────────────────────────────                     ─────────
curriculum/
  curriculum.yaml      ─┐
  schemas/              │  curriculum-tools build
  concepts/*.yaml       ├────────────────────────►  curriculum/build/catalog.json
  topics/*.yaml         │  (validate + compile;      curriculum/build/catalog.grading.json
  lessons/*.md         ─┘   CI drift-gate)           (committed, hashed — see §6)
                                                        │
                                     ┌──────────────────┴───────────────────┐
                                     ▼                                      ▼
                          Next.js (Vercel)                       FastAPI (VPS Docker)
                          server-only import of                  loads catalog.json +
                          catalog.json at build                  catalog.grading.json at startup
                          → /learn pages rendered                → validates progress writes,
                            server-side; minimal                   grades checkpoints, serves
                            per-page props to clients              progress APIs, reports
                            (§7); zero backend                     catalogue version/hash
                            dependency for content                 on /ready
                                                                        │
                                                                        ▼
                                                              PostgreSQL (progress only:
                                                              3 new tables, migration 0007)
```

One compiler, one committed artifact pair, two read-only consumers. PostgreSQL
stores learner state only — never curriculum content (spec §5.1).

---

## 2. Curriculum parsing and build/runtime ownership

### Decision

A single Python package owns **all** parsing, validation and compilation.
Entry points:

- `curriculum-tools validate` — runs every check in §12 and exits non-zero
  with per-file, per-rule errors.
- `curriculum-tools build` — validate, then compile the sources into the two
  deterministic artifacts in `curriculum/build/` (stable key ordering, no
  timestamps; hashing per §6). `--check` recompiles to a temp dir and fails
  on any difference from the committed artifacts (drift gate).
- `curriculum-tools emit-schemas` — regenerates `curriculum/schemas/*.json`
  (JSON Schema) from the pydantic contract models, so editor tooling and the
  models cannot drift; also drift-gated in CI.

The compiled artifacts **are committed to Git**. Neither Next.js nor FastAPI
ever parses YAML/Markdown at runtime: Next.js imports `catalog.json` in
server-only code at build time; FastAPI loads both files once at startup into
an immutable in-memory index.

### 2.1 Compiler packaging (exact)

- **Location:** `tools/curriculum_tools/` at the repository root:

  ```
  tools/curriculum_tools/
    pyproject.toml
    curriculum_tools/
      __init__.py
      cli.py            # entry point
      contracts.py      # pydantic models for curriculum/topic/concept/lesson
      compile.py        # source → catalogue compilation
      validate.py       # rule classes of §12
      hashing.py        # §6 hash definitions
    tests/              # unit tests for parsing, validation, determinism
  ```

- **`pyproject.toml`:**

  ```toml
  [project]
  name = "curriculum-tools"
  version = "0.1.0"
  requires-python = ">=3.11"
  dependencies = [
    "pydantic>=2.7",
    "PyYAML>=6.0",
    "markdown-it-py>=3.0",   # lesson-body block splitting; no HTML rendering
  ]

  [project.scripts]
  curriculum-tools = "curriculum_tools.cli:main"

  [build-system]
  requires = ["setuptools>=68"]
  build-backend = "setuptools.build_meta"
  ```

- **Installation:** always as an installed package — never via `PYTHONPATH`:
  - CI (backend job, before the pytest step):
    `python -m pip install -e tools/curriculum_tools`
  - Local dev: same command inside the api venv (documented in README).
  - The **api runtime does not depend on it** — the api reads only the
    compiled JSON. `curriculum-tools` is a build/CI tool, not an app
    dependency, so the api image never installs it.

### Why build-time compilation with committed artifacts

The deployment split is Vercel (Node-only build) for the web app and a VPS
Docker image (Python-only) for the api. Any "parse at build" scheme needs
either the compiler in both languages or one language's toolchain injected
into the other's build. Committing the compiled artifacts removes the
problem: both builds consume plain JSON with zero new toolchain requirements,
the deployed catalogue is reviewable in PR diffs, and the drift gate makes
hand-editing the artifacts unmergeable.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| FastAPI parses YAML at runtime; Next.js fetches via API | `/learn` would depend on backend availability — violates spec §11 Phase 2 task 8 and §13.8 |
| Two parsers (TS for web, Python for api) over raw YAML | Duplicated truth in two languages — the drift class Sprint 7 eliminated for concept annotation |
| Compile during each build, artifact not committed | Vercel build lacks Python; api image lacks Node; artifact-passing infrastructure doesn't exist here |
| Executable MDX lessons | Locked out by product decision; widens the content review/audit surface |
| Store curriculum in PostgreSQL, seeded by migration | Spec §5.1 forbids DB-as-source (environment drift, unreviewable content changes) |

---

## 3. Source formats and contracts

### 3.1 Layout (as locked)

```
curriculum/
  curriculum.yaml          # curriculum manifest: slug, version, ordered topic slugs
  schemas/                 # JSON Schema files generated from the pydantic contracts
  concepts/<slug>.yaml     # canonical concepts (Git-only in Phase 2)
  topics/<slug>.yaml       # topic contracts
  lessons/<slug>.md        # Markdown narrative + validated YAML frontmatter
  build/
    catalog.json           # public catalogue (committed; drift-gated)
    catalog.grading.json   # answer keys (committed; api image only — §6.3)
tools/curriculum_tools/    # compiler package (§2.1)
```

### 3.2 Contracts (spec §5.2–§5.4, constrained to Phase 2)

`curriculum.yaml`: `slug`, `title`, `version` (integer), `topics` (ordered
list of topic slugs; presence + order is the pathway).

`topics/<slug>.yaml`: `slug`, `title`, `summary`, `status`
(**`active | planned | retired`** — one enum everywhere; `retired` renders as
"no longer offered" and is release-only, i.e. an `active` topic may move to
`retired` but never be deleted), `prerequisites` (topic slugs),
`learning_objectives`, `lessons` (ordered lesson slugs; empty allowed only
when `planned`), `concepts` (canonical concept slugs).

`concepts/<slug>.yaml`: `slug`, `name`, `short_definition`, `prerequisites`
(concept slugs). Deliberately minimal; enrichment is later-phase work.

`lessons/<slug>.md` frontmatter: `slug`, `topic`, `version` (integer),
`duration_minutes`, `objectives`, `concepts`, `demos` (list of **stable demo
IDs — strings only**; implementations are Phase 3), `demo_fallbacks`
(required map: demo ID → plain-text fallback conveying the same point),
`checkpoint` (`slug`, `kind: concept-check`, `pass_score`, `questions`: MCQ
list with `id`, `prompt`, `options`, `correct_index`, `concept`), `sources`
(each with `id` and `url` required).

Lesson body: **plain Markdown, raw HTML forbidden** — the compiler rejects
any lesson containing raw HTML blocks/inline HTML (markdown-it parse tree
inspection), so no lesson-authored markup can reach the client (§7). The body
is split into ordered blocks at `##` headings; block IDs are slugified
headings, uniqueness enforced — these IDs are the resumable positions stored
in `LessonProgress.last_block_id`.

Demo IDs must appear in `curriculum/schemas/demo-registry.yaml` — in Phase 2
a plain declared-IDs manifest (the typed runtime registry is Phase 3), so
"lesson references an unknown demo" is CI-checkable now.

---

## 4. Split public/grading catalogue (clarified)

The compiler emits two views of each checkpoint:

- `catalog.json` — public view: questions **without** `correct_index`.
  Consumed by the web build and by the api.
- `catalog.grading.json` — answer keys and pass thresholds. Loaded **only**
  by the api; copied **only** into the api image (§5.2); never imported by
  any frontend code; excluded from the web deployment by the server-only
  delivery rules and CI checks of §7.

**Scope of this protection, stated plainly:** the split prevents answer keys
from reaching the **browser bundle and the Vercel deployment**. It does
**not** hide them from anyone with read access to the Git repository — the
grading file is committed and visible there by design. Protecting answer
keys from repository readers is out of scope for Phase 2 and accepted.

---

## 5. Docker and production packaging

Current constraints (verified against the tree):

- both compose files build api and worker with context `./apps/api`;
- **dev compose bind-mounts `./apps/api:/app`** — anything baked under
  `/app` is shadowed at runtime in development.

### 5.1 Root `.dockerignore` (required, new)

Changing the api build context to the repository root makes a root
`.dockerignore` mandatory before any image build. Required entries:

```
.git/
.gitignore
.env
.env.*
!.env.example
**/node_modules/
**/.next/
out/
dist/
build/
**/.venv/
**/venv/
**/__pycache__/
*.pyc
**/.pytest_cache/
**/.mypy_cache/
**/.ruff_cache/
*.sqlite
*.sqlite3
*.db
dump.rdb
*.log
backups/
.idea/
.vscode/
.DS_Store
apps/web/
```

(`apps/web/` is excluded because the root context serves only the api/worker
image; the web image keeps its own `./apps/web` context and is unaffected.
Note `curriculum/build/` is **not** ignored — it must enter the context.)

### 5.2 Compose and Dockerfile changes (exact)

Compose (`docker-compose.yml` and `docker-compose.prod.yml`, api + worker
services):

```yaml
build:
  context: .
  dockerfile: apps/api/Dockerfile
```

`apps/api/Dockerfile` COPY paths after the context change (workdir `/app`):

```dockerfile
COPY apps/api/pyproject.toml /app/pyproject.toml
RUN pip install --upgrade pip && pip install -e .
COPY apps/api/ /app/
COPY curriculum/build/catalog.json         /curriculum/build/catalog.json
COPY curriculum/build/catalog.grading.json /curriculum/build/catalog.grading.json
ENV CURRICULUM_CATALOG_DIR=/curriculum/build
```

The catalogue lives at **`/curriculum/build` — deliberately outside `/app`** —
so the dev bind-mount of `/app` cannot shadow it. The grading file is copied
**only** here; the web image and Vercel deployment never contain it.

### 5.3 Development mount (new)

Dev compose (api and worker services) adds a **read-only** curriculum mount
alongside the existing `/app` mount:

```yaml
volumes:
  - ./apps/api:/app
  - ./curriculum/build:/curriculum/build:ro
```

Same in-container path as production (`CURRICULUM_CATALOG_DIR=/curriculum/build`
in both), so dev and prod exercise identical loading code. Bare-metal
dev/tests (no Docker) default to the repo-relative `curriculum/build/` via
the same setting.

### 5.4 Image smoke tests (required)

A CI job (and `make smoke-images` target) must, on the Phase 2 PR:

1. `docker compose build api worker` (root context, .dockerignore active).
2. Run the api image one-shot: container starts, `GET /health` returns ok,
   and `GET /ready` reports the expected `curriculum_version` and
   `curriculum_hash` (proves the catalogue is present, parseable and
   integrity-checked inside the image, not via a mount).
3. Run the worker image one-shot: worker entrypoint imports cleanly and the
   same catalogue-load check passes (`python -m app.scripts.smoke_curriculum`,
   a tiny script added for this purpose).

### Alternative considered

Keeping the `./apps/api` context and copying `curriculum/` into `apps/api/`
via a Makefile pre-build step — rejected as an invisible mutation of build
inputs that will eventually be forgotten; an explicit root context with a
strict `.dockerignore` is the standard compose answer.

---

## 6. Catalogue integrity (hash taxonomy, corrected)

Three distinct hashes with distinct guarantees — conflating them was a defect
of the previous draft:

1. **`source_tree_hash`** — SHA-256 over the canonicalised curriculum
   *sources* (every file under `curriculum/` except `build/`, sorted paths +
   contents). Computed by the compiler and embedded in both artifacts.
   **Only CI can verify it**, because only CI has the raw sources next to
   the artifacts.
2. **`artifact_hash`** — SHA-256 of each artifact's own canonical JSON with
   its `artifact_hash` field nulled. Embedded in the artifact. Anything
   holding the file can recompute it.
3. **Runtime integrity verification** — at startup the api recomputes and
   checks `artifact_hash` for both files and fails loudly on mismatch
   (corrupted/truncated/hand-edited file). It also checks that both files
   carry the **same `source_tree_hash`** (they were built together). The api
   **cannot and does not claim to** verify agreement with the raw sources —
   the sources are not packaged. Source-to-artifact agreement is proven
   exclusively by the CI drift gate (`curriculum-tools build --check`), which
   blocks merge on any divergence.

`/ready` reports `curriculum_version`, `source_tree_hash` (as
`curriculum_hash`) and load status. The web build embeds the same
`source_tree_hash` from its bundled `catalog.json` for the skew protocol
(§10).

---

## 7. Next.js delivery (server-only, hardened)

- **Server-only catalogue access.** The catalogue is imported exactly once,
  in `apps/web/lib/curriculum/catalog.server.ts`, which imports the
  [`server-only`](https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#keeping-server-only-code-out-of-the-client-environment)
  marker package so any accidental client-component import **fails the
  build**. `/learn`, `/learn/[topic]` and `/learn/[topic]/[lesson]` are
  Server Components reading from this module.
- **Minimal client props.** Client components receive only the data the
  interaction needs: the current lesson's block list, checkpoint questions
  *without answers*, and progress state. The full catalogue object is never
  passed as a prop and never serialised into a client boundary, keeping it
  out of shared client JavaScript and RSC payload bloat.
- **Markdown sanitisation, two layers.** The compiler rejects raw HTML at
  build time (§3.2); the web renderer additionally renders Markdown with
  HTML disabled (react-markdown with `skipHtml`/no `rehype-raw`), so even a
  compiler regression cannot inject markup.
- **CI inspection checks** (frontend job, after `next build`):
  1. **Answer-key gate:** the compiler plants a canary string in
     `catalog.grading.json` (e.g. `__FIELDMAP_GRADING_CANARY__`); CI greps
     the built client chunks (`.next/static/**`) for the canary **and** for
     `correct_index`, failing on any hit.
  2. **Bundle budget:** first-load JS for `/learn` routes asserted under a
     recorded budget (initial: ≤ 130 kB, tightened later), so a regression
     that drags the catalogue into client chunks is caught even without the
     canary.
- **Monorepo import verification.** Importing `../../curriculum/build/catalog.json`
  from `apps/web` compiles locally, but the Phase 2 PR must **prove it on the
  actual Vercel configuration** via the preview deployment (Vercel's build
  includes the full repo for monorepos, but this is verified, not assumed).
  If the Vercel root-directory setting prevents it, the recorded fallback is
  a `prebuild` npm script that copies `curriculum/build/catalog.json` into
  `apps/web/.curriculum/` (still committed-artifact-sourced, still
  drift-gated) — a packaging change only, no architecture change.

---

## 8. Progress data model — exact DDL (Alembic migration `0007_learning_progress`)

Conventions follow existing models (`ReviewState`/`ReviewAttempt`): string
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
    CONSTRAINT ck_curriculum_progress_status CHECK (status IN ('active','completed')),
    CONSTRAINT ck_curriculum_progress_completion CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
     OR (status <> 'completed' AND completed_at IS NULL))
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
    CONSTRAINT ck_lesson_progress_completion CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
     OR (status <> 'completed' AND completed_at IS NULL)),
    CONSTRAINT ck_lesson_progress_score CHECK (
        best_checkpoint_score IS NULL OR (best_checkpoint_score >= 0 AND best_checkpoint_score <= 1))
);
CREATE INDEX ix_lesson_progress_user_id ON lesson_progress (user_id);
CREATE INDEX ix_lesson_progress_user_status ON lesson_progress (user_id, status, updated_at);

CREATE TABLE checkpoint_attempts (
    id                VARCHAR PRIMARY KEY,
    user_id           VARCHAR NOT NULL REFERENCES users(id),
    lesson_slug       VARCHAR NOT NULL,
    lesson_version    INTEGER NOT NULL,
    checkpoint_slug   VARCHAR NOT NULL,
    score             DOUBLE PRECISION NOT NULL,
    passed            BOOLEAN NOT NULL,
    responses         JSONB NULL,              -- submitted answers + per-question evaluation
    client_attempt_id VARCHAR NOT NULL,        -- idempotency key (client-generated UUID)
    created_at        TIMESTAMP NOT NULL,
    CONSTRAINT uq_checkpoint_attempt_client UNIQUE (user_id, client_attempt_id)
);
CREATE INDEX ix_checkpoint_attempts_user_lesson
    ON checkpoint_attempts (user_id, lesson_slug, lesson_version, created_at);
```

Changes from the previous draft per review: `client_attempt_id` is now
**`NOT NULL`** (idempotency is mandatory, not opt-in); completion-consistency
CHECKs added to both progress tables so `status` and `completed_at` can never
contradict; topic status is the single `active | planned | retired` enum
throughout the design (§3.2).

Notes: `checkpoint_attempts` is append-only — no `updated_at`, no UPDATE path
in code. No FKs to curriculum entities (they are files); slug+version
validity is enforced at the API layer against the loaded catalogue.
`LessonAttempt` is intentionally absent per the locked decision.

**Downgrade:** `DROP TABLE` × 3 (order: attempts, lesson, curriculum). Purely
additive upgrade; no existing table is touched.

---

## 9. API contracts, idempotency and concurrency

All under the existing router/auth stack. **Reads of curriculum content have
no API** — content ships in the web bundle; the api serves only learner state.

| Method & path | Auth | Semantics |
|---|---|---|
| `GET /api/learn/catalogue-info` | none | `{curriculum_slug, curriculum_version, curriculum_hash}` — the api's deployed catalogue identity, for the skew protocol (§10). |
| `GET /api/learn/progress` | Bearer | All progress for the authenticated user: curriculum rows + lesson rows + last 20 checkpoint attempts, plus `catalogue-info` fields. One round-trip for the dashboard/`/learn`. |
| `PUT /api/learn/lessons/{lesson_slug}/progress` | Bearer | Body: `{lesson_version, last_block_id?, catalog_hash}`. **No `status` field — completion is exclusively server-controlled via checkpoint success.** Upsert on (user, slug, version). |
| `POST /api/learn/lessons/{lesson_slug}/checkpoint-attempts` | Bearer | Body: `{lesson_version, checkpoint_slug, responses, client_attempt_id, catalog_hash}`. Server grades against `catalog.grading.json`. |

### 9.1 Genuine idempotency (corrected)

The previous draft was self-contradictory ("updated_at always set" vs
"byte-identical state"). Corrected semantics:

- **Progress PUT is a true no-op on identical input.** The handler loads the
  row, computes the effective new state, and if nothing would change
  (`last_block_id` equal, version equal) it performs **no database write**,
  leaves `updated_at` untouched, and returns the current row — byte-identical
  to the previous response. Only a genuinely changed `last_block_id` (or
  first-ever write, which creates the row and sets `started_at`) writes and
  bumps `updated_at`.
- Completed lessons accept position updates (re-reading moves the resume
  point) but `status`/`completed_at`/`best_checkpoint_score` are never
  writable through PUT, and nothing in PUT can regress `completed`.
- **Checkpoint POST is idempotent by key.** A retried `client_attempt_id`
  returns the original attempt's result (`200`, `duplicate: true`) with no
  second insert and no side-effect re-application.
- Contract tests must assert: same PUT twice → one write then zero writes,
  identical bodies and identical `updated_at`; same POST twice → one row.

### 9.2 Concurrent checkpoint safety (new)

All checkpoint side-effects occur in **one transaction** with this shape:

1. `INSERT INTO checkpoint_attempts … ON CONFLICT ON CONSTRAINT
   uq_checkpoint_attempt_client DO NOTHING RETURNING id`.
   If no row returns (a concurrent request won the unique-key race), the
   handler **selects and returns the original attempt** (`200`,
   `duplicate: true`) — a race can never surface as a 500.
2. `SELECT … FROM lesson_progress WHERE user_id=… AND lesson_slug=… AND
   lesson_version=… FOR UPDATE` (row created first if absent, tolerant of
   the same insert race via its unique constraint + retry-select). The
   update applies **monotonic expressions**, not read-modify-write in
   Python:
   - `best_checkpoint_score = GREATEST(COALESCE(best_checkpoint_score, 0), :score)`
   - `status = CASE WHEN status='completed' OR :passed THEN 'completed' ELSE status END`
   - `completed_at = COALESCE(completed_at, CASE WHEN :passed THEN :now END)`
   so the score can never decrease and completion can never revert,
   regardless of interleaving.
3. `SELECT … FROM curriculum_progress … FOR UPDATE` (create-if-absent, same
   pattern) and recompute `current_topic_slug` / completion inside the same
   transaction. Lock order is always lesson_progress → curriculum_progress,
   making deadlock impossible between concurrent checkpoint transactions.

**Required concurrency tests** (DB-backed, following the repo's existing
25-way concurrent job-events test idiom): (a) N parallel POSTs with the same
`client_attempt_id` → exactly one attempt row, all responses identical;
(b) parallel POSTs with different attempts and interleaved scores → final
`best_checkpoint_score` is the maximum, `completed` never reverts;
(c) concurrent PUT vs checkpoint POST → no lost update, constraints hold.

### 9.3 Authentication and user isolation

- Reuses `get_current_user` (Bearer; `require_auth=false` dev fallback to the
  default user, matching the review loop).
- `user_id` always comes from the token, never the body.
- Every query filters by `user_id`; contract tests must include two-user
  isolation tests (user B can neither read nor affect user A's rows) and a
  401-without-token test per endpoint, mirroring `test_review_fsrs.py`.
- Unlike landscapes (deliberately a shared library), learner progress is
  strictly per-user from day one.

`curriculum_progress` remains **server-maintained only** — no direct client
write surface at all.

---

## 10. Deployment version skew (corrected — no ordering assumption)

Vercel deploys the web app automatically when `main` moves; the VPS api is
updated by an operator running `make prod-up`. **Either component may
therefore run ahead of the other at any moment, and the design assumes no
deploy order.**

Protocol:

- The web build embeds its catalogue's `source_tree_hash`; every progress/
  checkpoint write carries it as `catalog_hash`. The api compares against its
  own hash:
  - **Hashes equal** → normal processing.
  - **Hashes differ but** the referenced `(lesson_slug, lesson_version,
    checkpoint/block ids)` all validate against the api's catalogue → the
    write is **accepted** (a content-only edit that bumped no version is not
    a semantic conflict).
  - **Hashes differ and** the referenced slug/version/ids do **not** validate
    → **`HTTP 409`** with body
    `{"error": "catalogue_version_mismatch", "api_hash": …, "client_hash": …,
    "api_curriculum_version": …}`. (Plain-422 remains for malformed requests
    that fail regardless of skew.)
- **Client behaviour on 409:** checkpoint responses and the resume position
  are **preserved locally** (localStorage keyed by `client_attempt_id` /
  lesson slug) and resubmitted with backoff; the UI shows an honest
  "Your progress is saved on this device — syncing is paused while the app
  and server versions differ" state with a manual retry. Because the
  `client_attempt_id` travels with the retry, eventual submission is exactly
  the original attempt — no duplicates.
- **Lessons stay readable throughout:** content is bundled with the web app
  and requires no api call; skew degrades writes only, never reading.
- **Release procedure under automatic Vercel deploys:** merge to `main` →
  Vercel deploys web automatically → operator updates the VPS
  (backup gate §11, `alembic upgrade`, `make prod-up`) **promptly but without
  ordering guarantees**; the 409/retry path is the safety net for the window
  in either direction, and `/ready`'s catalogue fields plus
  `GET /api/learn/catalogue-info` make the skew observable.

---

## 11. Backup gate, migration, downgrade and rollback

The Phase 2 implementation PR **may contain** migration `0007`. **Applying it
to production is blocked** until the following evidence is captured in the
implementation log (`LEARNING_PLATFORM_IMPLEMENTATION_LOG.md`):

1. The successful backup command and its output (`make prod-backup-db` /
   `scripts/backup_db.sh`).
2. The timestamped backup artifact location.
3. Its non-zero size (e.g. `ls -l` output).
4. Backup validity evidence: `pg_restore --list <backup>` (or the equivalent
   for the backup format) completing without error.
5. The documented restore command that would be used verbatim in an
   emergency.
6. The pre-migration schema revision (`alembic current` output) recorded
   alongside.

This gate is procedural, not assumed: approval of the gate does **not** mean
a backup exists today or that production access is currently available —
the evidence is produced at deployment time, and its absence stops the
deployment.

Ordered production procedure: evidence steps 1–6 → `alembic upgrade head` →
api image deploy (`make prod-up`) → web deploys automatically from `main`
(order-independent per §10).

Rollback tiers:
- **Code-only rollback (preferred):** revert commits / redeploy previous
  images. The three new tables are inert to old code — no downgrade needed,
  no data lost.
- **Full rollback:** `alembic downgrade -1` drops the three tables — loses
  learner progress only (documented, accepted for Phase 2), never research
  data. Restore path from the validated backup is documented with it.
- CI runs `upgrade head` → `downgrade -1` → `upgrade head` against pgvector
  PG16 to prove both directions before merge.

---

## 12. Validation and CI strategy

Backend CI job gains steps (before pytest):
`python -m pip install -e tools/curriculum_tools`, then
`curriculum-tools validate`, then the drift gates
(`curriculum-tools build --check`, `curriculum-tools emit-schemas --check`).

Validator rule classes (each with a red-path fixture test so "invalid
curriculum cannot merge" is itself tested, spec §5.5):

1. Schema violations (missing/unknown fields, wrong types) per contract.
2. Unknown slug references: topic→topic prereqs, topic→lesson,
   topic/lesson→concept, concept→concept prereqs, curriculum→topic.
3. Duplicate slugs across curriculum/topics/lessons/concepts; duplicate
   block IDs within a lesson.
4. Cycles in topic-prerequisite and concept-prerequisite graphs.
5. Unknown demo IDs (not in `demo-registry.yaml`).
6. Missing demo fallbacks (`demos` ⊄ `demo_fallbacks` keys).
7. Citations missing `id` or `url`; out-of-range `correct_index`;
   `pass_score` outside (0,1]; `active` topics with zero lessons.
8. Raw HTML present in any lesson body (§3.2).

Backend pytest additions: catalogue-load and integrity tests (§6),
progress/checkpoint contract tests (true idempotency per §9.1), the
concurrency suite (§9.2), auth/user-isolation tests (§9.3), skew-protocol
tests (409 shape, hash-differs-but-valid acceptance), migration up/down test.

Frontend vitest additions: `/learn` routes render from the bundled catalogue
with the api mocked away; unknown-slug 404s; "progress unavailable" states;
the 409 "saved locally / syncing paused" state. Frontend CI additions:
answer-key canary + `correct_index` grep over built client chunks, and the
`/learn` bundle budget (§7).

Image smoke tests per §5.4 run in the Phase 2 PR.

---

## 13. Phase 2 acceptance criteria (exit gate)

1. `/learn`, `/learn/[topic]`, `/learn/[topic]/[lesson]` render
   deterministically from the committed catalogue **with the api, worker and
   model provider all unavailable** (server-rendered content + honest
   "progress unavailable" notice).
2. Authenticated lesson progress (including `last_block_id`) and checkpoint
   attempts persist across sessions and api restarts.
3. Idempotency proven: identical PUT repeated → zero additional writes,
   identical response bytes, unchanged `updated_at`; repeated
   `client_attempt_id` → exactly one attempt row and the original result.
4. Concurrency suite (§9.2 a–c) green on pgvector PG16 in CI.
5. Every validator rule class (§12) has a fixture proven to fail CI; drift
   gates (artifacts and schemas) proven to fail on divergence.
6. Answer keys demonstrably absent from web deliverables: canary +
   `correct_index` greps clean; grading file present only in the api image.
7. Version-skew behaviour demonstrated: mismatched-hash write with unknown
   version → 409 shape of §10; lesson reading unaffected; queued attempt
   resubmits successfully after alignment.
8. Migration 0007 upgrades and downgrades cleanly in CI; the §11 evidence
   checklist is committed as the production runbook.
9. Image smoke tests (§5.4) green; dev compose serves the catalogue through
   the read-only mount with identical loading code.
10. All Phase 0–1 tests remain green; no research route, table or contract
    changed except the compose build-context change, verified by the image
    builds.
11. First curriculum content seeded: the "How an LLM generates text" unit's
    topics/lessons/concepts pass validation (content completeness itself is
    a Phase 3 concern).

Out of scope, restated: interactive demo implementations, lesson runtime
components beyond static narrative + checkpoint forms, `LessonAttempt`,
landscape↔canonical concept mapping, FSRS integration for curriculum items,
any change to review/quiz/flashcard tables.

---

## 14. Branch and delivery discipline

After this amended design receives final approval:

1. Create a **fresh implementation branch from the then-current `main`**
   (name: `feat/phase-2-curriculum-foundation` or the environment-designated
   equivalent). **No implementation on
   `claude/learning-platform-recovery-sscpje`.**
2. Carry this approved design document and the deferred product-experience
   audit document into that branch (they currently exist only on the
   recovery branch, not on `main`), as its first documentation commit.
3. Open a **separate draft PR** for Phase 2.
4. The PR may contain migration 0007; production application remains blocked
   behind the §11 evidence gate.

---

## 15. Why this remains the safest fit for this repository

- **Additive everywhere:** three new tables, three new API routes, one new
  static route group; zero modifications to research tables or routes — the
  compose build-context change is the single deployment-config diff, and it
  is smoke-tested.
- **Follows proven house idioms:** Alembic with drift gates, deterministic-
  first rendering, pydantic validation, Bearer auth deps, contract tests per
  route, DB-backed concurrency tests — every mechanism already exists here.
- **One source of truth with mechanical enforcement** (compiler + CI drift
  gates + runtime integrity checks with honestly stated limits, §6).
- **Failure modes are honest and local:** backend down → lessons render;
  version skew → local save + retry, reading unaffected; bad content →
  unmergeable; race conditions → resolved by constraint + monotonic SQL,
  never a 500.

## 16. Approval state

| Item | State |
|---|---|
| Overall architecture (committed, drift-gated catalogue) | Approved with amendments — amendments incorporated §§2, 6, 7 |
| Docker build-context change | Approved with amendments — incorporated §5 |
| Split public/grading catalogue | Approved with clarification — incorporated §4 |
| Three-table DDL | Revised per review — §8 awaits re-approval |
| Production backup | Approved as hard deployment gate — evidence checklist §11 |

**Remaining before implementation:** final approval of this amended document,
after which §14 governs delivery.
