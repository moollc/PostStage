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

t('ideaLayout defaults to stack and round-trips', () => {
  eq(loadState().ideaLayout, 'stack', 'default stack');
  const s = loadState();
  s.ideaLayout = 'free';
  saveState(s);
  eq(loadState().ideaLayout, 'free', 'free persisted');
});

t('unknown ideaLayout falls back to stack', () => {
  const s = loadState();
  mem.set(KEY, JSON.stringify({ activeId: s.activeId, posts: s.posts, ideaLayout: 'grid' }));
  eq(loadState().ideaLayout, 'stack', 'coerced');
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
  eq(Object.keys(raw).sort(), ['activeId', 'ideaLayout', 'posts'], 'only board keys stored');
  ok(!('post' in raw) && !('ideas' in raw), 'v1 view names are not stored');
});

// --- source ---------------------------------------------------------------

t('every post defaults to source studio', () => {
  const s = loadState();
  eq(getActive(s).source, 'studio', 'blank default');
  eq(addPost(s).source, 'studio', 'addPost default');
});

t('addPost accepts a known source', () => {
  const s = loadState();
  eq(addPost(s, { source: 'banter' }).source, 'banter', 'banter');
  eq(addPost(s, { source: 'marketing' }).source, 'marketing', 'marketing');
});

t('an unknown or malformed source falls back to studio', () => {
  const s = loadState();
  eq(addPost(s, { source: 'tiktok-brain' }).source, 'studio', 'unknown string');
  eq(addPost(s, { source: null }).source, 'studio', 'null');
  eq(addPost(s, { source: 7 }).source, 'studio', 'number');
});

t('source survives a save/load round trip', () => {
  const s = loadState();
  const id = addPost(s, { source: 'banter' }).id;
  saveState(s);
  const back = loadState();
  eq(back.posts.find((p) => p.id === id).source, 'banter', 'persisted');
});

t('a stored post with a bad source is repaired on read', () => {
  mem.set(KEY, JSON.stringify({ activeId: 'p1', posts: [{ id: 'p1', source: 'nonsense' }] }));
  eq(getActive(loadState()).source, 'studio', 'coerced');
});

t('setSource changes it, and rejects unknown values', () => {
  const s = loadState();
  const id = s.activeId;
  eq(store.setSource(s, id, 'marketing').source, 'marketing', 'set');
  eq(store.setSource(s, id, 'bogus').source, 'studio', 'unknown coerced');
  eq(store.setSource(s, 'nope', 'banter'), null, 'unknown id');
});

// --- outcome --------------------------------------------------------------

t('every post defaults to a null outcome', () => {
  const s = loadState();
  eq(getActive(s).outcome, null, 'blank default');
  eq(addPost(s).outcome, null, 'addPost default');
});

t('setOutcome records a note and stamps recordedAt', () => {
  const s = loadState();
  const p = store.setOutcome(s, s.activeId, 'flopped, 3 likes');
  eq(p.outcome.note, 'flopped, 3 likes', 'note');
  ok(p.outcome.recordedAt, 'recordedAt stamped');
  ok(!Number.isNaN(Date.parse(p.outcome.recordedAt)), 'recordedAt is a real date');
});

t('setOutcome trims and keeps the first stamp on rewrite', () => {
  const s = loadState();
  const id = s.activeId;
  const first = store.setOutcome(s, id, '  spaced note  ').outcome;
  eq(first.note, 'spaced note', 'trimmed');
  const second = store.setOutcome(s, id, 'a better note').outcome;
  eq(second.note, 'a better note', 'note replaced');
  ok(second.recordedAt, 'still stamped');
});

t('an empty note clears the outcome', () => {
  const s = loadState();
  const id = s.activeId;
  store.setOutcome(s, id, 'something');
  eq(store.setOutcome(s, id, '   ').outcome, null, 'whitespace clears');
  store.setOutcome(s, id, 'again');
  eq(store.setOutcome(s, id, null).outcome, null, 'null clears');
});

t('setOutcome returns null for an unknown id', () => {
  eq(store.setOutcome(loadState(), 'nope', 'note'), null, 'null');
});

