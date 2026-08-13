/**
 * Post board storage.
 *
 * The board holds many posts, one active. Shape:
 *
 *   { activeId, posts: [{ id, status, publishedAt, ideas[], ...postFields }] }
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
    ideas: [],
    ...overrides
  };
}

function blank() {
  const post = blankPost({
    title: 'Untitled post',
    hook: 'Most posts fail before the second line.',
    body: 'The first line buys a second of attention. The next lines have to pay it back with something the reader can use today.',
    cta: 'What line would you cut first?',
    hashtags: ['craft', 'audience'],
    audience: 'a creator who stages a post on their laptop before they open the native app',
    audienceHow: 'stated',
    ideas: [
      { id: uid(), text: 'What if the post starts with the cost of waiting?', part: 'hook' }
    ]
  });
  return withViews({ activeId: post.id, posts: [post] });
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
    publishedAt: null
  });
  return { activeId: merged.id, posts: [merged] };
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
function normalize(board) {
  const posts = board.posts
    .filter((p) => p && typeof p === 'object')
    .map((p) => blankPost({
      ...p,
      id: p.id || uid(),
      ideas: Array.isArray(p.ideas) ? p.ideas : [],
      status: p.status === 'published' ? 'published' : 'draft',
      publishedAt: p.status === 'published' ? (p.publishedAt || null) : null
    }));
  if (!posts.length) posts.push(blankPost());
  const activeId = posts.some((p) => p.id === board.activeId) ? board.activeId : posts[0].id;
  return { activeId, posts };
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
  localStorage.setItem(KEY, JSON.stringify({ activeId: board.activeId, posts: board.posts }));
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

/** Append a fresh draft, make it active, and return it. */
export function addPost(state, overrides = {}) {
  const post = blankPost(overrides);
  state.posts.push(post);
  state.activeId = post.id;
  return post;
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

export function uid() {
  return 'c' + Math.random().toString(36).slice(2, 9);
}

export const __testing = { blank, blankPost, migrate, normalize, withViews, isBoard, isLegacy, KEY, LEGACY_KEY };
