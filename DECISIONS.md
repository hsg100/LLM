# Design Foundation — Decision Memo

**Status:** Awaiting approval. No code, config, or installs have been changed.
**Date:** 2026-07-11
**Scope:** `apps/web` (Next 14.2.5, React 18.3.1, Tailwind 3.4.6)

---

## 0. The headline: your premise doesn't hold

The plan assumed *"my token-layer plan needs v4 `@theme`, which doesn't exist in v3."*

**You already have a token system, and Tailwind isn't what's serving it.**

`app/globals.css` defines a complete, well-built two-theme token set as CSS custom
properties (`--bg`, `--panel`, `--accent`, `--t1..--t4`, `--good/--warn/--bad`, …) on
`:root` / `[data-fm="dark"]`. The app consumes it directly:

| Measure | Count |
|---|---|
| Inline `style={{…}}` in TSX | **790** |
| `className=` in TSX | 177 |
| `var(--token)` calls in TSX | **864** |
| Tailwind utilities actually emitted in the build | **~20** (`flex`, `block`, `hidden`, `border`, `absolute`, `md:*`…) |

This app is **not a Tailwind app**. It is an inline-style + CSS-variable app with
Tailwind installed for a handful of layout utilities.

That single fact reframes both decisions below. `@theme`'s job is to turn tokens into
*utilities* (`bg-panel`, `text-t1`). **Nothing in this codebase consumes theme
utilities today.** Upgrading to v4 for `@theme` would generate a token layer that
zero components read.

The real debt is not the Tailwind version. It is **790 inline styles and 56
`!important` declarations**. That is the design layer, and it is what any overhaul
must actually confront.

---

## 1. TAILWIND — upgrade 3.4.6 → v4?

### The case *for* (your argument, and it mostly survives)

- **The migration is genuinely near-free here.** I scoped the blast radius by reading
  the code, and it is close to zero:

  | v4 breaking change | Occurrences in this repo |
  |---|---|
  | `!` important prefix (moved to end) | **0** |
  | Arbitrary values w/ commas `[a,b]` | **0** |
  | `ring` / `ring-N` (default width 3px→1px) | **0** |
  | `shadow-sm`/`rounded-sm`/`blur-sm` renames | **0** |
  | `bg-opacity-*`/`text-opacity-*` (removed) | **0** |
  | `flex-shrink-*`/`flex-grow-*` (renamed) | **0** |
  | `outline-none` (semantics changed) | **0** |
  | `@apply` / `@layer` / custom utilities | **0** |
  | Tailwind plugins | **0** |

  `tailwind.config.js` is **12 lines** — a `content` glob and a `fontFamily` extend.
  Nothing else. Node is v23.9.0 (codemod needs 20+). `npx @tailwindcss/upgrade`
  would have almost nothing to do.

  > ⚠️ My first automated scan reported 148 `!important` and 126 arbitrary-comma hits.
  > **Those were false positives in my own grep** — CSS `!important` declarations and
  > JS array/generic syntax, not Tailwind classes. Verified: real count is 0 for both.
  > Flagging because "it looked scary, then it wasn't" is exactly the kind of thing
  > that should be auditable rather than quietly corrected.

- **OKLCH is real value for the palette you have.** Your accent (`#d4572a` warm rust)
  and paper neutrals are exactly the kind of palette where perceptual lightness
  matters. Deriving hover/active/disabled states from OKLCH beats hand-picking hex.

- **shadcn's current path is v4.** See §2/§3 — this is the decisive coupling.

### The case *against* (what I found)

- **v4 buys you nothing until the inline styles go.** This is the big one. `@theme`
  emits utilities; you have 790 inline styles reading `var(--*)` directly. Those CSS
  variables **already work in v3** — `var(--panel)` in an inline style is just CSS. You
  would ship a modern `@theme` block and see **zero visual or ergonomic change** until
  you also do the 790-style refactor. v4 is not the unlock; the refactor is.

- **🔴 The one real migration risk, and the codemod will not catch it.**
  `globals.css` contains **56 `!important` declarations** whose explicit job is to
  beat Tailwind's responsive utilities:

  ```css
  .hidden { display: none !important; }
  @media (min-width: 768px) {
    .md\:block  { display: block !important; }
    .md\:flex   { display: flex !important; }
    .md\:hidden { display: none !important; }
  }
  ```
  Plus ~50 more `.fm-*` mobile overrides, all `!important`.

  **v4 moves utilities into native CSS cascade layers (`@layer`), which changes
  specificity resolution.** These hand-written overrides are currently fighting the
  v3 cascade. Under v4's layering their interaction changes, and the failure mode is
  *silent*: responsive visibility (`.fm-mobile-hide`, `.fm-status-pill`,
  `.md\:hidden`) breaks at breakpoints, which a build will not catch. **This must be
  verified visually at 390px and 1440px, not by `next build`.**

  This is the single genuine risk in the upgrade, and it is specific to this codebase.

