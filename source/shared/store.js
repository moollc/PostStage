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
 * `stageUndo` is `null` or `{ hook, body, cta }` — the previous stage copy
 * before the last Use-on-stage or rail overwrite of those fields. One slot,
 * not a history. `rememberStageWrite` / `undoStageWrite` own it.
 *
 * v1 stored a single `{ post, ideas }`. That is migrated on read, not dropped —
 * see `migrate()`. The v1 key is left in place so a downgrade does not lose work.
 *
 * Compatibility: `state.post` and `state.ideas` are still readable, defined as
 * accessors over the active post, so callers written against v1 keep working
 * while the UI is rewired. Both are live views, not copies — mutating
 * `state.post.hook` mutates the active post. Prefer `getActive(state)`.
 */

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
    source: DEFAULT_SOURCE,
    outcome: null,
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
 * Repair a board that parsed but is not internally consistent: missing fields,
 * an empty list, or an `activeId` pointing at a post that is gone.
 */
function persistableMedia(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((m) => {
    if (!m || typeof m !== 'object') return false;
    const url = String(m.url || '');
    if (!url || url.startsWith('blob:')) return false;
    return true;
  });
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
      // Boards written before source/outcome existed pick up the defaults here.
      source: normalizeSource(p.source),
      outcome: normalizeOutcome(p.outcome),
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

export function saveState(state) {
  const board = isBoard(state) ? normalize(state) : normalize(migrate(state));
  localStorage.setItem(KEY, JSON.stringify({
    activeId: board.activeId,
    posts: board.posts,
    ideaLayout: board.ideaLayout === 'free' ? 'free' : 'stack'
  }));
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
  post.stageUndo = normalizeStageUndo(post.stageUndo);
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
 * Record what actually happened to a post — the observed result, in the
 * operator's words. Stamps `recordedAt` when a note is first written.
 *
 * Passing an empty or whitespace-only note clears the outcome back to `null`,
 * which is how you undo a mis-typed note. Returns the post, or `null` when the
 * id is unknown.
 *
 * This is a record, not a score: nothing here feeds the heuristic.
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

/** Set where a post came from. Unknown values fall back to `'studio'`. */
export function setSource(state, id, source) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return null;
  post.source = normalizeSource(source);
  return post;
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
  normalizeStageUndo
};
