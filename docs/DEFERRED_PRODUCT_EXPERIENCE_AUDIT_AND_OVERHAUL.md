# Deferred FieldMap Product Experience Audit and Overhaul

**Status:** Logged strategic review — implementation deferred until the current learning-platform roadmap is complete  
**Prepared:** 13 July 2026  
**Repository:** `hsg100/LLM`  
**Intended repository path:** `docs/DEFERRED_PRODUCT_EXPERIENCE_AUDIT_AND_OVERHAUL.md`  
**Related plan:** `docs/FIELDMAP_LEARNING_PLATFORM_RECOVERY_PLAN.md`

---

## 1. Purpose of this document

FieldMap has accumulated a substantial set of valuable capabilities: research discovery, landscapes, papers, concept maps, reading plans, quizzes, flashcards, review, exports and now a learning-platform direction. The next strategic question is not simply whether any one screen or navigation pattern should be repaired.

The broader concern is:

> **Do the features we have built combine into the clearest, smoothest and most useful way for someone to learn and research, or has the product inherited too much friction from the order in which those features were developed?**

The landscape-centric experience and visible unusable controls are examples of this concern. They are not assumed to be the root problem, the full scope of the problem or the only things requiring change.

Once the current Fable roadmap is complete, FieldMap should undergo a comprehensive product-experience audit followed by an evidence-based overhaul. The audit must be permitted to question the entire way the application is entered, understood, navigated and used. It may recommend small quality-of-life improvements, consolidation of existing features, new workflow orchestration, changes to information architecture or deeper structural changes.

This document records that future work so it is not reduced later to an isolated UI cleanup.

---

## 2. Problem statement

FieldMap's individual features may function correctly while the complete product remains harder to use than it should be.

Potential symptoms include:

- users are presented with system concepts before their own goals;
- it is not always clear where to begin or what to do next;
- navigation and available actions change depending on hidden or poorly explained context;
- unavailable actions remain visible;
- related features live on separate screens without a smooth workflow between them;
- the same goal may require too many page changes or context switches;
- users must understand implementation terms such as landscapes, jobs or pipeline states;
- global tasks such as learning, reading, finding and reviewing can feel artificially scoped;
- current functionality may be duplicated, fragmented, poorly named or difficult to discover;
- empty, loading, partial, degraded and error states may not guide recovery well;
- background research jobs may expose operational complexity instead of giving calm, useful feedback;
- returning users may not be brought directly back to the most valuable next action;
- mobile navigation may technically fit while still demanding too much context and movement;
- settings, administration and operational tools may compete with primary user journeys;
- the application may lack small quality-of-life behaviours that make mature software feel effortless.

The audit must distinguish among:

1. defects;
2. missing polish;
3. weak interaction design;
4. poor feature composition;
5. unclear information architecture;
6. inappropriate exposure of backend/domain structure;
7. genuine domain-model limitations.

The answer should not be predetermined as “fix the UI” or “rewrite the core.”

---

## 3. Strategic objective

Rebuild FieldMap's overall product experience around what users are trying to accomplish.

The target experience should make it easy to:

- understand what FieldMap offers;
- begin a valuable task immediately;
- learn an LLM concept;
- continue a learning pathway;
- research a topic;
- find and read relevant papers;
- understand the relationship between concepts and research;
- return to unfinished work;
- review weak or due material;
- move between explanation, evidence and active recall;
- manage or export work when desired;
- understand background progress without supervising the system;
- recover from empty, failed or partial states;
- use the product comfortably on desktop and mobile.

The overhaul should result in a product that feels deliberately designed as one system rather than a collection of individually completed features.

---

## 4. This is not a landscape-only review

The landscape experience must be audited, but only as one part of the complete product.

Examples of legitimate questions include:

- Should landscapes remain prominent, be reframed, be demoted or remain unchanged?
- Should Learn, Research, Read and Review be more global?
- Is the current homepage the correct starting point once all phases ship?
- Are quizzes, flashcards and review separate features or parts of one learning loop?
- Should reading plans and learning pathways remain separate?
- Do paper pages provide the correct route back into concepts, learning and review?
- Are jobs a user-facing destination or background system activity?
- Are search, new landscape creation and research discovery the same flow?
- Are current navigation labels meaningful to new users?
- Which features deserve primary placement, secondary placement, consolidation or removal?
- Does the application adapt appropriately between a first-time learner, a returning learner and a research-oriented power user?

The audit may conclude that landscape-centric navigation is a major issue, a minor issue or merely one visible consequence of a broader workflow problem.

---

## 5. Scope of the future audit

### 5.1 Product proposition and audience

Audit:

