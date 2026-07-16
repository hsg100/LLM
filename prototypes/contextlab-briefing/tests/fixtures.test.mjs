/**
 * Fixture/data contract tests — enforce schema/story.schema.json's rules
 * without a validator dependency.
 * Run: node --test "prototypes/contextlab-briefing/tests/*.test.mjs"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../data/stories.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);
const { edition, stories } = data;

const STORY_TYPES = ['research-paper', 'replication', 'company-claim', 'official-release', 'analysis', 'opinion'];
const EVIDENCE_STATUSES = ['peer-reviewed', 'preprint', 'replicated', 'official', 'unverified-claim', 'opinion', 'mixed'];
const CONFIDENCES = ['high', 'moderate', 'low'];
const SUPPORTS = ['supported', 'partially-supported', 'unsupported'];
const SOURCE_TYPES = ['preprint', 'peer-reviewed-paper', 'proceedings', 'technical-report', 'official-blog', 'code-repository', 'dataset'];
const REVIEW_STATUSES = ['peer-reviewed', 'preprint', 'not-peer-reviewed', 'not-applicable'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const REQUIRED_STORY_FIELDS = [
  'id', 'editionDate', 'headline', 'dek', 'storyType', 'evidenceStatus',
  'readingTimeMinutes', 'topics', 'whyItMatters', 'whatIsNew', 'body',
  'whatRemainsUncertain', 'confidence', 'claims', 'sources', 'caveats',
  'corrections', 'publishedAt', 'updatedAt',
];

test('edition metadata is complete and honest about provenance', () => {
  assert.match(edition.date, ISO_DATE);
  assert.ok(edition.title.length > 0);
  assert.ok(edition.intro.length > 0);
  assert.ok(edition.contentNote.length > 0);
  assert.match(edition.contentNote.toLowerCase(), /demonstration|fictional|synthetic/,
    'contentNote must disclose synthetic content');
});

test('edition is finite: between 5 and 8 stories', () => {
  assert.ok(Array.isArray(stories));
  assert.ok(stories.length >= 5 && stories.length <= 8, `got ${stories.length}`);
});

test('story IDs are unique and well-formed', () => {
  const ids = stories.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate story IDs');
  for (const id of ids) assert.match(id, /^st-[a-z0-9-]+$/);
});

test('every story has all required fields with valid enum values', () => {
  for (const s of stories) {
    for (const field of REQUIRED_STORY_FIELDS) {
      assert.ok(field in s, `${s.id ?? '?'} missing ${field}`);
    }
    assert.equal(s.editionDate, edition.date, `${s.id} editionDate mismatch`);
    assert.ok(STORY_TYPES.includes(s.storyType), `${s.id} bad storyType`);
    assert.ok(EVIDENCE_STATUSES.includes(s.evidenceStatus), `${s.id} bad evidenceStatus`);
    assert.ok(CONFIDENCES.includes(s.confidence), `${s.id} bad confidence`);
    assert.ok(Number.isInteger(s.readingTimeMinutes) && s.readingTimeMinutes >= 1 && s.readingTimeMinutes <= 20);
    assert.ok(Array.isArray(s.topics) && s.topics.length >= 1);
    assert.ok(Array.isArray(s.body) && s.body.length >= 1);
    assert.ok(Array.isArray(s.caveats));
    assert.ok(Array.isArray(s.corrections));
    assert.match(s.publishedAt, ISO_DATETIME);
    assert.match(s.updatedAt, ISO_DATETIME);
    for (const c of s.corrections) {
      assert.match(c.date, ISO_DATE);
      assert.ok(c.summary.length >= 10);
    }
  }
});

test('no story silently lacks claims or evidence status', () => {
  for (const s of stories) {
    assert.ok(s.claims.length >= 1, `${s.id} has no claims`);
    assert.ok(s.evidenceStatus, `${s.id} has no evidence status`);
    assert.ok(s.whatRemainsUncertain.length >= 20, `${s.id} lacks uncertainty section`);
  }
});

test('source IDs are unique per story with required fields, and URLs are honest .example links', () => {
  for (const s of stories) {
    assert.ok(s.sources.length >= 1, `${s.id} has no sources`);
    const ids = s.sources.map((src) => src.id);
    assert.equal(new Set(ids).size, ids.length, `${s.id} duplicate source IDs`);
    for (const src of s.sources) {
      assert.match(src.id, /^src-[a-z0-9-]+$/);
      assert.ok(src.title.length >= 4);
      assert.ok(src.authors.length >= 2);
      assert.match(src.url, /^https:\/\/[a-z0-9.-]+\.example\//,
        `${src.id} must use a reserved .example URL in this synthetic prototype`);
      assert.ok(SOURCE_TYPES.includes(src.sourceType), `${src.id} bad sourceType`);
      assert.match(src.publishedDate, ISO_DATE);
      assert.equal(typeof src.isPrimary, 'boolean');
      assert.ok(REVIEW_STATUSES.includes(src.reviewStatus), `${src.id} bad reviewStatus`);
    }
  }
});

test('claim IDs are unique per story and every claim references existing sources', () => {
  for (const s of stories) {
    const claimIds = s.claims.map((c) => c.id);
    assert.equal(new Set(claimIds).size, claimIds.length, `${s.id} duplicate claim IDs`);
    const sourceIds = new Set(s.sources.map((src) => src.id));
    for (const c of s.claims) {
      assert.match(c.id, /^cl-[a-z0-9-]+$/);
      assert.ok(c.text.length >= 20, `${c.id} claim text too short`);
      assert.ok(CONFIDENCES.includes(c.confidence), `${c.id} bad confidence`);
      assert.ok(SUPPORTS.includes(c.support), `${c.id} bad support`);
      for (const ref of c.sourceIds) {
        assert.ok(sourceIds.has(ref), `${s.id}/${c.id} references unknown source ${ref}`);
      }
    }
  }
});

test('support states follow the contract: sourcing and caveat rules', () => {
  for (const s of stories) {
    for (const c of s.claims) {
      if (c.support === 'supported') {
        assert.ok(c.sourceIds.length >= 1, `${c.id} supported but has no sources`);
      }
      if (c.support === 'partially-supported') {
        assert.ok(c.sourceIds.length >= 1, `${c.id} partially-supported but has no sources`);
        assert.ok(c.caveat, `${c.id} partially-supported requires a caveat`);
      }
      if (c.support === 'unsupported') {
        assert.equal(c.sourceIds.length, 0, `${c.id} unsupported must not list sources`);
        assert.ok(c.caveat, `${c.id} unsupported requires a caveat`);
      }
    }
  }
});

test('fixture set exercises the full evidence vocabulary', () => {
  const supports = new Set(stories.flatMap((s) => s.claims.map((c) => c.support)));
  for (const state of SUPPORTS) assert.ok(supports.has(state), `no fixture claim is ${state}`);
  const confidences = new Set(stories.map((s) => s.confidence));
  for (const level of CONFIDENCES) assert.ok(confidences.has(level), `no fixture story is ${level} confidence`);
  assert.ok(stories.some((s) => s.corrections.length > 0), 'no fixture demonstrates a correction');
  assert.ok(stories.some((s) => s.corrections.length === 0), 'no fixture demonstrates the corrections empty state');
});