- **Browser floor rises.** v4 requires **Safari 16.4+ / Chrome 111+ / Firefox 128+**
  (it depends on `@property`, `color-mix()`, cascade layers). v3.4 has no such floor.
  ❓ *Needs your call — who is the audience?* For a research tool this is likely fine.

- **PostCSS rewiring on Next 14.** `tailwindcss` is no longer a PostCSS plugin; it
  becomes `@tailwindcss/postcss`, and `autoprefixer` + `postcss-import` get removed.
  Mechanical, but it touches build config on Next 14.2.5 (v4's best-tested path is
  Vite / Next 15).

### Recommendation: **Yes — upgrade. But not for the reason you gave.**

Upgrade because it is **as close to free as a major version migration ever gets in
this repo** (12-line config, 0 breaking utilities, Node 23), and because it is a hard
prerequisite for the shadcn path (§3). Do it *now*, while Tailwind is barely load-bearing
— the cost only rises once you start writing utilities.

But go in clear-eyed: **v4 is plumbing, not payoff.** The payoff is retiring the 790
inline styles onto a token-backed utility layer. If you upgrade and stop there, you
will have spent a day to change nothing a user can see.

### What the token system looks like if you stay on v3 (what you'd give up)

Honest answer: **less than you think.**

```js
// tailwind.config.js — v3
const tokens = {
  bg: 'var(--bg)', panel: 'var(--panel)', raised: 'var(--raised)',
  bd: 'var(--bd)', accent: 'var(--accent)', 'accent-ink': 'var(--accent-ink)',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', t4: 'var(--t4)',
};
module.exports = { theme: { extend: { colors: tokens } } };
```

That gives you `bg-panel`, `text-t1`, `border-bd` **today, in v3**, with your existing
`:root` variables and your existing `[data-fm="dark"]` switch. Theming keeps working
because the variable indirection does the work — exactly as it does now.

**What you actually give up by staying on v3:**
1. **OKLCH ergonomics** — you can still *use* OKLCH values in v3 (it's just CSS), but
   you don't get v4's `color-mix()`-based opacity/shade derivation for free.
2. `@theme`'s single-source-of-truth ergonomics (tokens live in CSS, not split between
   CSS and JS config).
3. The shadcn happy path (§2).

That's the whole list. **The v3 fallback is viable and not embarrassing.** If the
browser floor in §1 is a problem for your audience, take v3 without regret.

---

## 2. SHADCN — init it?

### What's actually there now

**No component primitives exist.** No Radix, no Headless UI, no react-aria — nothing.
`components/` is 7 feature folders (`auth`, `concepts`, `graph`, `landscapes`, `learn`,
`settings`, `shell`) of hand-rolled JSX.

The accessibility floor is **low**, across 61 TSX files:

| Signal | Count |
|---|---|
| `role=` | 3 |
| `aria-*` | 24 |
| `onKeyDown` | 2 |
| Focus traps / managed modals | **0** |

And a concrete defect, in `globals.css`:

```css
.fm-concept-wrap:hover  .fm-concept-popover,
.fm-concept-wrap:focus-within .fm-concept-popover { display: flex; }
```

The concept popover is **CSS-hover-driven**. No Escape-to-dismiss, no focus management,
no `aria-expanded`, no dismissable layer. `.fm-concept-sheet` is a hand-rolled modal
with **no focus trap** — keyboard users tab straight out of it into the page behind.
This is not a nitpick; it's a real barrier, and it will fail any WCAG audit you run
with the `fixing-accessibility` skill you just installed.

### The case *for* the floor

Correct dialog/popover/tooltip/tabs behaviour is **genuinely hard** — focus trap, focus
restore, Escape, click-outside, `aria-*` wiring, scroll lock, portal z-index. Radix has
solved it. Hand-rolling it is exactly how you end up with the hover-popover above.

### The case *against* — "the gravity"

Your brief is right to worry. shadcn's default look — `new-york` style, neutral HSL
palette, `rounded-md`, subtle borders — **is** the generic AI aesthetic you're trying to
escape. And you have a real, deliberate identity already (warm paper `#f4f2ec`, rust
`#d4572a`, `--warm`/`--warm-bd`, custom `fm-*` motion). Dropping shadcn in un-rewired
would flatten that.

