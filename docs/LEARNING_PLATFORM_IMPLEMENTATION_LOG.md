# Learning Platform Recovery — Implementation Log

Companion to [`FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md`](./FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md)
(the governing specification). This log records what was actually run,
what was found, and how each phase's exit gate was judged.

- **Branch:** `claude/learning-platform-recovery-sscpje`
  *(deviation: the spec suggested `feat/learning-platform-recovery`; the
  execution environment mandates this pre-provisioned branch name — the
  content and discipline are unchanged)*
- **Base commit:** `6016bc8181c74387bc52a5f4b4b9ae8dfa24d5ca` (`main`) —
  identical to the spec's observed baseline; `main`, the local branch and
  its remote all pointed at this commit at the start of work.
- **Date:** 12–13 July 2026

---

## Phase 0 — Trustworthy baseline

### Environment

- Linux 6.18.5 container, Python 3.11.15, Node 22.22.2 / npm 10.9.7.
- No Docker daemon available, so the compose stack could not be used;
  services were provisioned directly instead (this is environment
  provisioning, not a repair of the repository):
  - PostgreSQL 16.13 + pgvector 0.6.0 (apt `postgresql-16-pgvector`),
    fresh cluster, `fieldmap` role + database, trust auth on localhost;
  - Redis 7 (`redis-server --daemonize yes`);
  - backend venv via `pip install -e ".[dev]"`.
- Env for all backend commands (mirrors CI):
  `DATABASE_URL=postgresql+psycopg://fieldmap:fieldmap@localhost:5432/fieldmap`,
  `REDIS_URL=redis://localhost:6379/0`, `PDF_STORAGE_DIR=/tmp/fieldmap-pdfs`,
  `OBSIDIAN_EXPORT_REPO_PATH=/tmp/fieldmap-obsidian`, `ENV=development`.

### Commands run and results

| Check | Command | Result |
|---|---|---|
| Backend lint | `ruff check app migrations` | ✅ clean |
| Migrations | `alembic upgrade head` | ✅ `0001_initial` → `0006_user_auth_columns`, no manual repair |
| Backend tests | `python -m pytest -q` | ✅ 170 passed (7.9s) |
| Frontend build | `npm install && npm run build` | ✅ compiles, type-checks, 18 routes |

### Critical contracts exercised (live, stub providers, no LLM key)

API served with `uvicorn`, worker with `python -m app.workers.worker`:

- **Auth** — `POST /api/auth/login` returns a token for the seeded admin;
  wrong password → 401; unauthenticated `POST /api/landscapes` → 401. ✅
- **Landscapes** — create (auth-gated) → `{landscape_id, job_id}`; list and
  detail 200. ✅
- **Jobs** — `GET /api/jobs` 200; job detail reached `stage=done`,
  `progress=1.0` with 27 events; the pipeline completed end-to-end on the
  dev fallback (stub papers, local embeddings) without a model provider. ✅
- **Papers** — ranked list (8 papers) and paper detail 200. ✅
- **Quiz / Flashcards** — one stub item each (honest "configure an LLM
  provider" placeholder, as designed). ✅
- **Review** — queue returns real due/new counts; `POST review` records an
  attempt and advances FSRS state (interval 3d, stability/difficulty
  populated); weak-areas aggregates. ✅
- **Export** — `POST /api/landscapes/{id}/export/obsidian` writes the vault
  files and returns the plan. ✅

### Spec baseline verification

The plan's §3 findings were re-verified against the tree and hold: Alembic
migrations exist (6, clean chain), review/FSRS is real, the shell has
two-scope navigation, `/` redirected to `/landscapes`, quizzes/flashcards
are landscape objects, concepts are landscape-scoped, CI runs backend
lint/migrate/test + frontend build.

### Defect classification

- **Blocking Phase 1:** none found.
- **Relevant, non-blocking** (tracked in
  [`SPRINT_09_PRODUCT_POLISH_AND_LEARNING_ASSIST.md`](./SPRINT_09_PRODUCT_POLISH_AND_LEARNING_ASSIST.md)):
  flashcard readability; noisy "trending" refresh on `/search`; missing
  favicon (metadata was updated in Phase 1, icon files were not added —
  Sprint 9 scope).
- **Deferred:** highlight-to-Ask-AI, cluster-label polish beyond the
  shipped fallback chain, post-deploy smoke checks for the reported (and
  code-level unreproducible) `GET /api/jobs` 404.
- The README's Quickstart predates auth/review/FSRS in places (e.g. the
  API contract table omits review/jobs-index routes) — documentation debt,
  not a runtime defect.

### Baseline tests added

The backend contract surface was already covered (170 tests); no backend
gaps blocked trusting the baseline. The frontend had **no test
infrastructure**, so `vitest` + Testing Library were added (dev-only, wired
into CI before `next build`), with baseline contracts:

