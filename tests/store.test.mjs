/**
 * Store tests. Run: node tests/store.test.mjs
 *
 * store.js talks to localStorage, which does not exist in Node, so we install a
 * minimal in-memory stand-in before importing the module.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

const store = await import('../source/shared/store.js');
const { loadState, saveState, getActive, setActive, addPost, setPublished, __testing } = store;
const { KEY, LEGACY_KEY } = __testing;

let failed = 0;
function t(name, fn) {
  mem.clear();
  try {
    fn();
    console.log('ok    ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + name + '\n        ' + err.message);
  }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || 'not equal'}: ${A} !== ${B}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

const V1 = {
  ideas: [{ id: 'i1', text: 'an idea', part: 'hook' }],
  post: {
    id: 'stage', x: 340, y: 80, title: 'Old post', hook: 'Old hook', body: 'Old body',
    cta: 'Old cta', hashtags: ['a'], media: [], platform: 'tiktok', genPrompt: '',
    audience: 'someone real', audienceHow: 'stated'
  }
};

t('blank starts with exactly one draft and it is active', () => {
  const s = loadState();
  eq(s.posts.length, 1, 'one post');
  eq(s.posts[0].status, 'draft', 'status');
  eq(s.posts[0].publishedAt, null, 'publishedAt');
  eq(s.activeId, s.posts[0].id, 'activeId points at it');
  ok(s.posts[0].ideas.length >= 1, 'starts with an idea');
});

t('blank keeps the audience and media defaults', () => {
  const p = getActive(loadState());
  ok(p.audience.includes('creator'), 'audience default kept');
  eq(p.audienceHow, 'stated', 'audienceHow default kept');
  eq(p.media, [], 'media default kept');
});

t('v1 state migrates into a one-post board', () => {
  mem.set(LEGACY_KEY, JSON.stringify(V1));
  const s = loadState();
  eq(s.posts.length, 1, 'one post');
  const p = getActive(s);
  eq(p.hook, 'Old hook', 'post fields survive');
  eq(p.platform, 'tiktok', 'platform survives');
  eq(p.status, 'draft', 'wrapped as draft');
  eq(p.publishedAt, null, 'publishedAt null');
  eq(p.ideas.length, 1, 'ideas moved onto the post');
  eq(p.ideas[0].part, 'hook', 'idea part preserved');
});

t('migrating does not destroy the v1 record', () => {
  mem.set(LEGACY_KEY, JSON.stringify(V1));
  saveState(loadState());
  ok(mem.get(LEGACY_KEY), 'v1 key still present after a v2 save');
});

t('v1 stored under the v2 key is still understood', () => {
  mem.set(KEY, JSON.stringify(V1));
  eq(getActive(loadState()).hook, 'Old hook', 'legacy shape at v2 key migrates');
});

t('save then load round-trips the board', () => {
  const s = loadState();
  addPost(s, { title: 'Second' });
  saveState(s);
  const back = loadState();
  eq(back.posts.length, 2, 'both posts persisted');
  eq(back.activeId, s.activeId, 'activeId persisted');
  eq(getActive(back).title, 'Second', 'active is the new post');
});

t('addPost appends a draft and makes it active', () => {
  const s = loadState();
  const first = s.activeId;
  const p = addPost(s);
  eq(s.posts.length, 2, 'appended');
  eq(s.activeId, p.id, 'new post is active');
  ok(p.id !== first, 'new id');
  eq(p.status, 'draft', 'starts as draft');
  eq(p.ideas, [], 'starts with no ideas');
});

t('setActive switches, and ignores an unknown id', () => {
  const s = loadState();
  const first = s.activeId;
  const second = addPost(s).id;
  eq(setActive(s, first).id, first, 'switched back');
  eq(s.activeId, first, 'activeId updated');
  setActive(s, 'nope');
  eq(s.activeId, first, 'unknown id ignored');
  eq(setActive(s, second).id, second, 'switched forward');
});

t('setPublished stamps and clears publishedAt', () => {
  const s = loadState();
  const id = s.activeId;
  const p = setPublished(s, id, true);
  eq(p.status, 'published', 'status');
  ok(p.publishedAt, 'publishedAt stamped');
  const stamp = p.publishedAt;
  setPublished(s, id, true);
  eq(getActive(s).publishedAt, stamp, 're-publishing keeps the original stamp');
  setPublished(s, id, false);
  eq(getActive(s).status, 'draft', 'back to draft');
  eq(getActive(s).publishedAt, null, 'stamp cleared');
});

t('setPublished returns null for an unknown id', () => {
  eq(setPublished(loadState(), 'nope', true), null, 'null');
});

t('published status survives a save/load round trip', () => {
  const s = loadState();
  setPublished(s, s.activeId, true);
  saveState(s);
  const back = loadState();
  eq(getActive(back).status, 'published', 'status persisted');
  ok(getActive(back).publishedAt, 'stamp persisted');
});

t('an activeId pointing at a deleted post falls back', () => {
  const s = loadState();
  addPost(s, { title: 'Second' });
  s.posts = s.posts.filter((p) => p.id !== s.activeId);
  saveState(s);
  const back = loadState();
  ok(back.posts.some((p) => p.id === back.activeId), 'activeId resolves to a real post');
});

t('an empty board recovers to one draft', () => {
  mem.set(KEY, JSON.stringify({ activeId: 'gone', posts: [] }));
  const s = loadState();
  eq(s.posts.length, 1, 'recovered a post');
  eq(s.activeId, s.posts[0].id, 'activeId fixed');
});

t('corrupt JSON falls back to blank', () => {
  mem.set(KEY, '{not json');
  eq(loadState().posts.length, 1, 'blank board');
});

t('legacy state.post / state.ideas still read through to the active post', () => {
  const s = loadState();
  eq(s.post.id, getActive(s).id, 'state.post is the active post');
  eq(s.ideas, getActive(s).ideas, 'state.ideas is the active ideas');
  s.post.hook = 'edited through the view';
  eq(getActive(s).hook, 'edited through the view', 'writes reach the active post');
  s.ideas = [{ id: 'x', text: 'replaced', part: '' }];
  eq(getActive(s).ideas.length, 1, 'ideas setter reaches the post');
  eq(getActive(s).ideas[0].text, 'replaced', 'ideas setter value');
});

t('the compatibility views follow setActive', () => {
  const s = loadState();
  s.post.hook = 'first';
  const second = addPost(s, { hook: 'second' });
  eq(s.post.hook, 'second', 'view follows the newly active post');
  setActive(s, s.posts[0].id);
  eq(s.post.hook, 'first', 'view follows back');
  ok(second.id !== s.activeId, 'sanity');
});

t('the compatibility views are not serialized', () => {
  const s = loadState();
  saveState(s);
  const raw = JSON.parse(mem.get(KEY));
  eq(Object.keys(raw).sort(), ['activeId', 'posts'], 'only board keys stored');
});

console.log(failed ? `\n${failed} FAILED` : '\nall store tests pass');
process.exit(failed ? 1 : 0);
