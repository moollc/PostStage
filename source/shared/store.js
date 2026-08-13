/**
 * Post board storage.
 *
 * The board holds many posts, one active. Shape:
 *
 *   { activeId, ideaLayout, posts: [{ id, status, publishedAt, source, outcome, ideas[], ...postFields }] }
 *
 * `ideaLayout` is `'stack' | 'free'` (default `'stack'`). Board-level, not per post.
 *
 * Ideas are `{ id, text, part, source }` where idea `source` is 'studio' | 'shop'
 * — a narrower vocabulary than the post-level one below. Use `addIdea`.
 *
 * `source` is 'studio' | 'banter' | 'marketing'. `outcome` is null or
 * { note, recordedAt } — an operator's record of what actually happened, kept
 * deliberately separate from the heuristic score.
 *
 * `publishedUrl` is `null` or a normalized `https://x.com/{handle}/status/{id}`
 * href (host + status id; query stripped). It is not a view count and it is
 * not the local `status: 'published'` toggle.
 *
 * `guestScan` is `null` or `{ at, title, text }` — a guest GET of that URL.
 * Identity only. Fail keeps the last snapshot. Never views or likes.
 *
 * `lastPaste` is `null` or `{ text, platformId, partIndex, at, stage? }` — the exact
 * string that last landed on the clipboard. Written only on successful Copy.
 * `stage` is hook/body/cta/hashtags at that Copy, for formatThread of the snapshot.
 * Rail edits must not touch it. What happened? is about this snapshot.
 *
 * `stageUndo` is `null` or `{ hook, body, cta }` — the previous stage copy
 * before the last Use-on-stage or rail overwrite of those fields. One slot,
 * not a history. `rememberStageWrite` / `undoStageWrite` own it.
 *
 * `state.saveError` is `null` or `'quota'` — set by `saveState` when
 * `localStorage.setItem` throws `QuotaExceededError` (browsers vary: check
 * both `err.name` and the legacy `err.code === 22`). Not part of the persisted
 * shape; it is a live flag on the in-memory `state` object so a caller can
 * read it right after calling `saveState` without threading a return value
 * through every call site. `saveState` also returns `true`/`false` for the
 * same result, for callers that prefer that over reading the flag. A quota
 * failure must never look like a successful save — no field is written to
 * localStorage that the previous, still-actually-saved state does not have.
 *
 * v1 stored a single `{ post, ideas }`. That is migrated on read, not dropped —
 * see `migrate()`. The v1 key is left in place so a downgrade does not lose work.
 *
 * Compatibility: `state.post` and `state.ideas` are still readable, defined as
 * accessors over the active post, so callers written against v1 keep working
 * while the UI is rewired. Both are live views, not copies — mutating
 * `state.post.hook` mutates the active post. Prefer `getActive(state)`.
 */

import { isSafeRelPath, mediaSrcForPath } from './media-link.js';
import { normalizePublishedUrl } from './published-url.js';
import { normalizeGuestScan } from './guest-scan.js';

const KEY = 'poststage.v2';
const LEGACY_KEY = 'poststage.v1';

/** Where a post came from. Anything else is coerced back to `'studio'`. */
export const SOURCES = ['studio', 'banter', 'marketing'];
const DEFAULT_SOURCE = 'studio';

/** Fields every post carries, with the defaults the canvas expects. */
function blankPost(overrides = {}) {
  return {
    id: uid(),
    x: 340,
    y: 80,
    title: 'Untitled post',
    hook: '',
    body: '',
    cta: '',
    hashtags: [],
    media: [],
    platform: 'x',
    genPrompt: '',
    audience: '',
    audienceHow: 'unknown',
    status: 'draft',
    publishedAt: null,
    publishedUrl: null,
    guestScan: null,
    source: DEFAULT_SOURCE,
    outcome: null,
    lastPaste: null,
    parked: false,
    ideas: [],
    stageUndo: null,
    ...overrides
  };
}

/** A source is only valid if it is one of the three we know. */
function normalizeSource(value) {
  return SOURCES.includes(value) ? value : DEFAULT_SOURCE;
}

/**
 * Where an idea came from. Deliberately a *different, narrower* vocabulary from
 * the post-level `SOURCES` above: an idea is either something the operator
 * wrote in the studio or something that came off the shop floor. Post sources
 * like 'banter' are not valid here, so the two must never share a normalizer.
 */