- a route-manifest test pinning every legacy research page file;
- a root-route test pinning the `/` → `/landscapes` redirect (replaced in
  Phase 1 by dashboard contract tests, as planned).

Dev-only deviation: `@types/node` 20.14.10 → 20.19.9 to satisfy vite 8's
peer range.

### Exit gate

**PASSED.** A clean checkout starts, migrates and exercises the entire core
journey (login → create landscape → job to done → papers → quiz →
flashcards → review with FSRS → export) with no undocumented manual repair.

### Rollback

Phase 0 adds only docs and tests (`git revert` of the two commits restores
the previous state; no schema or runtime changes).

---

## Phase 1 — Learning-first product shell

### What changed

- **`/` (home)** — the redirect to `/landscapes` is replaced by a learner
  dashboard: a learning-first hero (primary action → `/learn`, secondary →
  Research), a **Due for review** section aggregating real FSRS due/unseen
  counts from up to six most-recent ready landscapes, and an **Explore
  current research** section listing recent landscapes. No fabricated
  progress anywhere; every section has explicit loading/empty/failure
  states; the page renders without a worker or model provider.
- **Product navigation** (desktop sidebar): Home / Learn / Research /
  Review / Settings; Research links to the existing `/landscapes`; New
  landscape + Job monitor live under a secondary RESEARCH TOOLS group
  (reachable, not primary); the landscape context card and all scoped
  items are unchanged; wordmark subtitle RESEARCH OS → LEARN · RESEARCH.
- **Mobile bottom tabs** — context-dependent: product surfaces
  (Home / Learn / Research / Review / Search) by default; inside
  `/landscape/*` and `/paper/*` the existing scoped tabs (Overview / Read /
  Learn / Map) are preserved with Home returning to the product home.
- **`/learn`** — static, honest curriculum preview: the first eight topics
  marked IN BUILD, ten later topics marked PLANNED; no lesson links, no
  progress; renders with zero backend coupling. (This is presentation
  only — the Phase 2 curriculum schema is *not* introduced.)
- **`/review`** — product-level hub routing to each ready landscape's
  existing FSRS review screen, with explicit loading/empty/failure states.
- **Topbar breadcrumbs** and the **⌘K palette** cover the new surfaces;
  page **metadata** repositions FieldMap as "an interactive learning and
  research environment…".
- **No backend changes.** No new runtime dependencies (test-only dev deps).

### Validation

| Check | Result |
|---|---|
| Frontend tests (`vitest run`) | ✅ 34 passed — root dashboard contracts, sidebar product/scoped nav, mobile tabs both modes, learn-page honesty, review-hub states, legacy route manifest |
| Frontend production build | ✅ green; `/learn` + `/review` added; `/` = 3.7 kB (106 kB first load) |
| Backend lint + tests (unchanged code) | ✅ ruff clean, 170 passed |
| Migrations | ✅ unchanged (`0006` head, verified at Phase 0) |
| Layout checks (Playwright + system Chromium, production build against the live API) | ✅ desktop 1280px and mobile 390px/360px on `/`, `/learn`, `/review`, `/landscapes`, landscape overview and quiz: no horizontal overflow, no page errors; screenshots verified visually |

### Exit gate

**PASSED.** Every pre-existing surface is reachable exactly where it was
(route manifest test + live checks); a first-time user lands on a learning
dashboard whose primary action is the pathway, with Research clearly the
existing workspace.

### Known limitations

- `/learn` is a preview, not a curriculum: lessons, topics-as-routes and
  progress arrive with Phase 2's validated content contracts.
- Cross-topic review remains a hub over landscape-scoped queues until
  Phase 5; home review counts scan the six most recent ready landscapes
  (bounded fan-out) rather than every landscape.
- Favicon and flashcard readability (Sprint 9 scope) intentionally not
  addressed here.

### Rollback

Revert the two `feat` commits (`feat(home)`, `feat(shell)`) to restore the
research-first shell; they are additive UI changes with no schema or data
impact. Old bookmarks continue to work in both directions.

---

## Deviations from the specification

1. **Branch name** — `claude/learning-platform-recovery-sscpje` instead of
   `feat/learning-platform-recovery` (execution environment mandates the
   designated branch; discipline otherwise identical).
2. **Production DB backup** (plan §11 Phase 0 task 4) — not performed: no
   production database is reachable from this environment and **no schema
   migrations were introduced**, so there was nothing to protect. A backup
   (`scripts/backup_db.sh`) must precede the first Phase 2 migration.
3. **Visual baseline** (task 7) — captured as Playwright screenshots in the
   working environment rather than committed artifacts, to keep the repo
   lean; the screenshot script is trivially reproducible.
4. **`@types/node` bump** — dev-only, forced by vite 8 peer range (recorded
   above).