**But the gravity is a discipline problem, not a technical one.** shadcn is not a
dependency — the CLI *copies source files into your repo*. You own every line and every
class. There is no lock-in. The pull toward default-looking output comes from *leaving
the defaults alone*, not from the tool.

### Recommendation: **Yes — but take the primitives, not the paint.**

Init shadcn, with one **non-negotiable mitigation**:

> **Rewire shadcn's theme variables to your `fm-*` tokens BEFORE generating a single
> component.** Map `--primary` → `--accent`, `--background` → `--bg`, `--card` →
> `--panel`, `--border` → `--bd`, `--muted-foreground` → `--t3`, and so on. Then no
> component ever renders in shadcn's palette, not even once.

Adopt narrowly — you need maybe four primitives (`dialog`, `popover`, `tooltip`,
`tabs`) to fix the real a11y holes. You do **not** need shadcn's `button`/`card`/`input`;
you have a visual language for those already, and those are precisely the components
that make an app "look like shadcn".

**The alternative, if you want zero aesthetic gravity:** skip the CLI and add
`@radix-ui/react-{dialog,popover,tooltip,tabs}` directly, wrapping them in your own
`fm-*`-styled components. Same accessibility floor, no generated styling to fight, at
the cost of writing the wrappers yourself. Given your brief says *"must not look like a
shadcn app"* **this is a defensible choice and I'd support it** — it's ~4 wrappers.

*My lean: shadcn CLI with the token rewire, because the generated code is a useful
reference for the wiring even if you restyle it to nothing. But Radix-direct is the
lower-risk read of your own brief. Your call.*

---

## 3. SEQUENCE — order of operations

Order matters because **`shadcn init` inspects your Tailwind version and generates
different output**: on v3 it emits the legacy HSL-variable structure; on v4 it emits
`@theme inline` + OKLCH. Init on v3 then upgrade, and you migrate shadcn's generated
code too — doing the same work twice.

| # | Step | Gate before proceeding |
|---|---|---|
| 0 | **Decide the browser floor** (Safari 16.4+ / Chrome 111+). Blocks everything. | Your call |
| 1 | **Branch.** Tailwind upgrade only. `npx @tailwindcss/upgrade`. | Clean branch |
| 2 | Swap PostCSS: `tailwindcss` → `@tailwindcss/postcss`; drop `autoprefixer`, `postcss-import`. | `next build` passes |
| 3 | 🔴 **Verify the `!important` cascade.** Screenshot **390×844 and 1440×900** and diff against pre-upgrade. This is where the 56 `!important` overrides will break, silently. | **Visual diff, not a build** |
| 4 | **Port `fm-*` tokens into `@theme`** as OKLCH. Keep `[data-fm="dark"]` switching. | Both themes render |
| 5 | **`shadcn init`** — now detects v4, emits `@theme inline` + OKLCH. | `components.json` created |
| 6 | **Rewire shadcn vars → `fm-*` tokens.** *Before any component is generated.* | No shadcn palette anywhere |
| 7 | Add **only** `dialog`, `popover`, `tooltip`, `tabs`. Replace the hover-popover and the untrapped `.fm-concept-sheet`. | a11y audit passes |
| 8 | **The actual work:** retire 790 inline styles + 56 `!important` onto token utilities. Incremental, per feature folder. | Per-folder visual diff |

**Steps 1–3 are reversible and cheap. Step 8 is the overhaul.** Don't let 1–7 feel like
progress — they're setup.

---

## 4. Open questions for you

1. **Browser floor** — is Safari 16.4+ / Chrome 111+ / Firefox 128+ acceptable? *(blocks §1)*
2. **shadcn CLI + token rewire, or Radix-direct?** *(§2 — I lean CLI, you may prefer Radix)*
3. Do you accept that **v4 alone changes nothing visible**, and the value is in step 8?

---

## Appendix — provenance

Codebase claims (counts, config, CSS) come from reading `apps/web` at commit `6df40fa`.

**Tailwind v4 and shadcn claims were fetched from the live docs, not recalled from
training data** — `tailwindcss.com/docs/upgrade-guide` and `ui.shadcn.com/docs/tailwind-v4`.

⚠️ **These were fetched via WebFetch, not Context7.** Context7 was not installed when
this memo was written; I have since added it (`claude mcp add context7 -s user`), but
**MCP servers load at session start**, so it was not callable in-session. The
requirement — *current docs, not training data* — is met; the mechanism differs from
what you asked for. Re-run any doc claim through Context7 next session if you want it
confirmed through the intended path.