export const IDEA_SOURCES = ['studio', 'shop'];
const DEFAULT_IDEA_SOURCE = 'studio';

/** Missing or unknown idea source → `'studio'`. */
function normalizeIdeaSource(value) {
  return IDEA_SOURCES.includes(value) ? value : DEFAULT_IDEA_SOURCE;
}

/**
 * Repair a stored idea list. Ideas written before `source` existed pick up
 * `'studio'` here, the same way posts backfill their own fields.
 */
function normalizeIdeas(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((i) => i && typeof i === 'object')
    .map((i) => ({
      ...i,
      id: i.id || uid(),
      text: typeof i.text === 'string' ? i.text : '',
      part: typeof i.part === 'string' ? i.part : '',
      source: normalizeIdeaSource(i.source)
    }));
}

/**
 * An outcome is `null` or `{ note, recordedAt }`. A bare string is accepted and
 * wrapped, since that is the shape a caller is most likely to reach for. An
 * empty or whitespace-only note clears the outcome back to `null`.
 */
function normalizeOutcome(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const note = value.trim();
    return note ? { note, recordedAt: null } : null;
  }
  if (typeof value !== 'object') return null;
  const note = String(value.note ?? '').trim();
  if (!note) return null;
  const at = value.recordedAt;
  return { note, recordedAt: typeof at === 'string' && at ? at : null };
}

function normalizeLastPaste(value) {
  if (!value || typeof value !== 'object') return null;
  const text = typeof value.text === 'string' ? value.text : String(value.text ?? '');
  if (!text) return null;
  const platformId = typeof value.platformId === 'string' ? value.platformId : '';
  const rawIndex = value.partIndex;
  const partIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.floor(rawIndex)) : 0;
  const at = typeof value.at === 'string' && value.at ? value.at : null;
  const next = { text, platformId, partIndex, at };
  const stage = value.stage;
  if (stage && typeof stage === 'object') {
    next.stage = {
      hook: typeof stage.hook === 'string' ? stage.hook : '',
      body: typeof stage.body === 'string' ? stage.body : '',
      cta: typeof stage.cta === 'string' ? stage.cta : '',
      hashtags: Array.isArray(stage.hashtags)
        ? stage.hashtags.map((t) => String(t ?? '')).filter(Boolean)
        : []
    };
  }
  return next;
}

function normalizeStageUndo(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    hook: typeof value.hook === 'string' ? value.hook : '',
    body: typeof value.body === 'string' ? value.body : '',
    cta: typeof value.cta === 'string' ? value.cta : ''
  };
}

function blank() {
  const post = blankPost();
  return withViews({ activeId: post.id, posts: [post], ideaLayout: 'stack' });
}

/**
 * Fold a v1 `{ post, ideas }` into a one-post board. The v1 post used the
 * literal id `'stage'`; it is kept so any saved reference still resolves.
 */
function migrate(v1) {
  const { ideas, post } = v1;
  const merged = blankPost({
    ...post,
    id: post.id || uid(),
    ideas: Array.isArray(ideas) ? ideas : [],
    status: 'draft',
    publishedAt: null,
    publishedUrl: null,
    guestScan: null,
    // v1 predates both fields; a migrated post is studio work with no outcome yet.
    source: normalizeSource(post.source),
    outcome: normalizeOutcome(post.outcome)
  });
  return { activeId: merged.id, posts: [merged], ideaLayout: 'stack' };
}

/** True for something shaped like a v2 board. */
function isBoard(data) {
  return Boolean(data) && Array.isArray(data.posts) && typeof data.activeId === 'string';
}

/** True for something shaped like v1. */
function isLegacy(data) {
  return Boolean(data) && Boolean(data.post) && Array.isArray(data.ideas);
}

/**
 * Whether this attachment would survive save/load.
 * Blobs and `data:video` are dropped. Small `data:image/` URLs stay.
 * A project-relative `path` (or `/image?path=`) stays. Home paths do not.
 */
