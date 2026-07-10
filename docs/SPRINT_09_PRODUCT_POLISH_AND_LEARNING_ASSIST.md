# Sprint 9 — Product Polish, Learning Guidance, And AI Assist

## Goal

Make FieldMap feel like a polished learning product rather than a set of
separate research screens. This sprint fixes visible UX bugs, slows down noisy
live refresh behavior, improves cluster naming and learning suggestions, and
adds the first version of contextual "ask AI" help.

## Priority Fixes

1. **Browser tab icon**
   - Add a FieldMap favicon/app icon that appears in Chrome tabs and installable
     app contexts.
   - Use a simple, recognizable mark derived from the FieldMap identity: map
     node/grid + warm accent, readable at 16px.
   - Implement with Next app metadata conventions (`app/icon.*` and/or
     metadata `icons`) rather than only a manual `<link>`.
   - Acceptance: Chrome tab shows the FieldMap icon locally and in production.

2. **Cluster names still showing as generic "Cluster"** — ✅ already shipped
   (commit `2fe7212`, predates this doc). `apps/web/lib/clusters.ts` and
   `apps/api/app/workers/landscape_job.py` already implement the fallback
   chain described here; no action needed.

3. **`GET /api/jobs -> 404`** — partially done. The route is registered
   (`apps/api/app/api/routes.py`) and covered by a contract test
   (`test_jobs_index.py`), and the frontend already shows a recovery message
   on fetch failure (`apps/web/app/jobs/page.tsx`) — so the reported 404 is
   not reproducible at the code level. What's still missing: an automated
   post-deploy smoke check that exercises the *deployed* API surface (CI only
   runs `pytest` against a local TestClient); add that if this 404 recurs.

## Learning Discovery And Trending

### Current issue

The Search page "Trending now" block refreshes too quickly and appears to cycle
the same papers. It feels noisy without being meaningfully useful.

### Changes

- Slow the live refresh cadence:
  - default auto-refresh interval: 60-120 seconds;
  - pause refresh while the tab is hidden;
  - keep a manual Refresh button;
  - do not reset the list if the new payload is materially the same.
- Stop framing the panel as only "trending papers."
  - Add a **Suggested learning topics** section with durable topic prompts,
    e.g. RAG evaluation, LLM agents, tool use, context engineering, distillation,
    memory, multi-agent systems, AI coding agents.
  - Each topic card should include:
    - who it is for;
    - why it matters now;
    - suggested starting difficulty;
    - one-click "Build landscape."
- Add a lightweight **Suggested learning pathway** scaffold:
  - Beginner overview;
  - prerequisite concepts;
  - foundational papers;
  - benchmarks/evaluation;
  - recent improvements;
  - critiques/limitations;
  - open problems/build ideas.
- If we want truly current topic suggestions, run a separate deep-research pass
  outside the app implementation and seed/update the topic list from that output.

### Acceptance

- The panel does not visibly refresh every few seconds.
- Repeated refreshes do not keep flashing the same items.
- A new user can choose a learning topic without already knowing what to search.
- The search page feels like an educational starting point, not a stock ticker.

## Flashcards Recovery

### Current issue

Flashcards UI is bugged and unreadable.

### Changes

- Audit both standalone flashcards and review-mode flashcards:
  - `app/landscape/[id]/flashcards/page.tsx`
  - `components/learn/FlashcardInterior.tsx`
  - `app/landscape/[id]/review/page.tsx`
- Rebuild the card layout for readability:
  - stable card dimensions across mobile/desktop;
  - clear front/back typography;
  - no text overflow;
  - obvious reveal state;
  - keyboard support retained;
  - rating buttons readable and reachable on mobile.
- Treat long generated backs specially:
  - clamp with expand/collapse, or render as paragraphs;
  - avoid dense single-line blocks.

### Acceptance

- Cards are readable at mobile width and desktop width.
- Long flashcard text does not overflow or overlap.
- Reveal/rating flow works in both `/flashcards` and `/review`.

## Concept Explainability And Ask AI

### Term popups

- Keep the existing technical-term hover popup behavior (`ConceptText`) but
  make it feel deliberate and consistent across landscape overview, paper pages,
  reading plan, and synthesis text.
- Ensure popups contain simple definitions first, then optional deeper context.
- Mobile tap-to-open behavior — ✅ already shipped (commit `0b2432d`, predates
  this doc): `ConceptText` opens a full-screen bottom-sheet on tap, separate
  from the hover-only CSS tooltip.

### Highlight-to-Ask-AI

- Add a text-selection affordance:
  - when the user highlights text inside a landscape/paper/reading page, show a
    small "Ask AI" action near the selection;
  - clicking opens a right-side chat/explanation panel.
- The panel should receive:
  - selected text;
  - current page type and route;
  - landscape id;
  - nearby paper/concept ids where available;
  - relevant landscape synthesis, concepts, and paper notes as context.
- First response mode:
  - "Explain simply";
  - "Why this matters in the field";
  - "Connect to papers in this landscape";
  - "Make a flashcard from this."
- The assistant must cite which landscape/paper/concept context it used and be
  clear when it is guessing.

### API shape

- Add a new backend endpoint for contextual explanations, for example:
  - `POST /api/landscapes/{id}/explain-selection`
  - body: `{ selected_text, route, mode, paper_id?, concept_slug? }`
  - response: `{ answer, citations, suggested_flashcard? }`
- Use the configured LLM provider; provide a deterministic fallback in dev.

### Acceptance

- Highlighting text opens a useful explanation panel without navigating away.
- The answer uses landscape context, not generic web-chat context.
- The feature degrades gracefully if no LLM key is configured.

## Implementation Order

1. Add favicon and metadata.
2. Fix `/api/jobs` production/API-contract regression.
3. Improve cluster naming fallbacks and add tests.
4. Repair flashcards readability.
5. Replace noisy trending behavior with slower refresh + suggested learning
   topics/pathway.
6. Polish term popups across surfaces.
7. Build highlight-to-Ask-AI as a new contextual assistant panel.

## Test Plan

- Frontend:
  - `npm run build`
  - visual check mobile + desktop for Search, Flashcards, Review, Paper,
    Landscape Overview, and Field Map.
  - verify favicon in Chrome tab.
- Backend:
  - contract test for `GET /api/jobs`;
  - cluster naming fallback tests;
  - explanation endpoint tests with stub/dev provider.
- Manual:
  - no cluster UUIDs or generic bare labels in visible UI;
  - trending does not refresh faster than the configured interval;
  - flashcards are readable for long text;
  - highlight-to-Ask-AI explains selected text with landscape context.

