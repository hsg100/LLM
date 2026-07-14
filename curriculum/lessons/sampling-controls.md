---
slug: sampling-controls
title: Sampling controls
topic: inference-and-sampling
version: 1
duration_minutes: 10
objectives:
  - Distinguish the model's probability distribution from the sampling step
  - Predict how temperature and top-p change output diversity
concepts:
  - probability-distribution
  - temperature
  - top-p
  - sampling
demos:
  - sampling-lab
demo_fallbacks:
  sampling-lab: >-
    Example: after "The capital of France is", the distribution might be
    " Paris" 0.92, " the" 0.03, " located" 0.01, with the rest spread thinly.
    At temperature 0.2, " Paris" is chosen almost every time; at temperature
    1.5, alternatives win noticeably often; with top-p 0.9 the thin tail is
    removed before the draw.
checkpoint:
  slug: sampling-checkpoint
  kind: concept-check
  pass_score: 0.8
  questions:
    - id: q-two-steps
      prompt: What are the two distinct steps in producing the next token?
      options:
        - Tokenising, then embedding
        - Computing a probability distribution, then sampling one token from it
        - Sampling, then checking grammar
        - Choosing temperature, then choosing top-p
      correct_index: 1
      concept: sampling
    - id: q-temp
      prompt: Raising temperature from 0.7 to 1.4 makes outputs…
      options:
        - more deterministic
        - shorter
        - more diverse, because the distribution is flattened before sampling
        - more accurate
      correct_index: 2
      concept: temperature
    - id: q-topp
      prompt: What does top-p = 0.9 do?
      options:
        - Keeps only the 9 most likely tokens
        - Keeps the smallest set of tokens whose probabilities sum to 0.9, then samples within it
        - Multiplies every probability by 0.9
        - Stops generation at 90% of the context window
      correct_index: 1
      concept: top-p
    - id: q-same-dist
      prompt: Two runs with identical settings give different outputs. Why?
      options:
        - The model's weights changed between runs
        - The tokenizer is non-deterministic
        - Temperature drifts over time
        - Sampling is a random draw — the distribution was the same, the outcome wasn't
      correct_index: 3
      concept: probability-distribution
sources:
  - id: holtzman-2020-nucleus
    url: https://arxiv.org/abs/1904.09751
    title: The Curious Case of Neural Text Degeneration (nucleus sampling)
  - id: vaswani-2017-attention
    url: https://arxiv.org/abs/1706.03762
    title: Attention Is All You Need (softmax output layer)
---

## Two steps, not one

For each position the model produces a **probability distribution**: a score
for every token in its vocabulary as the possible next token. Then a separate
step — **sampling** — draws one concrete token from that distribution.
Keeping these apart dissolves a lot of confusion: the distribution is
deterministic given the input; the draw is where randomness enters.

## Temperature reshapes the distribution

**Temperature** divides the raw scores before they become probabilities.
Low temperature exaggerates the gaps — probability piles onto the top few
tokens, and output becomes near-deterministic. High temperature shrinks the
gaps — the distribution flattens, and unlikely tokens win more often.

Predict first: at temperature 0.1, how often does the second-most-likely
token appear? Then reason it through — almost never, because sharpening has
pushed nearly all the mass onto the favourite.

## Top-p trims the tail

Language model vocabularies contain many thousands of tokens that are each
individually absurd but collectively carry real probability. **Top-p
(nucleus) sampling** removes that tail: keep the smallest set of tokens whose
probabilities sum to *p*, renormalise, and sample within it. Unlike a fixed
top-k, the kept set adapts — narrow when the model is confident, wide when
it genuinely isn't.

## Distribution changes vs draw changes

Run the same prompt many times and the *variation between runs* is the
sampling draw. Change temperature or top-p and the *distribution itself*
changes. Both affect what you read, but they are different levers: one
controls the menu, the other picks the meal. This is also why "the model said
X yesterday and Y today" is usually a statement about sampling, not about the
model changing.

## No universally right setting

Low temperature suits tasks with one correct answer; higher settings suit
brainstorming and variety. The classic failure modes sit at the extremes:
greedy decoding can loop and repeat, while very high temperature degenerates
into incoherence (the nucleus-sampling paper in the sources documents both).
