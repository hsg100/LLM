/**
 * ContextLab Briefing — UI controller.
 * Hash routing (#/ = feed, #/story/<id> = reader), DOM rendering, focus
 * management, persistence wiring and service-worker registration.
 */

import {
  FILTERS,
  CONFIDENCE_LABELS,
  SUPPORT_LABELS,
  STORY_TYPE_LABELS,
  EVIDENCE_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  createStorageAdapter,
  createStore,
  editionProgress,
  filterCounts,
  filterStories,
  findStory,
  findSource,
  formatDate,
  isRead,
  isSaved,
  markRead,
  markUnread,
  toggleSaved,
} from './model.mjs';

const main = document.getElementById('main');
const announcer = document.getElementById('announcer');

let edition = null;
let stories = [];
let store = null;
let activeFilter = 'all';
/** Story ID whose card should regain focus when returning to the feed. */
let returnFocusStoryId = null;

/* ------------------------------------------------------------------ utils */

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function announce(message) {
  announcer.textContent = '';
  // Swap in next frame so repeated messages re-announce.
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

const BOOKMARK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h12a.5.5 0 0 1 .5.5v15l-6.5-4-6.5 4V5a.5.5 0 0 1 .5-.5z"/></svg>';

function confidenceBadge(level) {
  return `<span class="badge badge-conf-${esc(level)}">${esc(CONFIDENCE_LABELS[level] ?? level)}</span>`;
}

function evidenceBadge(status) {
  return `<span class="badge badge-evidence-${esc(status)}">${esc(EVIDENCE_STATUS_LABELS[status] ?? status)}</span>`;
}

/* ------------------------------------------------------------------- feed */

function cardHtml(story) {
  const read = isRead(store.state, story.id);
  const saved = isSaved(store.state, story.id);
  return `
    <li>
      <article class="card${read ? ' is-read' : ''}" aria-labelledby="hl-${esc(story.id)}">
        <p class="card-meta">
          <span>${esc(STORY_TYPE_LABELS[story.storyType] ?? story.storyType)}</span>
          ${evidenceBadge(story.evidenceStatus)}
        </p>
        <h3 class="card-headline" id="hl-${esc(story.id)}">
          <a href="#/story/${esc(story.id)}" data-story-link="${esc(story.id)}">${esc(story.headline)}</a>
        </h3>
        <p class="card-dek">${esc(story.dek)}</p>
        <p class="card-foot">
          ${confidenceBadge(story.confidence)}
          <span>${esc(String(story.readingTimeMinutes))} min read</span>
          <span>${story.topics.map((t) => esc(t)).join(' · ')}</span>
          ${read ? '<span class="read-check">✓ Read</span>' : ''}
        </p>
        <button type="button" class="save-btn" data-save="${esc(story.id)}"
                aria-pressed="${saved}"
                aria-label="${saved ? 'Remove from saved' : 'Save'}: ${esc(story.headline)}">
          ${BOOKMARK_SVG}
        </button>
      </article>
    </li>`;
}

function feedEndHtml(progressInfo, visibleCount) {
  if (activeFilter === 'all' && progressInfo.allRead) {
    return `
      <div class="edition-end" data-caught-up>
        <span class="glyph" aria-hidden="true">✓</span>
        <h2 class="edition-end-title">You're caught up</h2>
        <p>That's every briefing for ${esc(formatDate(edition.date))}.</p>
        <p>This prototype contains a single demonstration edition, so no more will arrive — a daily product would bring the next one tomorrow morning.</p>
      </div>`;
  }
  if (visibleCount === 0) return '';
  const remaining = progressInfo.total - progressInfo.read;
  return `
    <div class="edition-end">
      <h2 class="edition-end-title">End of edition</h2>
      <p>${remaining === 0
        ? `Every briefing for ${esc(formatDate(edition.date))} is read.`
        : `${remaining} of ${progressInfo.total} briefing${progressInfo.total === 1 ? '' : 's'} still unread.`}</p>
    </div>`;
}

function emptyStateHtml() {
  const messages = {
    unread: ['Nothing unread.', 'Every briefing in this edition has been read.'],
    saved: ['No saved briefings yet.', 'Use the bookmark on any briefing to keep it here.'],
    all: ['This edition is empty.', ''],
  };
  const [title, hint] = messages[activeFilter] ?? messages.all;
  return `
    <div class="empty-state" data-empty-state>
      <p><strong>${esc(title)}</strong></p>
      ${hint ? `<p>${esc(hint)}</p>` : ''}
      <button type="button" class="link-btn" data-filter-reset>Show all briefings</button>
    </div>`;
}

function renderFeed() {
  const progressInfo = editionProgress(stories, store.state);
  const counts = filterCounts(stories, store.state);
  const visible = filterStories(stories, activeFilter, store.state);
  const pct = progressInfo.total ? Math.round((progressInfo.read / progressInfo.total) * 100) : 0;

  const filterLabels = { all: 'All', unread: 'Unread', saved: 'Saved' };

  main.innerHTML = `
    <header class="edition-header">
      <p class="edition-date">Daily edition · ${esc(formatDate(edition.date))}</p>
      <h1 class="edition-title">${esc(edition.title)}</h1>
      <p class="edition-intro">${esc(edition.intro)}</p>
      <p class="edition-note">${esc(edition.contentNote)}</p>
      <div class="edition-progress">
        <span data-progress-text>${progressInfo.read} of ${progressInfo.total} briefings read</span>
        <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    </header>
    <nav class="filters" aria-label="Filter briefings">
      ${FILTERS.map((f) => `
        <button type="button" class="filter-btn" data-filter="${f}" aria-pressed="${f === activeFilter}">
          ${filterLabels[f]} <span class="filter-count">(${counts[f]})</span>
        </button>`).join('')}
    </nav>
    <h2 class="visually-hidden">Briefings</h2>
    ${visible.length
      ? `<ul class="card-list">${visible.map(cardHtml).join('')}</ul>`
      : emptyStateHtml()}
    ${feedEndHtml(progressInfo, visible.length)}
  `;

  wireFeedEvents();
  restoreFeedFocus();
}

function wireFeedEvents() {
  for (const btn of main.querySelectorAll('[data-filter]')) {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderFeed();
      announce(`Showing ${activeFilter === 'all' ? 'all briefings' : `${activeFilter} briefings`}.`);
    });
  }
  main.querySelector('[data-filter-reset]')?.addEventListener('click', () => {
    activeFilter = 'all';
    renderFeed();
    announce('Showing all briefings.');
  });
  for (const btn of main.querySelectorAll('[data-save]')) {
    btn.addEventListener('click', () => handleSaveToggle(btn.dataset.save));
  }
  for (const link of main.querySelectorAll('[data-story-link]')) {
    link.addEventListener('click', () => {
      returnFocusStoryId = link.dataset.storyLink;
    });
  }
}

