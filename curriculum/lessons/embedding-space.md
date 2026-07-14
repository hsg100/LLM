---
slug: embedding-space
title: Embedding space
topic: embeddings-and-representation
version: 1
duration_minutes: 10
objectives:
  - Explain what an embedding vector represents
  - Interpret cosine similarity between embeddings
  - Explain why 2D visualisations are projections of a much higher-dimensional space
concepts:
  - embedding
  - vector-similarity
demos:
  - embedding-space-explorer
demo_fallbacks:
  embedding-space-explorer: >-
    Example similarities from a small embedding model: "cat" and "kitten"
    score around 0.85; "cat" and "car" around 0.4 despite differing by one
    letter; "bank" sits between "river" and "money", reflecting both of its
    senses. The numbers vary by model, but the pattern — similarity tracks
    meaning, not spelling — is the durable point.
checkpoint:
  slug: embeddings-checkpoint
  kind: concept-check
  pass_score: 0.8
  questions:
    - id: q-what
      prompt: What is a token embedding?
      options:
        - A compressed copy of the training data
        - The token's dictionary definition
        - The token's position in the vocabulary, in binary
        - A learned vector of numbers representing the token
      correct_index: 3
      concept: embedding
    - id: q-similar
      prompt: Two words have cosine similarity 0.9 in an embedding model. What does that suggest?
      options:
        - They are spelled similarly
        - The model treats them as closely related in meaning or usage
        - They always appear together in text
        - They have the same number of tokens
      correct_index: 1
      concept: vector-similarity
    - id: q-projection
      prompt: A 2D scatter-plot of embeddings shows two words far apart. What can you conclude?
      options:
        - Little by itself — 2D plots are lossy projections of hundreds of dimensions
        - The words are unrelated in the model
        - The embedding model is broken
        - The words are in different languages
      correct_index: 0
      concept: embedding
sources:
  - id: mikolov-2013-word2vec
    url: https://arxiv.org/abs/1301.3781
    title: Efficient Estimation of Word Representations in Vector Space
  - id: vaswani-2017-attention
    url: https://arxiv.org/abs/1706.03762
    title: Attention Is All You Need (embeddings as transformer input)
---

## From IDs to meaning

Token IDs are arbitrary — token 4091 is not "bigger" than token 517. The
first thing a model does is replace each ID with its **embedding**: a learned
vector of hundreds or thousands of numbers. These vectors are parameters,
tuned during training so that tokens used in similar ways end up with
similar vectors.

Nobody assigns the dimensions meanings. Whatever structure exists — and a lot
does — was discovered by the training process, not designed.

## Similarity is geometry

Because meanings are now points in space, "how related are these?" becomes a
geometric question. The usual measure is **cosine similarity**: 1.0 for
vectors pointing the same way, near 0 for unrelated ones.

The important intuition: similarity tracks *usage*, not spelling. "cat" and
"kitten" score high; "cat" and "car" don't, one letter apart notwithstanding.
Words with several senses ("bank") sit in compromise positions pulled toward
each of their uses.

## Predict before you look

Before checking similarities in any embedding tool, rank these pairs:
("doctor", "nurse"), ("doctor", "document"), ("small", "tiny"),
("small", "large"). The last pair is the interesting one — antonyms often
score *high*, because they appear in the same contexts. Similar usage is not
the same thing as similar meaning.

## The flat-map caveat

Any picture of embedding space on a screen is a **projection** from hundreds
of dimensions down to two. Projections must throw information away: points
that look close may be far apart in the real space, clusters can be artefacts
of the projection method, and different runs of the same method can produce
different layouts. Treat 2D maps as sketches for intuition, never as ground
truth.

## Why this matters later

Embeddings are the currency everything else trades in: attention decides how
much information flows between tokens by comparing vectors derived from
embeddings, and retrieval systems find "relevant" documents by nearest-vector
search. If similarity-as-geometry makes sense, both of those will too.