export function mediaPersists(m) {
  if (!m || typeof m !== 'object') return false;
  const url = String(m.url || '');
  const href = String(m.href || '');
  const path = String(m.path || '');
  if (/^blob:/i.test(url) || /^blob:/i.test(href)) return false;
  if (/^data:video/i.test(url) || /^data:video/i.test(href)) return false;
  const blob = `${path} ${url} ${href}`;
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(blob)) return false;
  if (path) return isSafeRelPath(path);
  const link = href || url;
  if (/^data:image/i.test(link)) return true;
  if (/^\/image\?path=/i.test(link)) {
    try {
      const q = new URL(link, 'http://127.0.0.1').searchParams.get('path') || '';
      return isSafeRelPath(q);
    } catch {
      return false;
    }
  }
  return false;
}

function freezeMediaLink(m) {
  if (!m || typeof m !== 'object') return m;
  const pathRaw = String(m.path || '');
  const url = String(m.url || '');
  const href = String(m.href || '');
  let path = isSafeRelPath(pathRaw) ? pathRaw.replace(/\\/g, '/') : '';
  if (!path) {
    const link = /^\/image\?path=/i.test(href) ? href : (/^\/image\?path=/i.test(url) ? url : '');
    if (link) {
      try {
        const q = new URL(link, 'http://127.0.0.1').searchParams.get('path') || '';
        if (isSafeRelPath(q)) path = q.replace(/\\/g, '/');
      } catch { /* keep empty */ }
    }
  }
  if (!path) return { name: m.name, type: m.type, url, href, path: '', session: m.session };
  const src = mediaSrcForPath(path);
  return {
    name: m.name,
    type: m.type,
    path,
    href: src,
    url: src,
    session: false
  };
}

function persistableMedia(list) {
  if (!Array.isArray(list)) return [];
  return list.map(freezeMediaLink).filter(mediaPersists);
}

function normalize(board) {
  const posts = board.posts
    .filter((p) => p && typeof p === 'object')
    .map((p) => blankPost({
      ...p,
      id: p.id || uid(),
      ideas: normalizeIdeas(p.ideas),
      media: persistableMedia(p.media),
      status: p.status === 'published' ? 'published' : 'draft',
      publishedAt: p.status === 'published' ? (p.publishedAt || null) : null,
      publishedUrl: normalizePublishedUrl(p.publishedUrl),
      guestScan: normalizeGuestScan(p.guestScan),
      // Boards written before source/outcome existed pick up the defaults here.
      source: normalizeSource(p.source),
      outcome: normalizeOutcome(p.outcome),
      lastPaste: normalizeLastPaste(p.lastPaste),
      // Boards written before park existed read as unparked. Anything other
      // than a literal true is not parked — a truthy string must not hide work.
      parked: p.parked === true,
      stageUndo: normalizeStageUndo(p.stageUndo)
    }));
  if (!posts.length) posts.push(blankPost());
  const activeId = posts.some((p) => p.id === board.activeId) ? board.activeId : posts[0].id;
  const ideaLayout = board.ideaLayout === 'free' ? 'free' : 'stack';
  return { activeId, posts, ideaLayout };
}

/**
 * Define `post` and `ideas` as accessors over the active post so v1 callers
 * (`state.post.hook`, `state.ideas`) keep working against the board. Enumerable
 * is false so they do not round-trip into storage and shadow the real posts.
 */
function withViews(board) {
  Object.defineProperty(board, 'post', {
    configurable: true,
    enumerable: false,
    get() { return getActive(this); },
    set(v) {
      const i = this.posts.findIndex((p) => p.id === this.activeId);
      if (i >= 0) this.posts[i] = blankPost({ ...v, id: this.posts[i].id });
    }
  });
  Object.defineProperty(board, 'ideas', {
    configurable: true,
    enumerable: false,
    get() { return getActive(this).ideas; },
    set(v) { getActive(this).ideas = Array.isArray(v) ? v : []; }
  });
  return board;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (isBoard(data)) return withViews(normalize(data));
      if (isLegacy(data)) return withViews(normalize(migrate(data)));
      return blank();
    }
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (isLegacy(legacy)) return withViews(normalize(migrate(legacy)));
      if (isBoard(legacy)) return withViews(normalize(legacy));
    }
    return blank();
  } catch {
    return blank();
  }
}

function isQuotaError(err) {
  return Boolean(err && (err.name === 'QuotaExceededError' || err.code === 22));
}