function restoreFeedFocus() {
  if (!returnFocusStoryId) return;
  const link = main.querySelector(`[data-story-link="${CSS.escape(returnFocusStoryId)}"]`);
  returnFocusStoryId = null;
  if (link) {
    link.focus();
  } else {
    main.focus();
  }
}

/* ------------------------------------------------------------------ story */

function claimHtml(story, claim) {
  const sources = claim.sourceIds
    .map((id) => findSource(story, id))
    .filter(Boolean);
  const sourceItems = sources
    .map(
      (s) => `<li><a class="source-title-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
        <span class="muted">(${esc(SOURCE_TYPE_LABELS[s.sourceType] ?? s.sourceType)})</span></li>`,
    )
    .join('');
  return `
    <li class="claim claim-${esc(claim.support)}">
      <p class="claim-text">${esc(claim.text)}</p>
      <p class="claim-badges">
        <span class="badge badge-conf-${esc(claim.confidence)}">${esc(SUPPORT_LABELS[claim.support])} · ${esc(CONFIDENCE_LABELS[claim.confidence])}</span>
      </p>
      ${sources.length
        ? `<ul class="claim-sources" aria-label="Sources for this claim">${sourceItems}</ul>`
        : '<p class="claim-nosource">No source substantiates this claim.</p>'}
      ${claim.caveat ? `<p class="claim-caveat"><strong>Caveat:</strong> ${esc(claim.caveat)}</p>` : ''}
    </li>`;
}