t('outcome survives a save/load round trip', () => {
  const s = loadState();
  const id = s.activeId;
  store.setOutcome(s, id, 'saved 40, no clicks');
  const stamp = getActive(s).outcome.recordedAt;
  saveState(s);
  const back = loadState();
  eq(getActive(back).outcome.note, 'saved 40, no clicks', 'note persisted');
  eq(getActive(back).outcome.recordedAt, stamp, 'stamp persisted unchanged');
});

t('a malformed stored outcome is repaired on read', () => {
  mem.set(KEY, JSON.stringify({
    activeId: 'p1',
    posts: [
      { id: 'p1', outcome: 'a bare string' },
      { id: 'p2', outcome: { note: '   ' } },
      { id: 'p3', outcome: { note: 'kept', recordedAt: 42 } },
      { id: 'p4', outcome: 12345 }
    ]
  }));
  const s = loadState();
  const by = (id) => s.posts.find((p) => p.id === id);
  eq(by('p1').outcome, { note: 'a bare string', recordedAt: null }, 'bare string wrapped');
  eq(by('p2').outcome, null, 'blank note cleared');
  eq(by('p3').outcome, { note: 'kept', recordedAt: null }, 'bad recordedAt dropped');
  eq(by('p4').outcome, null, 'nonsense cleared');
});

// --- migration and views --------------------------------------------------

t('a migrated v1 post gets studio source and null outcome', () => {
  mem.set(LEGACY_KEY, JSON.stringify(V1));
  const p = getActive(loadState());
  eq(p.source, 'studio', 'source');
  eq(p.outcome, null, 'outcome');
  eq(p.hook, 'Old hook', 'v1 fields still survive');
});

t('a v2 board saved before these fields existed gains them', () => {
  mem.set(KEY, JSON.stringify({
    activeId: 'old1',
    posts: [{ id: 'old1', title: 'Pre-banter', hook: 'h', status: 'published', publishedAt: '2026-01-01T00:00:00.000Z' }]
  }));
  const p = getActive(loadState());
  eq(p.source, 'studio', 'source backfilled');
  eq(p.outcome, null, 'outcome backfilled');
  eq(p.status, 'published', 'existing fields untouched');
  eq(p.publishedAt, '2026-01-01T00:00:00.000Z', 'stamp untouched');
});

t('getActive views still work with the new fields', () => {
  const s = loadState();
  eq(s.post.source, 'studio', 'source readable through the view');
  eq(s.post.outcome, null, 'outcome readable through the view');
  store.setOutcome(s, s.activeId, 'via helper');
  eq(s.post.outcome.note, 'via helper', 'view sees the helper write');
  const b = addPost(s, { source: 'banter' });
  eq(s.post.source, 'banter', 'view follows to the new active post');
  eq(s.post.id, b.id, 'sanity');
});

t('outcome and source are not confused with the heuristic score', () => {
  const s = loadState();
  store.setOutcome(s, s.activeId, 'went viral');
  ok(!('score' in getActive(s)), 'no score field written onto the post');
  ok(!('band' in getActive(s)), 'no band field written onto the post');
});

// --- shop ideas -----------------------------------------------------------

t('addIdea appends a studio idea to the active post by default', () => {
  const s = loadState();
  const before = getActive(s).ideas.length;
  const idea = store.addIdea(s, { text: 'a fresh angle' });
  eq(getActive(s).ideas.length, before + 1, 'appended');
  eq(idea.text, 'a fresh angle', 'text');
  eq(idea.source, 'studio', 'defaults to studio');
  eq(idea.part, '', 'part defaults to empty string');
  ok(idea.id, 'has an id');
  eq(getActive(s).ideas.at(-1).id, idea.id, 'it is the one that landed');
});

t('addIdea takes a shop idea', () => {
  const s = loadState();
  const idea = store.addIdea(s, { text: 'overheard on the floor', source: 'shop' });
  eq(idea.source, 'shop', 'shop kept');
  eq(getActive(s).ideas.at(-1).source, 'shop', 'stored on the post');
});

