# Verification record — ContextLab Briefing prototype

Environment: Linux container, Node v22.22.2, Python 3.11.15, Chromium
(Playwright-managed build, driven via `playwright-core` installed in a
session scratchpad outside the repository — no repo dependency changes).
Date: 2026-07-16.

## Automated tests

Command (exact):

```sh
node --test "prototypes/contextlab-briefing/tests/*.test.mjs"
```

Result: **25/25 pass** (`# pass 25`, `# fail 0`).

Note: on this Node build, passing the bare directory to `--test` fails with
`MODULE_NOT_FOUND`; use the glob form above.

Coverage:

- **Fixture/data contract** (`fixtures.test.mjs`): edition provenance note
  discloses synthetic content; edition finite (5–8 stories); story/claim/source
  ID uniqueness and formats; all required fields; enum validity; every claim
  references existing sources; support-state rules (supported ⇒ ≥1 source,
  partially-supported ⇒ ≥1 source + caveat, unsupported ⇒ 0 sources + caveat);
  no story lacks claims, evidence status or an uncertainty section; sources use
  reserved `.example` URLs only; the fixture set exercises every support state,
  every confidence level, a correction, and the corrections empty state.
- **State model** (`model.test.mjs`): pure/idempotent read reducers; save
  round-trip; filters return finite, ordered, duplicate-free subsets; empty
  filter results; progress ignores stale IDs and detects caught-up (never on an
  empty edition); garbage-tolerant state normalisation; storage adapter honest
  when storage throws; store persists and rehydrates via a working adapter;
  in-memory operation when storage is denied; timezone-safe date formatting.
- **Service worker / shell references** (`sw.test.mjs`): every precached path
  exists on disk; shell + edition data are precached; every `index.html` asset
  reference exists; manifest parses, is standalone, and its icons exist.

Syntax: `node --check` clean on `app.mjs`, `model.mjs`, `sw.js` and all three
test files. `stories.json`, `manifest.webmanifest`, `story.schema.json` parse
as valid JSON.

## Browser verification (automated, headless Chromium via Playwright)

Served with `python3 -m http.server` from the prototype directory.
**59/59 checks passed.** Highlights by area:

- **Mobile 390×844**: feed renders all 7 cards, edition date and provenance
  note visible, progress "0 of 7"; no horizontal overflow on feed or story.
- **Feed ↔ story**: opening a card marks it read and focuses the story
  headline; back link returns to the feed with focus restored to the opened
  card; progress and per-card "✓ Read" update.
- **Browser history**: back/forward moves correctly between feed and story
  (hash routing).
- **Persistence**: save and read state survive a full reload
  (`localStorage`).
- **Filters**: Unread/Saved counts correct; empty saved state shows a real
  empty state with a working "Show all briefings" reset.
- **Caught up**: after reading all 7, the feed ends in the "You're caught up"
  block; progress "7 of 7".
- **Evidence**: claims render with support/confidence badges; the unsupported
  claim shows "No source substantiates this claim"; caveats visible;
  corrections empty state reads honestly; source entries are labelled as
  demonstration links.
- **PWA/offline**: service worker registers and activates; with the context
  offline, the feed and stories reload from cache; offline banner appears and
  the story view notes that external links need a connection.
- **Keyboard**: first Tab reaches the skip link; Enter moves focus to main;
  card links reachable and operable with Enter; story headline receives focus;
  visible 3px focus outline on interactive elements; no keyboard traps
  encountered in the tested flows.
- **Small mobile 320×568 and desktop 1280×800**: no horizontal overflow;
  desktop reading column bounded at 672px (centred, not stretched).
- **Reduced motion**: with `prefers-reduced-motion: reduce`, transition
  durations collapse to 0.01ms.
- **Storage unavailable**: with `localStorage` access throwing, the app shows
  the honest non-persistence notice and reading/opening stories still works.
- **Dark scheme**: dark tokens apply; About panel opens/closes with correct
  `aria-expanded`, includes platform-neutral install guidance.
- **Console**: zero console errors or page errors across every scenario.
- **No dead controls**: every rendered button is wired (all were exercised
  above); no anchor lacks an href.

Visual inspection of screenshots (mobile light feed, mobile evidence panel,
desktop dark feed) confirmed hierarchy, spacing and badge legibility in both
themes. Screenshots were not committed (kept out per review-size guidance).

## Checks not performed / manual caveats

- **Real-device install** (Android/iOS homescreen) and iOS Safari behaviour:
  not testable in this container. Manifest + SW registration verified in
  Chromium; iOS SVG icon limitation documented in README.
- **Lighthouse**: not run (no Lighthouse tooling available); no scores are
  claimed.
- **Screen-reader testing** (VoiceOver/NVDA/TalkBack): not available in this
  environment. Landmarks, names, live-region announcements and focus order
  were verified structurally via the DOM, not with assistive technology.
- **200% zoom**: not explicitly automated; the 320px-wide pass and relative
  (rem-based) sizing cover the equivalent reflow behaviour, but a manual zoom
  check in a desktop browser is recommended.
- **Contrast**: token pairs were chosen for ≥4.5:1 on their backgrounds, and
  badge text is bold at small sizes, but no automated contrast audit was run.