- the product's one-sentence proposition;
- its primary and secondary users;
- the relationship between learning and research;
- what the product should optimise for on first use and repeated use;
- whether the experience serves beginners, technical learners and research-oriented users coherently;
- which use cases are core, supporting or out of scope.

Deliverable: a prioritised set of users, jobs-to-be-done and product promises.

### 5.2 First-run experience and onboarding

Audit:

- login and first landing experience;
- explanation of what FieldMap is;
- whether users must configure providers before receiving value;
- first useful action;
- sample/demo content;
- terminology introduction;
- onboarding progression;
- permission, empty-data and unavailable-provider states.

Deliverable: a first-session journey that reaches useful value quickly without requiring knowledge of the system's internal architecture.

### 5.3 Home and return experience

Audit:

- what belongs on the homepage;
- how “continue” is calculated;
- due review visibility;
- active jobs and recent research;
- incomplete lessons and reading;
- recommendations;
- whether the homepage changes meaningfully as the user accumulates work.

Deliverable: a home experience that reliably presents the best next actions rather than a static collection of links.

### 5.4 Information architecture and navigation

Audit:

- global, contextual and object-specific navigation;
- desktop and mobile navigation parity;
- breadcrumbs, back behaviour and context switching;
- locked, hidden and disabled actions;
- route depth and naming;
- command palette behaviour;
- search and global discovery;
- how users move among learning, concepts, papers, research and review.

The landscape navigation issue belongs here as one example.

Deliverable: current-state and recommended future-state information-architecture maps.

### 5.5 End-to-end workflows

Perform full cognitive walkthroughs for at least these tasks:

1. Learn how an LLM concept works.
2. Continue a partially completed learning pathway.
3. Research an unfamiliar topic.
4. Build or refresh a research collection.
5. Find the best paper for a particular question.
6. Read and understand a paper.
7. Move from a paper to prerequisite concepts.
8. Create or encounter useful active-recall material.
9. Review everything currently due.
10. Recover weak areas.
11. Return to work started previously.
12. Export useful knowledge to Obsidian.
13. Understand and recover from a failed or degraded research job.
14. Use the core product from a phone.

For every workflow record:

- starting assumption;
- number of steps;
- context switches;
- decisions required;
- hidden dependencies;
- wait states;
- dead ends;
- duplicated actions;
- terminology burden;
- recovery path;
- emotional/cognitive friction.

Deliverable: journey maps and a prioritised friction register.

### 5.6 Feature inventory and feature cohesion

Inventory every meaningful capability and determine:

- intended user goal;
- actual entry points;
- dependencies;
- whether it is global or scoped;
- discoverability;
- overlap with other features;
- output and next action;
- whether it is complete, partial, duplicated, obsolete or underused;
- whether it should be retained, improved, combined, repositioned or removed.

Relevant features include, but are not limited to:

- home;
- Learn and curriculum;
- landscapes;
- new research/search;
- jobs;
- overview and synthesis;
- maps and relationships;
- paper lists;
- paper reading/PDF;
- concepts and definitions;
- reading plans and depth tracks;
- quizzes;
- flashcards;
- review and FSRS;
- weak areas;
- contextual assistance;
- export;
- settings;
- authentication and administration;
- command palette;
- mobile navigation.

Deliverable: feature matrix with keep, fix, combine, reposition, replace or remove recommendations.

### 5.7 Domain concepts exposed to users

Audit whether the UI exposes internal implementation structure unnecessarily, including:

- landscapes;
- jobs and pipeline stages;
- clusters;
- generated versus curated content;
- providers and runtime settings;
- concept ownership;
- landscape-specific review items;
- background worker constraints.

The question is not whether these concepts are valid internally. The question is whether users need to understand them to obtain value.

Deliverable: a terminology and abstraction review separating internal domain language from user-facing language.

### 5.8 Interaction design and quality-of-life

Audit the small behaviours that determine whether the application feels polished:

- consistent primary and secondary actions;
- saved state and resumption;
- sensible defaults;
- confirmation and undo;
- keyboard shortcuts;
- batch actions;
- sorting and filtering;
- remembering user choices;
- cross-page continuity;
- deep links;
- loading skeletons;
- progress feedback;
- notifications;
- inline help;
- copy/share/export actions;
- scroll and focus preservation;
- full-screen and distraction-free reading;
- readable long content;
- search-within-content;
- consistent empty and error states;
- prevention of accidental duplicate work;
- clarity around stale versus current research.

Deliverable: a quality-of-life backlog ranked by user value, frequency, risk and effort.

### 5.9 Visual hierarchy and design-system consistency

Audit:

