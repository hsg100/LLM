/**
 * ContextLab Briefing — pure state model.
 *
 * Everything here is side-effect free (except createStore's storage adapter,
 * which is injected) so the tests can exercise it under Node without a DOM.
 */

export const FILTERS = ['all', 'unread', 'saved'];

export const CONFIDENCE_LABELS = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
};

export const SUPPORT_LABELS = {
  supported: 'Supported',
  'partially-supported': 'Partially supported',
  unsupported: 'Unsupported',
};

export const STORY_TYPE_LABELS = {
  'research-paper': 'Research paper',
  replication: 'Replication',
  'company-claim': 'Company claim',
  'official-release': 'Official release',
  analysis: 'Analysis',
  opinion: 'Opinion',
};

export const EVIDENCE_STATUS_LABELS = {
  'peer-reviewed': 'Peer reviewed',
  preprint: 'Preprint',
  replicated: 'Replicated',
  official: 'Official release',
  'unverified-claim': 'Unverified claim',
  opinion: 'Position / opinion',
  mixed: 'Mixed evidence',
};

export const SOURCE_TYPE_LABELS = {
  preprint: 'Preprint',
  'peer-reviewed-paper': 'Peer-reviewed paper',
  proceedings: 'Conference proceedings',
  'technical-report': 'Technical report',
  'official-blog': 'Official blog post',
  'code-repository': 'Code repository',
  dataset: 'Dataset',
};

export function emptyState() {
  return { read: [], saved: [] };
}

/** Coerce anything found in storage into a well-formed state object. */
export function normalizeState(raw) {
  const clean = emptyState();
  if (!raw || typeof raw !== 'object') return clean;
  for (const key of ['read', 'saved']) {
    if (Array.isArray(raw[key])) {
      clean[key] = [...new Set(raw[key].filter((v) => typeof v === 'string'))];
    }
  }
  return clean;
}

export function isRead(state, id) {
  return state.read.includes(id);
}

export function isSaved(state, id) {
  return state.saved.includes(id);
}

export function markRead(state, id) {
  if (isRead(state, id)) return state;
  return { ...state, read: [...state.read, id] };
}

export function markUnread(state, id) {
  if (!isRead(state, id)) return state;
  return { ...state, read: state.read.filter((v) => v !== id) };
}

export function toggleSaved(state, id) {
  return isSaved(state, id)
    ? { ...state, saved: state.saved.filter((v) => v !== id) }
    : { ...state, saved: [...state.saved, id] };
}

/**
 * Filter the edition. Always returns a subset of `stories`, in edition order,
 * never duplicating or fabricating entries — the edition stays finite.
 */
export function filterStories(stories, filter, state) {
  switch (filter) {
    case 'unread':
      return stories.filter((s) => !isRead(state, s.id));
    case 'saved':
      return stories.filter((s) => isSaved(state, s.id));
    default:
      return [...stories];
  }
}

/** Progress through the edition: only counts IDs that exist in the edition. */
export function editionProgress(stories, state) {
  const ids = new Set(stories.map((s) => s.id));
  const read = state.read.filter((id) => ids.has(id)).length;
  const total = stories.length;
  return { read, total, allRead: total > 0 && read === total };
}

export function findStory(stories, id) {
  return stories.find((s) => s.id === id) ?? null;
}

export function findSource(story, sourceId) {
  return story.sources.find((s) => s.id === sourceId) ?? null;
}

export function filterCounts(stories, state) {
  return {
    all: stories.length,
    unread: filterStories(stories, 'unread', state).length,
    saved: filterStories(stories, 'saved', state).length,
  };
}

/**
 * Wrap a Web-Storage-like object defensively. If storage is unavailable
 * (private mode, denied permission, quota), `available` is false and the
 * adapter degrades to in-memory no-ops so reading keeps working. Callers use
 * `available` to tell the user honestly that state will not persist.
 */
export function createStorageAdapter(storage) {
  const PROBE = 'contextlab-briefing:probe';
  try {
    storage.setItem(PROBE, '1');
    storage.removeItem(PROBE);
  } catch {
    return {
      available: false,
      get: () => null,
      set: () => false,
    };
  }
  return {
    available: true,
    get(key) {
      try {
        const raw = storage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const STORAGE_KEY = 'contextlab-briefing:v1';

/**
 * Tiny store: holds state, persists through the injected adapter, notifies
 * one subscriber. `persistent` is honest — false when storage is unusable.
 */
export function createStore(adapter) {
  let state = normalizeState(adapter.get(STORAGE_KEY));
  let listener = null;
  return {
    get state() {
      return state;
    },
    get persistent() {
      return adapter.available;
    },
    dispatch(reducer, ...args) {
      const next = reducer(state, ...args);
      if (next === state) return state;
      state = next;
      adapter.set(STORAGE_KEY, state);
      if (listener) listener(state);
      return state;
    },
    subscribe(fn) {
      listener = fn;
    },
  };
}

/** Format an ISO date (YYYY-MM-DD) for display without timezone surprises. */
export function formatDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
