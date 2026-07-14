---
slug: attention-routing
title: Attention as routing
topic: attention
version: 1
duration_minutes: 12
objectives:
  - Explain queries, keys and values at an intuitive level
  - Interpret a simple attention-weight matrix
  - Predict how causal masking changes information flow
concepts:
  - attention
  - query-key-value
  - causal-mask
demos:
  - attention-explorer
demo_fallbacks:
  attention-explorer: >-
    Example: in "The animal didn't cross the street because it was too
    tired", attention weights from the token "it" concentrate on "animal"
    rather than "street" — the model routes information from the likely
    referent. With causal masking, "it" can draw on every earlier token but
    on nothing after itself.
checkpoint:
  slug: attention-checkpoint
  kind: concept-check
  pass_score: 0.8
  questions:
    - id: q-role
      prompt: What does attention fundamentally do in a transformer?
      options:
        - Compresses the vocabulary
        - Moves information between token positions, weighted by learned relevance
        - Decides which tokens to delete
        - Stores the training data for lookup
      correct_index: 1
      concept: attention
    - id: q-qkv
      prompt: In the query/key/value picture, what is a token's query?
      options:
        - What the token is looking for in other tokens
        - What the token hands over when selected
        - The token's position in the sequence
        - The token's dictionary form
      correct_index: 0
      concept: query-key-value
    - id: q-mask
      prompt: With causal masking, which tokens can position 5 attend to?
      options:
        - All tokens in the sequence
        - Positions 6 onward only
        - Positions 1–5 only
        - Only position 4
      correct_index: 2
      concept: causal-mask
    - id: q-limits
      prompt: A head's attention weights point strongly from "it" to "animal". What is the safest conclusion?
      options:
        - The model has fully resolved the pronoun, and this weight explains its reasoning
        - Information flowed from "animal" toward "it" in this head — one ingredient, not a complete explanation
        - The model will output "animal" next
        - Attention weights are meaningless
      correct_index: 1
      concept: attention
sources:
  - id: vaswani-2017-attention
    url: https://arxiv.org/abs/1706.03762
    title: Attention Is All You Need
  - id: jain-2019-attention-not-explanation
    url: https://arxiv.org/abs/1902.10186
    title: Attention is not Explanation (interpretation caveats)
---

## The problem attention solves

After embedding, each token is a vector that knows nothing about its
neighbours. "it" means little until something connects it to "the animal".
**Attention** is the mechanism that moves information between positions — and
crucially, *how much* moves is computed from the content itself, not fixed in
advance.

## Queries, keys and values

Each token's vector is projected three ways, and the names describe the
roles:

- **query** — what this token is looking for;
- **key** — how this token advertises what it contains;
- **value** — what this token actually hands over if selected.

Every query is compared against every key; well-matched pairs get high
scores. The scores are normalised into weights that sum to 1, and each token
receives the weighted mixture of the values. Several **heads** run this in
parallel, each free to learn a different routing pattern.

## Reading an attention matrix

Lay the sequence along both axes: each row is a receiving token, each entry
that row's weight on a sending token. A row concentrated on one column means
"this token pulled almost everything from there"; a spread-out row means a
broad mixture. In "…because it was too tired", the row for "it" putting most
of its weight on "animal" is the classic example of content-dependent
routing.

## Predict, then flip the mask

The **causal mask** enforces generation order: position *n* may attend to
positions 1…*n* and nothing later. Before toggling a mask in any
visualisation, predict what must change: every weight above the diagonal is
forced to zero, and the last token — the one about to predict what comes
next — can see everything while influencing nothing behind it.

## What attention weights don't tell you

A high weight shows that information flowed in a particular head. It does not
show *why*, and it is not a complete account of the model's reasoning —
information also mixes through the feed-forward layers and across dozens of
stacked blocks, and research (see the sources) cautions directly against
reading attention maps as explanations. Treat them as one legible ingredient
in a much larger computation.
