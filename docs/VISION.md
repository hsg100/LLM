# FieldMap — Project Vision

FieldMap is an AI-powered research and education platform designed to help
someone understand complex LLM, AI, and machine learning fields as deeply and
quickly as possible.

It is not meant to be just another paper summariser. The real purpose is much
bigger: FieldMap should become a **personal research operating system** for
learning, mapping, understanding, revising, and building knowledge around
rapidly changing AI fields.

The core idea is simple:

> Give FieldMap a topic, and it builds you a structured research landscape,
> teaches you the field, tests your understanding, and stores the knowledge in
> a durable second-brain system.

For example, a user could enter:

- RAG evaluation
- LLM agents
- context engineering
- model distillation
- tool use in language models
- multi-agent systems
- LLM memory
- AI coding agents

FieldMap should then retrieve relevant papers, rank them, parse PDFs, extract
structured insights, map the relationships between ideas, generate a reading
path, create quizzes and flashcards, and export the resulting knowledge into an
Obsidian-style research vault.

The ambition is for FieldMap to become an optimal education and research
platform for everything related to LLMs.

---

## What problem FieldMap solves

Modern AI research moves too fast.

A person trying to learn a field like RAG, LLM agents, context engineering, or
model distillation faces several problems:

1. **There are too many papers.** A single topic can have hundreds or thousands
   of related papers, many of which are redundant, low quality, overly niche,
   or not suitable to read first.
2. **Search tools are fragmented.** arXiv, Semantic Scholar, OpenAlex, Google
   Scholar, Papers With Code-style resources, blogs, GitHub repos, and notes
   are all separate.
3. **Summaries are not enough.** A summary tells you what a paper says, but not
   how it fits into the field, why it matters, what came before it, what it
   contradicts, or whether you should read it now.
4. **Research papers assume too much background.** They use dense terms,
   abbreviations, hidden assumptions, benchmarks, datasets, and mathematical
   ideas that slow down learning.
5. **Learning is passive.** Most tools help you consume information, but they do
   not test you, make you retrieve knowledge, identify weak areas, or help you
   remember.
6. **Knowledge gets lost.** Even when you learn something, it often stays in a
   chat, a browser tab, a PDF folder, or a random note instead of becoming part
   of a durable knowledge system.

FieldMap is supposed to solve all of this by combining paper discovery,
research synthesis, concept mapping, active recall, and Obsidian-style
long-term knowledge management into one system.

---

## The core product loop

FieldMap's main workflow should look like this:

```txt
Topic
→ paper discovery
→ ranking
→ PDF parsing
→ structured extraction
→ field synthesis
→ concept map
→ reading plan
→ quiz/flashcards
→ Obsidian export
→ review and revisit
```

A user should be able to start with a plain-English query like:

> I want to understand RAG evaluation.

FieldMap should then build a complete research landscape:

- What the field is
- Why it matters
- The major subfields
- The key papers
- The foundational papers
- The newest papers
- The best papers to read first
- The papers to skip for now
- The main disagreements
- The open problems
- The implementation opportunities
- The key concepts to understand
- The quizzes and flashcards needed to retain it

This makes FieldMap much closer to an AI research tutor than a search engine.

---

## FieldMap as an education platform

The education side is central.

FieldMap should not just say:

> "Here are five papers on RAG evaluation."

It should say:

> "Here is the structure of the field. Start with these concepts. Read this
> survey first. Then read this benchmark paper. Then read this method paper.
> Skip these two for now because they are too narrow. These are the open
> problems. Now answer these questions to check whether you actually understood
> it."

That is the core educational philosophy.

FieldMap should optimise for:

- fast understanding
- deep understanding
- retention
- conceptual clarity
- research taste
- implementation ability

It should actively guide the user through the material, almost like a personal
AI professor.

### The learning path

For each topic, FieldMap should generate a reading path with stages:

- **Stage 1:** Beginner overview
- **Stage 2:** Prerequisite concepts
- **Stage 3:** Foundational papers
- **Stage 4:** Benchmark/evaluation papers
- **Stage 5:** Recent improvements
- **Stage 6:** Critiques and limitations
- **Stage 7:** Open problems and build opportunities

Each paper in the reading path should have a reason:

- Read this first because it defines the core problem.
- Read this next because it introduces the benchmark used by later papers.
- Read this after because it improves the evaluation method.
- Skip this for now because it is a niche extension.

That "why read this" rationale is one of the most important parts of the
product.

---

## FieldMap as a research platform

The research side is equally important.

FieldMap should map an entire research field, not just produce isolated notes.