/**
 * Write `state` to localStorage. Returns `true` on success, `false` on a
 * quota failure — never throws for that case, and never claims success when
 * the write did not happen. `state.saveError` is set to `'quota'` (and left
 * for the caller to read) on failure, cleared to `null` on the next success,
 * so a caller that already has the `state` reference does not have to thread
 * the return value through. A non-quota error (corrupt data, disabled
 * storage) still throws — this only softens the one failure mode that is
 * expected to happen in normal use.
 */
export function saveState(state) {
  const board = isBoard(state) ? normalize(state) : normalize(migrate(state));
  try {
    localStorage.setItem(KEY, JSON.stringify({
      activeId: board.activeId,
      posts: board.posts,
      ideaLayout: board.ideaLayout === 'free' ? 'free' : 'stack'
    }));
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    if (state && typeof state === 'object') state.saveError = 'quota';
    return false;
  }
  if (state && typeof state === 'object') state.saveError = null;
  return true;
}

/** The active post. Never null — normalize guarantees at least one post. */
export function getActive(state) {
  return state.posts.find((p) => p.id === state.activeId) || state.posts[0];
}

/** Switch the active post. Unknown ids are ignored. Returns the active post. */
export function setActive(state, id) {
  if (state.posts.some((p) => p.id === id)) state.activeId = id;
  return getActive(state);
}

/**
 * Append a fresh draft, make it active, and return it. `overrides.source` is
 * validated, so `addPost(state, { source: 'banter' })` is the way a banter post
 * enters the board; an unknown source falls back to `'studio'`.
 */
export function addPost(state, overrides = {}) {
  const post = blankPost(overrides);
  post.source = normalizeSource(post.source);
  post.outcome = normalizeOutcome(post.outcome);
  post.lastPaste = normalizeLastPaste(post.lastPaste);
  post.stageUndo = normalizeStageUndo(post.stageUndo);
  post.publishedUrl = normalizePublishedUrl(post.publishedUrl);
  post.guestScan = normalizeGuestScan(post.guestScan);
  state.posts.push(post);
  state.activeId = post.id;
  return post;
}

/**
 * Append an idea to the **active** post and return it.
 *
 * `text` is trimmed; an empty or whitespace-only text returns `null` and appends
 * nothing, so a stray call cannot litter the lane with blanks. `part` is an
 * optional string. `source` is `'studio'` or `'shop'` — anything else coerces to
 * `'studio'`, which is how a shop line lands: `addIdea(state, { text, source: 'shop' })`.
 *
 * Persisting is the caller's job, same as `addPost`.
 */
export function addIdea(state, fields = {}) {
  const text = String(fields.text ?? '').trim();
  if (!text) return null;
  const idea = {
    id: fields.id || uid(),
    text,
    part: typeof fields.part === 'string' ? fields.part : '',
    source: normalizeIdeaSource(fields.source)
  };
  getActive(state).ideas.push(idea);
  return idea;
}

/**
 * Mark a post published or back to draft. Publishing stamps `publishedAt` if it
 * is not already set; returning to draft clears it. Returns the post, or null
 * when the id is unknown.
 */
export function setPublished(state, id, published) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  if (published) {
    post.status = 'published';
    post.publishedAt = post.publishedAt || new Date().toISOString();
  } else {
    post.status = 'draft';
    post.publishedAt = null;
  }
  return post;
}

/**
 * Snapshot the string that just went to the clipboard. Replaces the one slot.
 * Does not touch outcome, hook, body, or cta. Returns the post, or null.
 */
export function setLastPaste(state, id, snap) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  const next = normalizeLastPaste({
    text: snap && snap.text,
    platformId: snap && snap.platformId,
    partIndex: snap && snap.partIndex,
    stage: snap && snap.stage,
    at: new Date().toISOString()
  });
  if (!next) return post;
  post.lastPaste = next;
  return post;
}

/**
 * Record what actually happened to a post — the observed result, in the
 * operator's words. Stamps `recordedAt` when a note is first written.
 *
 * Passing an empty or whitespace-only note clears the outcome back to `null`,
 * which is how you undo a mis-typed note. Returns the post, or `null` when the
 * id is unknown.
 *
 * This is a record, not a score: nothing here feeds the heuristic.
 * What happened? is about `lastPaste`, not the live rail.
 */