function sourceHtml(source) {
  return `
    <li class="source">
      <a class="source-title-link" href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title)}</a>
      <p class="source-meta">
        ${esc(source.authors)} · ${esc(SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType)}
        · ${esc(formatDate(source.publishedDate))}
        · ${source.isPrimary ? 'Primary source' : 'Secondary source'}
        ${source.reviewStatus !== 'not-applicable' ? ` · ${esc(EVIDENCE_STATUS_LABELS[source.reviewStatus] ?? source.reviewStatus)}` : ''}
      </p>
      <p class="source-url">${esc(source.url)} — demonstration link, does not resolve</p>
    </li>`;
}

function renderStory(story) {
  const saved = isSaved(store.state, story.id);
  const read = isRead(store.state, story.id);
  const corrected = story.updatedAt !== story.publishedAt;

  main.innerHTML = `
    <article class="story" aria-labelledby="story-headline">
      <a class="back-link" href="#/" data-back>← Back to edition</a>
      <p class="story-meta">
        <span class="badge">${esc(STORY_TYPE_LABELS[story.storyType] ?? story.storyType)}</span>
        ${evidenceBadge(story.evidenceStatus)}
        ${confidenceBadge(story.confidence)}
      </p>
      <h1 class="story-headline" id="story-headline" tabindex="-1">${esc(story.headline)}</h1>
      <p class="story-dek">${esc(story.dek)}</p>
      <p class="story-byline">
        ${esc(String(story.readingTimeMinutes))} min read ·
        ${esc(story.topics.join(' · '))} ·
        Published ${esc(formatDate(story.publishedAt))}${corrected ? ` · Updated ${esc(formatDate(story.updatedAt))}` : ''}
      </p>
      <div class="story-actions">
        <button type="button" class="action-btn" data-save="${esc(story.id)}" aria-pressed="${saved}">
          ${BOOKMARK_SVG} <span data-save-label>${saved ? 'Saved' : 'Save'}</span>
        </button>
        <button type="button" class="action-btn" data-toggle-read aria-pressed="${read}">
          <span data-read-label>${read ? 'Read — mark unread' : 'Mark as read'}</span>
        </button>
      </div>

      <section class="story-section">
        <h2 class="story-section-title">Why it matters</h2>
        <p>${esc(story.whyItMatters)}</p>
      </section>

      <section class="story-section">
        <h2 class="story-section-title">What's genuinely new</h2>
        <p>${esc(story.whatIsNew)}</p>
      </section>

      <section class="story-section story-body">
        <h2 class="story-section-title">The story</h2>
        ${story.body.map((p) => `<p>${esc(p)}</p>`).join('')}
      </section>

      <section class="story-section">
        <h2 class="story-section-title">What remains uncertain</h2>
        <p>${esc(story.whatRemainsUncertain)}</p>
      </section>

      <section class="story-section" aria-labelledby="evidence-title">
        <h2 class="story-section-title" id="evidence-title">Evidence, claim by claim</h2>
        <ul class="claim-list">
          ${story.claims.map((c) => claimHtml(story, c)).join('')}
        </ul>
      </section>

      <section class="story-section">
        <h2 class="story-section-title">Caveats</h2>
        ${story.caveats.length
          ? `<ul class="plain-list">${story.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
          : '<p class="muted">No story-level caveats.</p>'}
      </section>

      <section class="story-section">
        <h2 class="story-section-title">Corrections</h2>
        ${story.corrections.length
          ? story.corrections
              .map(
                (c) => `<div class="correction"><p><span class="correction-date">${esc(formatDate(c.date))}:</span> ${esc(c.summary)}</p></div>`,
              )
              .join('')
          : '<p class="muted">No corrections have been issued for this briefing.</p>'}
      </section>

      <section class="story-section">
        <h2 class="story-section-title">Sources</h2>
        <ul class="source-list">${story.sources.map(sourceHtml).join('')}</ul>
        ${navigator.onLine === false
          ? '<p class="muted">You are offline — external source links need a connection.</p>'
          : ''}
      </section>

      <div class="story-end">
        <a class="back-link" href="#/" data-back>← Back to edition</a>
      </div>
    </article>
  `;

  // Opening a story marks it read (honest read-state driven by opening).
  if (!read) {
    store.dispatch(markRead, story.id);
    const readBtn = main.querySelector('[data-toggle-read]');
    readBtn.setAttribute('aria-pressed', 'true');
    readBtn.querySelector('[data-read-label]').textContent = 'Read — mark unread';
  }

  main.querySelector('[data-save]').addEventListener('click', () => handleSaveToggle(story.id));
  main.querySelector('[data-toggle-read]').addEventListener('click', () => {
    const nowRead = isRead(store.state, story.id);
    store.dispatch(nowRead ? markUnread : markRead, story.id);
    const btn = main.querySelector('[data-toggle-read]');
    btn.setAttribute('aria-pressed', String(!nowRead));
    btn.querySelector('[data-read-label]').textContent = !nowRead ? 'Read — mark unread' : 'Mark as read';
    announce(!nowRead ? 'Marked as read.' : 'Marked as unread.');
  });

  document.title = `${story.headline} — ContextLab Briefing`;
  main.querySelector('#story-headline').focus();
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------- actions */

function handleSaveToggle(storyId) {
  store.dispatch(toggleSaved, storyId);
  const saved = isSaved(store.state, storyId);
  const story = findStory(stories, storyId);
  announce(saved ? 'Saved for later.' : 'Removed from saved.');
  // Update whichever view is showing without a full re-render where cheap.
  for (const btn of document.querySelectorAll(`[data-save="${CSS.escape(storyId)}"]`)) {
    btn.setAttribute('aria-pressed', String(saved));
    const label = btn.querySelector('[data-save-label]');
    if (label) label.textContent = saved ? 'Saved' : 'Save';
    else if (story) btn.setAttribute('aria-label', `${saved ? 'Remove from saved' : 'Save'}: ${story.headline}`);
  }
  // The saved filter's contents change, so re-render the feed if it's active.
  if (currentRoute().view === 'feed' && activeFilter === 'saved') renderFeed();
  else if (currentRoute().view === 'feed') {
    const countBtn = main.querySelector('[data-filter="saved"] .filter-count');
    if (countBtn) countBtn.textContent = `(${filterCounts(stories, store.state).saved})`;
  }
}

/* ---------------------------------------------------------------- routing */

function currentRoute() {
  const hash = window.location.hash;
  const storyMatch = hash.match(/^#\/story\/([a-z0-9-]+)$/);
  if (storyMatch) return { view: 'story', id: storyMatch[1] };
  return { view: 'feed' };
}

function renderRoute() {
  const route = currentRoute();
  if (route.view === 'story') {
    const story = findStory(stories, route.id);
    if (story) {
      renderStory(story);
      return;
    }
    // Unknown story ID: fall through to the feed rather than a dead end.
  }
  document.title = 'ContextLab Briefing';
  renderFeed();
}

/* ------------------------------------------------------------------ setup */

function showLoadFailure() {
  main.innerHTML = `
    <div class="notice" role="alert">
      <p><strong>The edition couldn't be loaded.</strong>
      If this is your first visit, a connection is needed once to fetch the
      edition data; afterwards it is cached for offline reading. Reload to try again.</p>
    </div>`;
}

function showStorageNotice() {
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.innerHTML =
    '<p>Local storage is unavailable in this browser session, so read and saved state will not persist. Reading works normally.</p>';
  main.parentNode.insertBefore(notice, main);
}

function setupOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  const sync = () => {
    banner.hidden = navigator.onLine !== false;
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}

function setupAboutPanel() {
  const toggle = document.getElementById('about-toggle');
  const panel = document.getElementById('about-panel');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });
}

async function init() {
  setupAboutPanel();
  setupOfflineBanner();

  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  const adapter = createStorageAdapter(
    storage ?? { setItem() { throw new Error('unavailable'); } },
  );
  store = createStore(adapter);
  if (!store.persistent) showStorageNotice();

  try {
    const res = await fetch('data/stories.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    edition = data.edition;
    stories = data.stories;
  } catch {
    showLoadFailure();
    return;
  }

  window.addEventListener('hashchange', renderRoute);
  renderRoute();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Offline support is progressive enhancement; reading still works. */
    });
  }
}

init();