For a topic like RAG evaluation, FieldMap should identify clusters such as:

- faithfulness evaluation
- retrieval quality metrics
- answer relevance
- context precision
- hallucination detection
- benchmark datasets
- human evaluation
- LLM-as-judge methods
- production monitoring

Then it should show how papers relate to one another:

- Paper A introduces a benchmark.
- Paper B critiques that benchmark.
- Paper C proposes a new metric.
- Paper D compares metric reliability.
- Paper E surveys the field.
- Paper F applies the benchmark to long-context models.

This is where the "map" in FieldMap matters.

The system should create structured outputs like:

- field structure DAG
- paper relationship graph
- concept graph
- timeline
- cluster map
- reading path
- open problem map

This lets the user understand not just individual papers, but the shape of the
field.

---

## Paper discovery and ranking

FieldMap should retrieve papers from sources such as:

- arXiv
- Semantic Scholar
- OpenAlex
- Crossref
- user-uploaded PDFs
- eventually GitHub/code sources
- existing Obsidian notes

But retrieval alone is not enough. The system needs to rank papers
intelligently.

Ranking should consider:

- semantic relevance to the query
- foundational importance
- citation/influence signals
- recency
- survey/tutorial value
- benchmark importance
- whether the paper introduces a method
- whether the paper introduces a dataset
- whether the paper has code
- whether the paper is readable for learning
- whether it is redundant with other selected papers

The output should not be a random list. It should categorise papers:

- **Must read**
- **Useful**
- **Optional**
- **Skip for now**

This is a major differentiator. Most tools return search results. FieldMap
should return a learning-optimised reading set.

---

## PDF parsing and source grounding

FieldMap should download and parse the actual PDFs, not rely only on titles and
abstracts.

For each paper, it should extract:

- abstract
- introduction
- method
- experiments
- results
- limitations
- conclusion
- references
- figures and captions where possible
- tables where possible

The important principle is **source-grounded extraction**.

Every major claim FieldMap makes should ideally trace back to the paper:

> **Claim:** The paper introduces a new faithfulness metric.
> **Source:** Method section, page 4, chunk 12.
> **Confidence:** 0.86.

This matters because AI-generated research tools can easily hallucinate.
FieldMap should be designed to say:

- Not reported
- Unclear from the paper
- Low confidence
- Source unavailable

rather than inventing a neat answer.

The goal is **trustworthiness**. A research assistant is only useful if the
user can trust where the information came from.

---

## Structured paper extraction

For each paper, FieldMap should produce a structured paper note.

A good paper extraction should include:

- problem
- motivation
- research question
- method
- contribution
- novelty
- results
- limitations
- assumptions
- datasets
- benchmarks
- baselines
- metrics
- implementation details
- mathematical ideas
- prerequisites
- key terms
- related papers
- open questions
- project ideas
- difficulty level
- reading priority
- confidence
- source grounding

The aim is to turn a dense PDF into a clean research object.

The user should be able to open a paper and immediately see:

- What problem is this solving?
- What exactly is new?
- How does the method work?
- What did they test?
- What were the results?
- What are the weaknesses?
- What do I need to know before reading it?
- Should I read this now?
- How does it connect to the rest of the field?

That is far more useful than a generic paragraph summary.

---

## Cross-paper synthesis

After extracting individual papers, FieldMap should synthesise across them.

This is one of the most important pieces.

The system should answer:

- What is this field really about?
- What are the main subfields?
- What are the main methods?
- What are the main benchmarks?
- What are the main disagreements?
- What are the open problems?
- What has changed over time?
- Which papers are foundational?
- Which papers are recent but important?
- Where could someone build a project?
- What should the user read first?

This synthesis should produce a research landscape, not just a literature
review.

Example output sections:

- Overview
- Why this field matters
- Field structure
- Major clusters
- Timeline
- Must-read papers
- Reading path
- Key concepts
- Paper relationships
- Tensions and disagreements
- Open problems
- Project ideas
- Skip-for-now papers

A good FieldMap output should make the user feel like they have been given a
guided tour of the field.

---

## Concept layer and interactive glossary

One of the strongest ideas for FieldMap is the **Concept Layer**.

Generated research text often contains dense terms:

- raw accumulation
- passive summarization
- context degradation
- retrieval precision
- faithfulness
- LLM-as-judge
- tool-use policy
- context compression
- semantic reranking

FieldMap should identify these important terms and make them interactive.

For example:

> Existing context management approaches (raw accumulation or passive
> summarization) treat context as a static artifact…