export function setOutcome(state, id, note) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  const next = normalizeOutcome(note);
  if (!next) {
    post.outcome = null;
    return post;
  }
  post.outcome = {
    note: next.note,
    recordedAt: next.recordedAt || new Date().toISOString()
  };
  return post;
}

/**
 * Store the live network URL for a post. Normalized to host + status id.
 * Empty or junk clears to `null`. Does not fetch, and does not touch
 * outcome, lastPaste, or local published status.
 */
export function setPublishedUrl(state, id, raw) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  const next = normalizePublishedUrl(raw);
  if (next !== post.publishedUrl) post.guestScan = null;
  post.publishedUrl = next;
  return post;
}

/**
 * Record a successful guest scan. Identity only — `{ at, title, text }`.
 * Passing junk or empty does **not** clear a previous snapshot (fail keeps
 * last). Returns the post, or null when the id is unknown.
 */
export function setGuestScan(state, id, raw) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  const next = normalizeGuestScan(raw);
  if (next) post.guestScan = next;
  return post;
}

/** Set where a post came from. Unknown values fall back to `'studio'`. */
export function setSource(state, id, source) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  post.source = normalizeSource(source);
  return post;
}

/**
 * Park or unpark a post. Parking hides it from the default board list; it is
 * **not** a delete — the post, its ideas, its paste and its note all stay.
 *
 * Parking the active post moves the board to the nearest unparked neighbour
 * first, so the canvas never goes blank underneath the operator. If there is no
 * neighbour to move to, the park is **refused**: a board cannot park itself
 * into showing nothing.
 *
 * Return values are three-way on purpose, because "it worked" and "I declined"
 * must not look the same to a caller:
 *
 *   - the post   — parked or unparked as asked
 *   - `false`    — refused; this is the last unparked post and it stays visible
 *   - `null`     — unknown id, same convention as `setOutcome` / `setPublished`
 */
export function setParked(state, id, parked) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  const next = parked === true;

  if (next && state.activeId === id) {
    const other = state.posts.find((p) => p.id !== id && p.parked !== true);
    // Nowhere to go. Refuse, and say so — returning the post here would read
    // as success to anyone checking the return value.
    if (!other) return false;
    state.activeId = other.id;
  }

  post.parked = next;
  return post;
}

/**
 * Posts the board should show: everything unparked, plus the active post even
 * if it is parked. The second half is what keeps a parked-then-selected post
 * from being invisible while its content fills the stage.
 */
export function visiblePosts(state) {
  if (!state || !Array.isArray(state.posts)) return [];
  return state.posts.filter((p) => p && (p.parked !== true || p.id === state.activeId));
}

/** How many posts are parked and therefore out of the default list. */
export function parkedCount(state) {
  if (!state || !Array.isArray(state.posts)) return 0;
  return state.posts.filter((p) => p && p.parked === true && p.id !== state.activeId).length;
}

/**
 * Snapshot hook/body/cta on the active post before a stage overwrite.
 * Pass `previous` on a rail commit so the slot is the pre-blur copy, not
 * the live fields. One slot — a later write replaces it. Persisting is
 * the caller's job.
 */
export function rememberStageWrite(state, previous) {
  const post = getActive(state);
  const src = previous && typeof previous === 'object' ? previous : post;
  post.stageUndo = {
    hook: String(src.hook ?? ''),
    body: String(src.body ?? ''),
    cta: String(src.cta ?? '')
  };
  return post.stageUndo;
}

/**
 * Restore the last remembered hook/body/cta once, then clear the slot.
 * Returns true when something was restored.
 */
export function undoStageWrite(state) {
  const post = getActive(state);
  const prev = normalizeStageUndo(post.stageUndo);
  if (!prev) return false;
  post.hook = prev.hook;
  post.body = prev.body;
  post.cta = prev.cta;
  post.stageUndo = null;
  return true;
}

export function uid() {
  return 'c' + Math.random().toString(36).slice(2, 9);
}

export const __testing = {
  blank, blankPost, migrate, normalize, withViews, isBoard, isLegacy,
  normalizeSource, normalizeOutcome, DEFAULT_SOURCE,
  normalizeIdeaSource, normalizeIdeas, DEFAULT_IDEA_SOURCE, KEY, LEGACY_KEY,
  normalizeStageUndo, normalizeLastPaste
};
