# ContextLab Briefing — reader prototype

An isolated, evidence-first daily-briefing reader for LLM research, built as an
installable, offline-capable PWA. It demonstrates the interaction model —
finite daily edition, claim-level citations, confidence and caveats, save/read
state, offline reading, a genuine "caught up" ending — using local fixture
data only.

## What this is

- A **self-contained static prototype** in `prototypes/contextlab-briefing/`.
  Plain HTML, CSS and vanilla ES modules. No build step, no runtime
  dependencies, no network requests beyond its own files.
- A **finite daily edition**: one fixture edition of seven briefings that ends
  in a real "You're caught up" state.
- An **evidence-first reader**: every story carries individual claims, each
  with its own confidence, support status (supported / partially supported /
  unsupported), linked sources and optional caveat, plus story-level caveats
  and an honest correction history.
- An **installable PWA**: web app manifest, service worker, offline caching of
  the app shell and story data after the first successful load.

## What this is not

- **Not production code.** It validates interaction and evidence presentation
  only. Nothing here approves or implements the future production
  architecture.
- **Not integrated.** It does not touch `apps/web`, `apps/api`, the database,
  migrations, navigation, CI or any shared configuration. Deleting this one
  directory removes it completely.
- **No ingestion.** No scraping, no arXiv/social connectors, no model calls,
  no automated drafting, no editorial dashboard, no auth, no database.
- **Not a social product.** No likes, comments, followers, streaks,
  popularity ranking or infinite scroll — deliberately.

## Content provenance (important)

Source verification over the network is unavailable in the environment this
prototype was built in, so **all fixture content is synthetic demonstration
data**. The papers, labs, authors and results described are fictional, every
source URL uses a reserved `.example` host that will not resolve, and the app
states this in the edition introduction and next to every source link.
No real source is misrepresented and no source is presented as real.

## Run it locally

Any static file server works. From the repository root:

```sh
python3 -m http.server 8000 --directory prototypes/contextlab-briefing
# or: npx serve prototypes/contextlab-briefing
```

Then open <http://localhost:8000/>. Serving over `http://localhost` (or
HTTPS) is required for the service worker; opening `index.html` from `file://`
still renders but skips offline support.

## Run the tests

Uses Node's built-in test runner — no packages are installed and no lockfile
changes. From the repository root:

```sh
node --test "prototypes/contextlab-briefing/tests/*.test.mjs"
```

The tests cover the fixture/data contract (ID uniqueness, claim→source
integrity, enum and support-state rules, edition consistency), the pure state
model (filtering, finite-edition behaviour, read/saved reducers, storage
fallback) and service-worker asset references.

## Data and evidence contract

The contract is documented in [`schema/story.schema.json`](schema/story.schema.json)
and enforced by `tests/fixtures.test.mjs`. In short:

- `data/stories.json` holds one **edition** (`date`, `title`, `intro`,
  `contentNote`) and 5–8 **stories**.
- A **story** has a stable `id`, `editionDate`, `headline`, `dek`,
  `storyType` (research-paper | replication | company-claim |
  official-release | analysis | opinion), `evidenceStatus` (peer-reviewed |
  preprint | replicated | official | unverified-claim | opinion | mixed),
  `readingTimeMinutes`, `topics`, `whyItMatters`, `whatIsNew`, `body`
  paragraphs, `whatRemainsUncertain`, overall `confidence` (high | moderate |
  low), `claims`, `sources`, `caveats`, `corrections` (empty array = none
  issued, shown honestly), `publishedAt` and `updatedAt`.
- A **claim** has an `id`, `text`, its own `confidence`, a `support` state —
  `supported` (direct evidence, ≥1 source), `partially-supported` (indirect or
  incomplete evidence, ≥1 source, caveat required) or `unsupported` (no
  sources allowed, caveat required) — plus `sourceIds` referencing the story's
  sources and an optional `caveat`.
- A **source** has an `id`, `title`, `authors` (or issuing organisation),
  `url`, `sourceType`, `publishedDate`, `isPrimary` and `reviewStatus`.

Evidence is navigable from claim to source: every claim lists its supporting
sources inline, and each source opens from there.

## PWA / offline behaviour and limitations

- After one successful load over `localhost`/HTTPS, the service worker
  precaches the shell and `data/stories.json`; the feed and stories then
  reload offline. An offline banner appears when connectivity is lost.
- External source links are **not** cached and say so — though in this
  prototype they are synthetic `.example` URLs that never resolve anyway.
- Icons are SVG (no raster tooling available in the build environment).
  Chromium-family browsers install fine; iOS ignores SVG apple-touch-icons
  and will fall back to a screenshot-based icon.
- There is no in-app install button: `beforeinstallprompt` is inconsistently
  supported, so the app avoids a dead control and instead the header's
  "About" panel gives short, platform-neutral install guidance.

## Persistence

Read state, saved stories and the evidence-panel preference live in
`localStorage` under `contextlab-briefing:v1`. If storage is unavailable
(private mode, denied permission), the app keeps working for reading and shows
a small honest notice that saves won't persist — it never pretends persistence
succeeded. No sensitive data is stored.

## Remove it completely

```sh
git rm -r prototypes/contextlab-briefing
```

Nothing outside this directory references it.

## Open decisions before any production implementation

1. **Real pipeline**: how editions are compiled (human editorial vs assisted),
   and how claim/source structure is authored and reviewed.
2. **Source verification policy**: what counts as verified, who signs off on
   confidence ratings, and how corrections are triggered and audited.
3. **Data contract home**: whether this story/claim/source schema becomes an
   API contract, and how it versions.
4. **Distribution**: standalone PWA vs a route inside the existing product,
   and how its design tokens reconcile with the FieldMap system.
5. **Sync**: whether read/saved state stays device-local or syncs to an
   account.