t('addIdea keeps an optional part', () => {
  const s = loadState();
  eq(store.addIdea(s, { text: 'a hook line', part: 'hook' }).part, 'hook', 'part kept');
  eq(store.addIdea(s, { text: 'no part given' }).part, '', 'absent part is empty');
  eq(store.addIdea(s, { text: 'bad part', part: 42 }).part, '', 'non-string part dropped');
});

t('addIdea trims text', () => {
  const s = loadState();
  eq(store.addIdea(s, { text: '   padded idea   ' }).text, 'padded idea', 'trimmed');
});

t('addIdea rejects empty text and appends nothing', () => {
  const s = loadState();
  const before = getActive(s).ideas.length;
  eq(store.addIdea(s, { text: '' }), null, 'empty string');
  eq(store.addIdea(s, { text: '    ' }), null, 'whitespace only');
  eq(store.addIdea(s, {}), null, 'missing text');
  eq(store.addIdea(s, { text: null }), null, 'null text');
  eq(getActive(s).ideas.length, before, 'nothing was appended');
});

t('addIdea coerces an unknown source to studio', () => {
  const s = loadState();
  eq(store.addIdea(s, { text: 'x1', source: 'banter' }).source, 'studio', 'post source is not an idea source');
  eq(store.addIdea(s, { text: 'x2', source: 'marketing' }).source, 'studio', 'nor marketing');
  eq(store.addIdea(s, { text: 'x3', source: 'nonsense' }).source, 'studio', 'unknown string');
  eq(store.addIdea(s, { text: 'x4', source: null }).source, 'studio', 'null');
  eq(store.addIdea(s, { text: 'x5', source: 7 }).source, 'studio', 'number');
});

t('addIdea lands on the active post, not the first one', () => {
  const s = loadState();
  const first = s.activeId;
  const second = addPost(s);
  store.addIdea(s, { text: 'belongs to the second', source: 'shop' });
  eq(second.ideas.length, 1, 'went to the active post');
  eq(second.ideas[0].text, 'belongs to the second', 'the right idea');
  eq(s.posts.find((p) => p.id === first).ideas.at(-1).text !== 'belongs to the second', true, 'not on the first');
});

t('shop ideas survive a save/load round trip', () => {
  const s = loadState();
  store.addIdea(s, { text: 'shop line one', source: 'shop', part: 'hook' });
  store.addIdea(s, { text: 'studio line' });
  saveState(s);
  const back = loadState();
  const ideas = getActive(back).ideas;
  const shop = ideas.find((i) => i.text === 'shop line one');
  eq(shop.source, 'shop', 'shop source persisted');
  eq(shop.part, 'hook', 'part persisted');
  eq(ideas.find((i) => i.text === 'studio line').source, 'studio', 'studio source persisted');
});

t('ideas stored without a source are read back as studio', () => {
  mem.set(KEY, JSON.stringify({
    activeId: 'p1',
    posts: [{ id: 'p1', ideas: [
      { id: 'i1', text: 'pre-shop idea' },
      { id: 'i2', text: 'bad source', source: 'banter' },
      { id: 'i3', text: 'already shop', source: 'shop' }
    ] }]
  }));
  const ideas = getActive(loadState()).ideas;
  eq(ideas[0].source, 'studio', 'missing backfilled');
  eq(ideas[1].source, 'studio', 'post-vocabulary source coerced');
  eq(ideas[2].source, 'shop', 'valid shop kept');
  eq(ideas[0].text, 'pre-shop idea', 'text untouched');
});

t('the seed idea keeps its part and gains a source', () => {
  const idea = getActive(loadState()).ideas[0];
  eq(idea.part, 'hook', 'seed part preserved');
  eq(idea.source, 'studio', 'seed source backfilled');
});

t('a migrated v1 idea gains a studio source', () => {
  mem.set(LEGACY_KEY, JSON.stringify(V1));
  const idea = getActive(loadState()).ideas[0];
  eq(idea.source, 'studio', 'source');
  eq(idea.part, 'hook', 'v1 part still preserved');
  eq(idea.text, 'an idea', 'v1 text still preserved');
});

console.log(failed ? `\n${failed} FAILED` : '\nall store tests pass');
process.exit(failed ? 1 : 0);