- typography and information density;
- hierarchy of actions and content;
- card, badge, status and navigation consistency;
- use of colour;
- responsive layouts;
- graph readability;
- long-form reading;
- interactive lesson presentation;
- state communication;
- whether legacy screens and new learning screens feel like one product.

Deliverable: a visual consistency report and targeted design-system changes, not an indiscriminate reskin.

### 5.10 Asynchronous work and system feedback

Audit:

- what happens when research takes time;
- whether users must monitor jobs;
- cancellation and retry;
- partial and degraded results;
- stale results;
- background completion notifications;
- how completed work returns the user to value;
- whether operational logs are separated from user-oriented progress.

Deliverable: a unified background-work experience.

### 5.11 Performance, reliability and perceived speed

Audit:

- page and interaction latency;
- request fan-out;
- repeated fetching;
- large visualisation performance;
- mobile performance;
- caching and prefetching;
- optimistic and progressive rendering;
- provider failures;
- offline/degraded states;
- whether the interface communicates useful progress.

Deliverable: a performance and resilience backlog tied to user-visible outcomes.

### 5.12 Mobile, accessibility and input methods

Audit:

- phone-first workflows, not only responsive fit;
- touch targets and gestures;
- keyboard navigation;
- focus management;
- screen-reader semantics;
- reduced motion;
- contrast;
- graph alternatives;
- long-form reading;
- orientation and viewport changes.

Deliverable: accessibility and mobile task-completion report.

### 5.13 Settings, administration and operational tooling

Audit whether configuration and operational controls are:

- understandable;
- placed appropriately;
- safe;
- necessary for ordinary users;
- separated from primary product workflows;
- capable of explaining consequences before changes are applied.

Deliverable: a simplified settings and administration model.

### 5.14 Analytics and feedback

Determine what evidence is required to understand real use:

- first useful action;
- pathway starts and completions;
- research starts and completions;
- failed jobs and recovery;
- navigation dead ends;
- use of disabled controls;
- review completion;
- return frequency;
- feature discovery;
- mobile abandonment;
- search failure;
- export use.

Deliverable: a privacy-conscious product telemetry plan and structured feedback mechanism.

---

## 6. Audit methodology

The future audit should combine:

1. **Repository inspection** — routes, components, APIs, models, state and dependencies.
2. **Screen and feature inventory** — every production surface and state.
3. **Heuristic evaluation** — consistency, visibility, control, error prevention, recognition and efficiency.
4. **Cognitive walkthroughs** — task completion from a new and returning user's perspective.
5. **Dependency mapping** — which features rely on landscapes, users, jobs, providers, papers and concepts.
6. **Usability testing** — representative users attempting representative tasks without coaching.
7. **Telemetry review** — where available, grounded in actual behaviour rather than assumptions.
8. **Comparative research** — study excellent learning, research, reading and knowledge products without copying their surface appearance.
9. **Prototype testing** — compare alternative flows before committing to core changes.
10. **Engineering impact assessment** — migration, compatibility, performance and operational consequences.

The audit must examine the live product and real flows. Static screenshots alone are insufficient.

---

## 7. Required audit outputs

The audit is not complete until it produces:

1. **Executive diagnosis** — the small number of systemic problems causing the most friction.
2. **Current-state product map** — routes, features, contexts and dependencies.
3. **Jobs-to-be-done hierarchy** — primary goals around which the product should be organised.
4. **Journey maps** — first use, learn, research, read, review, resume, export and recovery.
5. **Feature disposition matrix** — keep, fix, combine, reposition, replace or remove.
6. **Friction register** — evidence, severity, frequency, affected users and likely cause.
7. **Quality-of-life backlog** — prioritised improvements with acceptance criteria.
8. **Alternative future-state structures** — at least three credible options.
9. **Prototype comparison** — low-fidelity or interactive prototypes tested against key tasks.
10. **Recommended future-state information architecture and workflows.**
11. **Architecture impact report** — what can change in the frontend versus what requires API/data restructuring.
12. **Phased overhaul plan** — quick wins, workflow repairs, structural changes and polish.
13. **Compatibility and rollback plan** — preservation of existing data, links and exports.
14. **Success metrics** — observable evidence that the new experience is better.

---

## 8. Decision framework

Every proposed change should be evaluated against:

- reduction in steps and context switching;
- clarity for first-time users;
- value for returning users;
- frequency of the affected task;
- improvement in feature discoverability;
- continuity across Learn, Research and Review;
- mobile and accessibility benefit;
- preservation of data and existing capability;
- implementation and migration risk;
- reversibility;
- ongoing maintenance cost;
- whether the proposal solves a cause or merely hides a symptom.

Prioritisation should distinguish:

- **critical blockers** — users cannot complete important tasks;
- **systemic friction** — repeated cost across multiple workflows;
- **high-value quality-of-life** — frequent improvements with modest risk;
- **strategic restructuring** — larger changes justified by strong evidence;
- **cosmetic polish** — worthwhile only after the workflow is sound.

---

## 9. Principles for the eventual overhaul

The recommended design should follow these principles unless evidence strongly supports an exception:

1. **Goal-first:** organise the product around user intentions rather than implementation containers.
2. **Progressive disclosure:** show advanced or contextual controls when relevant.
3. **No unexplained dead controls:** do not present actions that cannot be used without explaining or resolving the prerequisite.
4. **Continuity:** preserve the user's task, state and context across screens.
5. **Global discoverability:** make knowledge findable without remembering where it was created.
6. **Calm background work:** allow the system to work without demanding supervision.
7. **Useful defaults:** reduce configuration and repetitive decisions.
8. **Fast recovery:** errors and partial results should offer a clear next action.
9. **One coherent learning loop:** explanation, reading, assessment and review should reinforce one another.
10. **Mobile task completion:** mobile support means completing meaningful workflows, not merely avoiding overflow.
11. **Accessible alternatives:** every key interaction must have an understandable non-visual or reduced-motion form.
12. **Preserve valuable capability:** simplify how features are used without casually discarding working research infrastructure.
13. **Incremental and reversible:** validate structural changes before broad migration.

---

## 10. Relationship to the current Fable roadmap

The current learning-platform roadmap should continue to completion. This document should not trigger an immediate redesign or create scope drift in the active phases.

During the current phases:

- complete approved phase outcomes;
- avoid speculative core restructuring;
- do not perform isolated “fixes” merely to satisfy this future audit;
- log newly observed usability friction without expanding the active phase;
- preserve compatibility and data;
- avoid unnecessary new coupling when an equally simple neutral design exists;
- keep new learning functionality globally accessible as already specified;
- keep research enrichment optional and asynchronous;
- retain honest empty, loading, partial and error states;
- do not claim the new shell is the final product experience.

The formal audit begins after the existing roadmap is complete and stable enough to evaluate as one product.

---

## 11. Future overhaul sequence

After the current roadmap finishes:

### Stage A — Observe and diagnose

- run the complete audit;
- collect workflows, evidence and friction;
- identify systemic causes;
- avoid implementation except for critical defects.

### Stage B — Redesign the product model

- define jobs-to-be-done;
- create alternative information architectures;
- prototype key workflows;
- test with representative users;
- select and record the future direction.

### Stage C — Ship high-confidence quality-of-life improvements

- implement frequent, low-risk improvements that remain valid under the selected architecture;
- improve defaults, continuity, state, recovery, navigation and feedback;
- measure their effect.

### Stage D — Implement structural workflow changes

- consolidate or reposition features;
- introduce global aggregation where justified;
- adjust routes, APIs or ownership incrementally;
- preserve old links and data;
- use feature flags and reversible migrations.

### Stage E — Unify and polish

- remove deprecated paths only after verified replacement;
- align the design system;
- complete mobile and accessibility work;
- optimise performance;
- validate the entire product again.

---

## 12. Explicit non-decisions

This document does not currently decide:

- whether landscapes should remain, be demoted, renamed or replaced;
- whether the existing homepage is correct;
- whether navigation needs adjustment or replacement;
- whether quizzes and flashcards should merge;
- whether review should be fully global;
- whether papers and concepts require different ownership;
- whether the backend domain model must change;
- whether a beginner and power-user interface should differ;
- which features should be removed;
- whether the final overhaul is small or fundamental.

Those decisions must follow the audit.

---

## 13. Definition of done

The future audit and overhaul are complete when:

1. FieldMap's primary users and jobs-to-be-done are explicit.
2. A new user can understand the product and reach useful value quickly.
3. Returning users receive a clear and accurate next action.
4. Learn, Research, Read and Review operate as one coherent experience.
5. Important features are discoverable without understanding backend architecture.
6. Contextual controls appear when meaningful and do not create unexplained dead ends.
7. The highest-frequency workflows require fewer steps and context switches.
8. Background work is understandable without being intrusive.
9. Empty, partial, degraded and error states guide recovery.
10. Mobile users can complete the core tasks.
11. Feature duplication and fragmentation have been resolved deliberately.
12. Quality-of-life improvements are prioritised and measured.
13. Any core restructuring preserves existing data and has a rollback path.
14. Usability evidence demonstrates that the revised product is materially easier and smoother to use.

The governing principle is:

> **Do not optimise individual screens in isolation; redesign how FieldMap's capabilities work together to help someone achieve a goal.**

