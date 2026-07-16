---
slug: tokens-and-tokenisers
title: Tokens and tokenisers
topic: tokens-and-tokenisation
version: 1
duration_minutes: 10
objectives:
  - Explain why models operate on tokens rather than characters or words
  - Predict roughly how a tokenizer will split unfamiliar text
  - Connect token counts to context limits and cost
concepts:
  - token
  - tokenizer
  - context-window
demos:
  - tokenization-lab
demo_fallbacks:
  tokenization-lab: >-
    Example: the sentence "Unbelievable prices in Reykjavik!" might split into
    the tokens "Un", "believ", "able", " prices", " in", " Rey", "kj", "avik",
    "!". Common words become single tokens; rare words and names split into
    several pieces; the space is usually attached to the start of a token.
checkpoint:
  slug: tokens-checkpoint
  kind: concept-check
  pass_score: 0.8
  questions:
    - id: q-unit
      prompt: What unit of text does a large language model actually process?
      options:
        - Whole words, exactly as written
        - Tokens, which are often pieces of words
        - Individual letters only
        - Complete sentences
      correct_index: 1
      concept: token
    - id: q-rare
      prompt: A rare word like "Reykjavik" will most likely be…
      options:
        - dropped by the model
        - stored as one special token
        - split into several smaller tokens
        - converted to its dictionary definition
      correct_index: 2
      concept: tokenizer
    - id: q-cost
      prompt: Why do token counts matter practically?
      options:
        - They determine the model's accuracy
        - More tokens always mean better answers
        - Tokens control the model's temperature
        - Context limits and API pricing are measured in tokens
      correct_index: 3
      concept: context-window
    - id: q-fixed
      prompt: Is tokenisation the same across all models?
      options:
        - Yes, there is one universal tokenizer
        - No — each model family fixes its own tokenizer, so the same text can split differently
        - Tokenisation is chosen randomly at inference time
        - Only the vocabulary size differs, never the splits
      correct_index: 1
      concept: tokenizer
sources:
  - id: sennrich-2016-bpe
    url: https://arxiv.org/abs/1508.07909
    title: Neural Machine Translation of Rare Words with Subword Units (BPE)
  - id: openai-tokenizer-docs
    url: https://platform.openai.com/tokenizer
    title: Interactive tokenizer reference
---

## Why models don't read words

A language model never sees your text the way you wrote it. Before anything
else happens, a **tokenizer** converts the text into a sequence of **tokens**
— integer IDs drawn from a fixed vocabulary, typically a few tens of
thousands of entries.

Whole words would make the vocabulary enormous and leave every typo, name and
new word unrepresentable. Single characters would make sequences painfully
long. Sub-word tokens are the compromise: common words get one token,
everything else is assembled from reusable pieces.

## How text gets split

Most modern tokenizers are trained with byte-pair-encoding-style algorithms:
starting from characters (or bytes), the most frequent adjacent pairs are
merged repeatedly until the vocabulary budget is reached. The result is a
deterministic splitting procedure, fixed per model family.

Practical intuitions that follow:

- frequent English words → usually one token, often with the leading space
  attached ("` prices`");
- rare words, names and other languages → several fragments ("`Rey`", "`kj`",
  "`avik`");
- numbers and punctuation split in sometimes surprising ways — "1234" may not
  be one token;
- emoji and unusual Unicode may cost several tokens each.

## Predict before you test

Take a sentence you'd actually write and, before running any tokenizer over
it, guess: how many tokens? Which words split? Rare names and long compound
words are where guesses usually go wrong — which is exactly the intuition
worth training.

## Tokens are the budget

Everything the model does is counted in tokens, not characters or words. The
**context window** — the maximum the model can consider at once — is a token
budget. API pricing is per token. When a long conversation "forgets" its
beginning, that is the token budget being exceeded, not the model choosing to
forget.

## What this does not mean

One tokenizer's behaviour is not tokenisation in general: the same text
splits differently under different model families. And a token is not a unit
of meaning — the model learns meaning in later layers; the tokenizer is just
a fixed, mechanical compression scheme.
