/**
 * Pure state-model tests: filtering, finite-edition behaviour, read/saved
 * reducers, progress, and honest storage fallback.
 * Run: node --test "prototypes/contextlab-briefing/tests/*.test.mjs"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FILTERS,
  createStorageAdapter,
  createStore,
  editionProgress,
  emptyState,
  filterCounts,
  filterStories,
  findStory,
  formatDate,
  isRead,
  isSaved,
  markRead,
  markUnread,
  normalizeState,
  toggleSaved,
  STORAGE_KEY,
} from '../model.mjs';

const stories = [
  { id: 'st-a', headline: 'A' },
  { id: 'st-b', headline: 'B' },
  { id: 'st-c', headline: 'C' },
];

test('read/unread reducers are pure and idempotent', () => {
  const s0 = emptyState();
  const s1 = markRead(s0, 'st-a');
  assert.ok(isRead(s1, 'st-a'));
  assert.ok(!isRead(s0, 'st-a'), 'original state must not mutate');
  assert.equal(markRead(s1, 'st-a'), s1, 'marking read twice returns same state');
  const s2 = markUnread(s1, 'st-a');
  assert.ok(!isRead(s2, 'st-a'));
  assert.equal(markUnread(s2, 'st-a'), s2);
});

test('toggleSaved round-trips', () => {
  const s0 = emptyState();
  const s1 = toggleSaved(s0, 'st-b');
  assert.ok(isSaved(s1, 'st-b'));
  const s2 = toggleSaved(s1, 'st-b');
  assert.ok(!isSaved(s2, 'st-b'));
  assert.deepEqual(s2.saved, []);
});

test('filterStories returns finite subsets in edition order, never fabricating entries', () => {
  let state = emptyState();
  state = markRead(state, 'st-b');
  state = toggleSaved(state, 'st-c');

  const all = filterStories(stories, 'all', state);
  assert.deepEqual(all.map((s) => s.id), ['st-a', 'st-b', 'st-c']);
  assert.notEqual(all, stories, 'returns a copy, not the source array');

  const unread = filterStories(stories, 'unread', state);
  assert.deepEqual(unread.map((s) => s.id), ['st-a', 'st-c']);

  const saved = filterStories(stories, 'saved', state);
  assert.deepEqual(saved.map((s) => s.id), ['st-c']);

  for (const f of FILTERS) {
    const out = filterStories(stories, f, state);
    assert.ok(out.length <= stories.length, `${f} never exceeds the edition`);
    assert.equal(new Set(out.map((s) => s.id)).size, out.length, `${f} never duplicates`);
  }
});

test('empty filter results are possible and honest', () => {
  const state = emptyState();
  assert.deepEqual(filterStories(stories, 'saved', state), []);
  const allRead = stories.reduce((st, s) => markRead(st, s.id), state);
  assert.deepEqual(filterStories(stories, 'unread', allRead), []);
});

test('editionProgress counts only IDs present in the edition and detects caught-up', () => {
  let state = emptyState();
  state = markRead(state, 'st-a');
  state = markRead(state, 'st-ghost'); // stale ID from an older edition
  let p = editionProgress(stories, state);
  assert.deepEqual(p, { read: 1, total: 3, allRead: false });

  state = markRead(state, 'st-b');
  state = markRead(state, 'st-c');
  p = editionProgress(stories, state);
  assert.deepEqual(p, { read: 3, total: 3, allRead: true });

  assert.equal(editionProgress([], emptyState()).allRead, false, 'empty edition is never "caught up"');
});

test('filterCounts matches filterStories', () => {
  let state = emptyState();
  state = markRead(state, 'st-a');
  state = toggleSaved(state, 'st-a');
  const counts = filterCounts(stories, state);
  assert.deepEqual(counts, { all: 3, unread: 2, saved: 1 });
});

test('normalizeState survives garbage from storage', () => {
  assert.deepEqual(normalizeState(null), emptyState());
  assert.deepEqual(normalizeState('nonsense'), emptyState());
  assert.deepEqual(normalizeState({ read: 'not-an-array', saved: [1, 'st-a', 'st-a'] }),
    { read: [], saved: ['st-a'] });
});

test('findStory returns null for unknown IDs', () => {
  assert.equal(findStory(stories, 'st-a').headline, 'A');
  assert.equal(findStory(stories, 'nope'), null);
});

test('storage adapter is honest when storage throws', () => {
  const denied = createStorageAdapter({
    setItem() { throw new Error('denied'); },
  });
  assert.equal(denied.available, false);
  assert.equal(denied.get('x'), null);
  assert.equal(denied.set('x', 1), false, 'set reports failure instead of pretending');
});

test('store persists through a working adapter and reports persistence honestly', () => {
  const backing = new Map();
  const fakeStorage = {
    setItem: (k, v) => backing.set(k, String(v)),
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    removeItem: (k) => backing.delete(k),
  };
  const store = createStore(createStorageAdapter(fakeStorage));
  assert.equal(store.persistent, true);
  store.dispatch(markRead, 'st-a');
  store.dispatch(toggleSaved, 'st-b');
  assert.deepEqual(JSON.parse(backing.get(STORAGE_KEY)), { read: ['st-a'], saved: ['st-b'] });

  // A fresh store over the same backing rehydrates.
  const store2 = createStore(createStorageAdapter(fakeStorage));
  assert.ok(isRead(store2.state, 'st-a'));
  assert.ok(isSaved(store2.state, 'st-b'));
});

test('store keeps working in memory when storage is unavailable', () => {
  const store = createStore(createStorageAdapter({
    setItem() { throw new Error('denied'); },
  }));
  assert.equal(store.persistent, false);
  store.dispatch(markRead, 'st-a');
  assert.ok(isRead(store.state, 'st-a'), 'reading state still works for the session');
});

test('formatDate renders ISO dates without timezone drift', () => {
  assert.equal(formatDate('2026-07-16'), '16 July 2026');
  assert.equal(formatDate('2026-07-16T06:00:00Z'), '16 July 2026');
});