The terms should be highlighted. On hover or tap, the user sees a short
definition. On click, the user opens a concept detail page or concept map.

A concept object might include:

- term
- aliases
- short definition
- long definition
- why it matters
- related terms
- papers mentioning it
- source grounding
- confidence

This turns FieldMap into an interactive textbook.

It means the user can read research explanations without constantly opening new
tabs to understand terminology. The app itself teaches the surrounding
concepts.

In Obsidian, those concepts should become linked notes:

```txt
[[Raw accumulation]]
[[Passive summarization]]
[[Context compression]]
```

So the concept layer works both in the web app and in the long-term knowledge
vault.

---

## Active recall and testing

FieldMap should include active recall as a first-class feature.

This is what separates it from normal research tools.

For every landscape and paper, FieldMap should generate:

- multiple-choice questions
- flashcards
- explain-before-reveal questions
- paper comparison questions
- concept checks
- weak-area review
- daily review queue

The goal is not just to read. The goal is to prove understanding.

**Example MCQ:**

> Which problem does this paper primarily address?
> A. Reducing model size
> B. Improving retrieval evaluation
> C. Training a larger language model
> D. Compressing image embeddings

**Example flashcard:**

> **Q:** What is passive summarization in context management?
> **A:** A method where context is compressed or summarised without actively
> verifying whether the summary preserves important details or corrects earlier
> errors.

**Example explain-before-reveal:**

> Explain why raw accumulation can degrade long-horizon LLM agent performance.

This should eventually connect to spaced repetition, ideally using FSRS-style
scheduling, so users review concepts at the right time.

The educational target is:

- understand
- recall
- explain
- compare
- apply

Not just consume.

---

## Mobile learning mode

FieldMap should work differently on desktop and mobile.

**Desktop** should be for deep research:

- paper maps
- landscape overview
- PDF reading
- paper comparison
- export management
- graph exploration

**Mobile** should be for quick learning:

- flashcards
- MCQs
- short summaries
- reading queue
- weak-area review
- quick definitions

The mobile experience should not be a fake phone mockup inside the desktop app.
It should be a naturally responsive version of the actual product.

The long-term ideal is that a user researches on desktop, then reviews on
mobile.

---

## Obsidian integration

Obsidian is a core part of the system, not an afterthought.

FieldMap should not pollute the user's main vault. It should use a dedicated
Git-backed research vault or FieldMap section.

Generated notes should be exported as markdown:

```txt
Landscapes/
Papers/
Concepts/
Reading Plans/
Open Questions/
Project Ideas/
Flashcards/
Attachments/PDFs/
```

For each landscape, FieldMap should create:

- landscape note
- paper notes
- concept notes
- reading plan note
- quiz note
- flashcards note
- PDF attachments

Paper notes should include frontmatter:

```yaml
type: paper
source: ai-generated
status: draft
topic: RAG Evaluation
reading_priority: must-read
difficulty: intermediate
confidence: 0.84
```

Concept notes should include:

```yaml
type: concept
source: ai-generated
status: draft
landscape: RAG Evaluation
confidence: 0.82
```

The export should be deterministic and Git-backed:

- preview changes
- copy PDFs
- write markdown
- commit changes
- optionally push

The user can then review, edit, and promote the best notes into their main
vault.

This is important because FieldMap will generate a lot of material quickly. The
system should help create knowledge without turning the vault into a mess.

---

## Git-backed export philosophy

The app should avoid relying heavily on the Obsidian REST API. A Git-backed
export model is cleaner.

The system should write markdown and PDFs into a separate research repo, then
commit changes.

This gives:

- version history
- safe rollback
- no constant REST traffic
- clear generated-vs-human-edited separation
- easy sync
- safe isolation from main vault

The user's main Obsidian vault should remain protected.

FieldMap's generated knowledge should first live in:

```txt
FieldMap Research/
```

Then the user can manually promote valuable notes later.

---

## The technical architecture

FieldMap's architecture should support serious research workflows.

The intended stack is:

**Frontend:**

- Next.js
- Tailwind
- React components
- eventual graph visualisation

**Backend:**

- FastAPI
- RQ worker
- Redis
- Postgres + pgvector
- PDF parser
- LLM provider layer
- embedding provider layer

**Storage:**

- PDF storage volume
- parsed text/chunks
- Postgres metadata
- Git-backed Obsidian research vault

**Deployment:**

- Vercel frontend
- VPS backend
- Caddy/Nginx reverse proxy
- Postgres + Redis + worker on VPS

The architecture should be split like this:

- **Vercel** = frontend
- **VPS** = backend, worker, database, PDFs, Git export

This matters because the backend needs long-running jobs:

- paper retrieval
- PDF download
- PDF parsing
- embedding
- LLM extraction
- synthesis
- quiz generation
- export

Those are not ideal for Vercel serverless functions. They belong on a VPS with
persistent services.

---

## The backend pipeline

A typical FieldMap job should run like this:

1. Job created
2. Search papers
3. Deduplicate
4. Embed and rank
5. Download PDFs
6. Parse PDFs
7. Extract structured paper notes
8. Generate source grounding
9. Generate field synthesis
10. Generate field structure DAG
11. Generate paper relationship graph
12. Generate concepts
13. Generate quiz and flashcards
14. Export to Obsidian if requested
15. Mark job done

The user should see job progress in real time.

Each stage should emit events:

```txt
searching
deduplicating
embedding_ranking
downloading_pdfs
parsing_pdfs
extracting
synthesising
active_recall
exporting
done
```

This is important because jobs may take minutes. The app should never feel
frozen.

---

## The role of embeddings

Embeddings are how FieldMap understands semantic similarity.

They convert text into vectors, allowing the app to compare meaning
mathematically.

FieldMap should use embeddings for:

- ranking papers
- matching query to papers
- clustering papers
- linking similar concepts
- finding supporting chunks
- building concept maps
- retrieving relevant sections

The cost-free plan is to use local embeddings such as:

- `BAAI/bge-small-en-v1.5`
- `sentence-transformers/all-MiniLM-L6-v2`

These can run locally or on a VPS without API costs.

Paid embeddings can be added later, but the project should be able to work
without them.

---

## What makes FieldMap different

FieldMap is not trying to compete as a generic search engine.

Its differentiator is the full chain:

```txt
discover → rank → read → map → teach → test → export → review
```

Existing tools might do one or two of these well:

- **Elicit:** paper extraction
- **Research Rabbit:** paper discovery
- **Connected Papers:** citation maps
- **NotebookLM:** grounded Q&A
- **Anki:** flashcards
- **Obsidian:** knowledge storage

FieldMap should combine the useful parts into one personal system:

- research discovery
- field synthesis
- concept explanation
- active recall
- Obsidian export

The unique promise is:

> FieldMap helps you move from "I found some papers" to "I understand this field
> and can explain it."

---

## What the ideal user experience should feel like

The ideal experience should feel like this:

A user enters:

> LLM context engineering

FieldMap replies with:

- Here is the field.
- Here are the 5 things you need to understand first.
- Here are the 7 most important papers.
- Here is why each paper matters.
- Here is the relationship between them.
- Here are the key terms.
- Here is a map of the ideas.
- Here are the open problems.
- Here is a reading path.
- Here are flashcards and quizzes.
- Here are markdown notes in your research vault.

Then the user can:

- open a paper
- read the PDF inline
- see the structured extraction
- hover over hard terms
- click into concept definitions
- jump to related papers
- take a quiz
- export the notes
- review later on mobile

That is the product.

Not "AI summarises papers".

But:

> AI turns a research field into a guided, interactive, testable learning
> environment.

---

## Long-term vision

The long-term version of FieldMap could become a **personal AI research
university**.

A user could use it to master entire areas:

- RAG
- LLM agents
- AI safety
- model compression
- tool use
- multi-modal models
- reinforcement learning
- context engineering
- AI evaluation
- synthetic data
- AI coding agents

Each area would have:

- field maps
- paper maps
- concept maps
- reading plans
- quizzes
- flashcards
- project ideas
- Obsidian notes
- progress tracking

Eventually, FieldMap could know:

- what the user has read
- what the user understands
- what the user keeps getting wrong
- what concepts are weak
- what papers should come next
- what projects fit their level

It could become a personalised AI curriculum builder.

The best version would not just retrieve knowledge. It would help the user build
expertise.

---

## One-line description

> FieldMap is a personal AI research and learning engine that turns LLM and AI
> research fields into structured paper maps, concept maps, reading paths,
> quizzes, flashcards, and Obsidian-ready knowledge.

## Longer positioning statement

> FieldMap is designed to be an optimal education and research platform for LLMs
> and AI. It searches academic sources, ranks and parses papers, extracts
> source-grounded insights, synthesises entire research landscapes, explains key
> concepts inline, generates active recall material, and exports durable linked
> notes into a Git-backed Obsidian research vault. Its goal is not merely to
> summarise papers, but to help users understand, retain, and apply fast-moving
> AI research.
