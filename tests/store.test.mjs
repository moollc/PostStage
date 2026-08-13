/**
 * Store tests. Run: node tests/store.test.mjs
 *
 * store.js talks to localStorage, which does not exist in Node, so we install a
 * minimal in-memory stand-in before importing the module.
 */

const mem = new Map();
let throwOnSet = null; // set to an Error to make the next setItem(s) throw it
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    if (throwOnSet) throw throwOnSet;
    mem.set(k, String(v));
  },
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

function quotaException() {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

const store = await import('../source/shared/store.js');
const { loadState, saveState, getActive, setActive, addPost, setPublished, __testing } = store;
const { KEY, LEGACY_KEY } = __testing;

let failed = 0;
function t(name, fn) {
  mem.clear();
  throwOnSet = null;
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
  eq(s.posts[0].ideas, [], 'no seed idea');
  eq(s.posts[0].hook, '', 'no seed hook');
});

t('blank keeps the audience and media defaults', () => {
  const p = getActive(loadState());
  eq(p.audience, '', 'no seed audience');
  eq(p.audienceHow, 'unknown', 'audienceHow default kept');
  eq(p.media, [], 'media default kept');
  eq(p.body, '', 'no seed body');
  eq(p.cta, '', 'no seed cta');
  eq(p.hashtags, [], 'no seed tags');
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
  eq(p.lastPaste, null, 'lastPaste');
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
  eq(p.lastPaste, null, 'lastPaste backfilled');
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
  eq(s.posts.find((p) => p.id === first).ideas, [], 'not on the first');
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

t('blank has no seed idea', () => {
  eq(getActive(loadState()).ideas, [], 'no seed idea');
});

t('blank starts with no stage undo', () => {
  eq(getActive(loadState()).stageUndo, null, 'null');
  eq(addPost(loadState()).stageUndo, null, 'addPost null');
});

t('blank starts with no lastPaste', () => {
  eq(getActive(loadState()).lastPaste, null, 'null');
  eq(addPost(loadState()).lastPaste, null, 'addPost null');
});

t('setLastPaste stores the exact clipboard string and stamps at', () => {
  const s = loadState();
  const pasted = 'HOOK\n\nbody 1/2';
  const p = store.setLastPaste(s, s.activeId, {
    text: pasted,
    platformId: 'x',
    partIndex: 0
  });
  eq(p.lastPaste.text, pasted, 'exact text');
  eq(p.lastPaste.platformId, 'x', 'platform');
  eq(p.lastPaste.partIndex, 0, 'part');
  ok(p.lastPaste.at, 'at stamped');
  ok(!Number.isNaN(Date.parse(p.lastPaste.at)), 'at is a real date');
});

t('a later Copy replaces lastPaste and does not touch outcome', () => {
  const s = loadState();
  const id = s.activeId;
  store.setLastPaste(s, id, { text: 'first paste', platformId: 'x', partIndex: 0 });
  store.setOutcome(s, id, 'saw 3 replies');
  const stamp = getActive(s).outcome.recordedAt;
  store.setLastPaste(s, id, { text: 'second paste', platformId: 'instagram', partIndex: 2 });
  const p = getActive(s);
  eq(p.lastPaste.text, 'second paste', 'replaced');
  eq(p.lastPaste.platformId, 'instagram', 'platform replaced');
  eq(p.lastPaste.partIndex, 2, 'index replaced');
  eq(p.outcome.note, 'saw 3 replies', 'outcome note kept');
  eq(p.outcome.recordedAt, stamp, 'outcome stamp kept');
});

t('rail-like field edits and save/load do not rewrite lastPaste', () => {
  const s = loadState();
  const pasted = 'exact clipboard string';
  store.setLastPaste(s, s.activeId, { text: pasted, platformId: 'x', partIndex: 1 });
  const snap = { ...getActive(s).lastPaste };
  const p = getActive(s);
  p.hook = 'edited hook after paste';
  p.body = 'edited body';
  p.cta = 'edited cta';
  store.rememberStageWrite(s, { hook: 'old', body: 'old', cta: 'old' });
  saveState(s);
  const back = getActive(loadState());
  eq(back.lastPaste, snap, 'lastPaste unchanged after rail edit persist');
  eq(back.hook, 'edited hook after paste', 'live copy did change');
});

t('undo last write does not rewrite lastPaste', () => {
  const s = loadState();
  store.setLastPaste(s, s.activeId, { text: 'pasted', platformId: 'x', partIndex: 0 });
  const snap = { ...getActive(s).lastPaste };
  const p = getActive(s);
  p.hook = 'before';
  store.rememberStageWrite(s);
  p.hook = 'after';
  store.undoStageWrite(s);
  eq(getActive(s).lastPaste, snap, 'lastPaste still the clipboard snapshot');
  eq(getActive(s).hook, 'before', 'hook restored');
});

t('setOutcome does not rewrite lastPaste, and clearing it does not either', () => {
  const s = loadState();
  store.setLastPaste(s, s.activeId, { text: 'pasted', platformId: 'linkedin', partIndex: 0 });
  const snap = { ...getActive(s).lastPaste };
  store.setOutcome(s, s.activeId, 'quiet');
  eq(getActive(s).lastPaste, snap, 'kept after setOutcome');
  store.setOutcome(s, s.activeId, '');
  eq(getActive(s).lastPaste, snap, 'kept after clear');
  eq(getActive(s).outcome, null, 'outcome cleared');
});

t('lastPaste survives a save/load round trip', () => {
  const s = loadState();
  store.setLastPaste(s, s.activeId, { text: 'thread part 2/2', platformId: 'x', partIndex: 1 });
  const snap = { ...getActive(s).lastPaste };
  saveState(s);
  eq(getActive(loadState()).lastPaste, snap, 'persisted');
});

t('a malformed stored lastPaste is repaired on read', () => {
  mem.set(KEY, JSON.stringify({
    activeId: 'p1',
    posts: [
      { id: 'p1', lastPaste: 'bare' },
      { id: 'p2', lastPaste: { text: '' } },
      { id: 'p3', lastPaste: { text: 'kept', platformId: 'x', partIndex: 3, at: 42 } },
      { id: 'p4', lastPaste: 99 }
    ]
  }));
  const s = loadState();
  const by = (id) => s.posts.find((p) => p.id === id);
  eq(by('p1').lastPaste, null, 'bare string dropped');
  eq(by('p2').lastPaste, null, 'empty text dropped');
  eq(by('p3').lastPaste, { text: 'kept', platformId: 'x', partIndex: 3, at: null }, 'bad at dropped, rest kept');
  eq(by('p4').lastPaste, null, 'nonsense dropped');
});

t('setLastPaste returns null for an unknown id', () => {
  eq(store.setLastPaste(loadState(), 'nope', { text: 'x', platformId: 'x', partIndex: 0 }), null, 'null');
});

t('rememberStageWrite can take a pre-commit snapshot', () => {
  const s = loadState();
  const p = getActive(s);
  p.hook = 'live hook';
  p.body = 'live body';
  p.cta = 'live cta';
  store.rememberStageWrite(s, { hook: 'cut hook', body: 'cut body', cta: 'cut cta' });
  eq(p.stageUndo, { hook: 'cut hook', body: 'cut body', cta: 'cut cta' }, 'stored the passed copy');
  eq(p.hook, 'live hook', 'live fields unchanged');
  ok(store.undoStageWrite(s), 'restored');
  eq(p.hook, 'cut hook', 'hook from the rail snapshot');
  eq(p.body, 'cut body', 'body from the rail snapshot');
  eq(p.cta, 'cut cta', 'cta from the rail snapshot');
});

t('a later remember replaces the one stack slot', () => {
  const s = loadState();
  const p = getActive(s);
  p.hook = 'first';
  store.rememberStageWrite(s);
  p.hook = 'second';
  store.rememberStageWrite(s);
  eq(p.stageUndo.hook, 'second', 'last write only');
});

t('undoStageWrite restores once and clears the slot', () => {
  const s = loadState();
  const p = getActive(s);
  p.hook = 'before';
  p.body = 'kept';
  store.rememberStageWrite(s);
  p.hook = 'after';
  ok(store.undoStageWrite(s), 'restored');
  eq(p.hook, 'before', 'hook back');
  eq(p.body, 'kept', 'body untouched by the write');
  eq(p.stageUndo, null, 'cleared');
  eq(store.undoStageWrite(s), false, 'second undo is a no-op');
  eq(p.hook, 'before', 'stays restored');
});

t('stage undo survives a save/load round trip', () => {
  const s = loadState();
  getActive(s).hook = 'live';
  store.rememberStageWrite(s);
  getActive(s).hook = 'overwritten';
  saveState(s);
  const loaded = loadState();
  const back = getActive(loaded);
  eq(back.hook, 'overwritten', 'write persisted');
  eq(back.stageUndo, { hook: 'live', body: '', cta: '' }, 'slot persisted');
  ok(store.undoStageWrite(loaded), 'undo after load');
  eq(getActive(loaded).hook, 'live', 'restored after load');
  eq(getActive(loaded).stageUndo, null, 'cleared after load undo');
});

t('a malformed stored stageUndo is repaired on read', () => {
  mem.set(KEY, JSON.stringify({ activeId: 'p1', posts: [{ id: 'p1', stageUndo: 'nope' }] }));
  eq(getActive(loadState()).stageUndo, null, 'coerced');
});

t('a migrated v1 post gets a null stageUndo', () => {
  mem.set(LEGACY_KEY, JSON.stringify(V1));
  eq(getActive(loadState()).stageUndo, null, 'null');
});

t('a migrated v1 idea gains a studio source', () => {
  mem.set(LEGACY_KEY, JSON.stringify(V1));
  const idea = getActive(loadState()).ideas[0];
  eq(idea.source, 'studio', 'source');
  eq(idea.part, 'hook', 'v1 part still preserved');
  eq(idea.text, 'an idea', 'v1 text still preserved');
});

// --- media survives persist, but never reaches the paste string -----------

const { formatPost } = await import('../source/shared/export.js');
const { getPlatform } = await import('../source/shared/platforms.js');

t('a post with media still pastes text only after persist', () => {
  const s = loadState();
  const p = getActive(s);
  p.hook = 'Most posts fail before the second line.';
  p.body = 'The first line buys a second of attention.';
  p.cta = 'What line would you cut first?';
  p.hashtags = ['craft'];
  // A durable data: attachment, which survives a reload. Blob urls are dropped
  // on persist by design (they are dead after reload) — see the case below.
  p.media = [{ name: 'private-shot.png', type: 'image/png', url: 'data:image/png;base64,iVBORw0KGgo=' }];
  p.genPrompt = 'a still of a desk at night';

  saveState(s);
  const back = getActive(loadState());

  // The attachment is still on the post — persist must not drop durable media.
  eq(back.media.length, 1, 'media survived the round trip');
  eq(back.media[0].name, 'private-shot.png', 'file name survived');
  eq(back.genPrompt, 'a still of a desk at night', 'gen prompt survived');

  // The file name and the encoded bytes really are in storage, so the only
  // thing between them and a public timeline is the copy string.
  ok(/private-shot\.png/.test(mem.get(KEY)), 'the file name really is in storage');

  // ...and after reload, Copy post is still text only, on every platform.
  for (const id of ['x', 'instagram', 'tiktok', 'youtube', 'linkedin', 'facebook']) {
    const out = formatPost(back, getPlatform(id));
    ok(!out.includes('private-shot.png'), `${id} pasted a file name after persist`);
    ok(!out.includes('image/png'), `${id} pasted a mime type after persist`);
    ok(!out.includes('data:'), `${id} pasted encoded media after persist`);
    ok(!out.includes('iVBOR'), `${id} pasted image bytes after persist`);
    ok(!out.includes('desk at night'), `${id} pasted the gen prompt after persist`);
  }

  // Identical to the same post with the attachment stripped.
  const noMedia = { ...back, media: [], genPrompt: '' };
  for (const id of ['x', 'instagram', 'youtube']) {
    eq(
      formatPost(back, getPlatform(id)),
      formatPost(noMedia, getPlatform(id)),
      `${id} copy changed because media was attached`
    );
  }
});

t('a blob url is dropped on persist, and the copy stays text only either way', () => {
  const s = loadState();
  const p = getActive(s);
  p.hook = 'Most posts fail before the second line.';
  p.body = '';
  p.cta = '';
  p.hashtags = [];
  p.media = [{ name: 'pasted.png', type: 'image/png', url: 'blob:https://localhost:7744/9f8e-4c2a' }];

  // Before persist: the blob is on the post, and copy already ignores it.
  eq(formatPost(p, getPlatform('x')), 'Most posts fail before the second line.', 'copy ignores a live blob');

  saveState(s);
  ok(!/blob:/.test(mem.get(KEY)), 'no blob url is written to storage');

  const back = getActive(loadState());
  eq(back.media.length, 0, 'blob media is not restored');
  eq(formatPost(back, getPlatform('x')), 'Most posts fail before the second line.', 'copy unchanged after reload');
});

t('data:video does not persist; a project-relative video path does', () => {
  eq(store.mediaPersists({ type: 'video/webm', url: 'data:video/webm;base64,xx' }), false, 'no data:video');
  eq(store.mediaPersists({
    type: 'video/webm',
    path: '/Users/me/clip.webm',
    url: '/image?path=/Users/me/clip.webm'
  }), false, 'no home path');
  eq(store.mediaPersists({
    type: 'video/webm',
    path: 'tests/tiny-link.webm',
    url: '/image?path=tests%2Ftiny-link.webm'
  }), true, 'relative path stays');
  eq(store.mediaPersists({
    type: 'video/webm',
    href: '/image?path=tests%2Ftiny-x.webm'
  }), true, 'href-only /image?path= stays');
  eq(store.mediaPersists({ type: 'image/png', url: 'data:image/png;base64,xx' }), true, 'small image still stays');
});

t('save keeps a video link as path+href, not a blob or data:video', () => {
  const s = loadState();
  const p = getActive(s);
  p.media = [{
    name: 'tiny-x.webm',
    type: 'video/webm',
    path: 'tests/tiny-x.webm',
    href: '/image?path=tests%2Ftiny-x.webm',
    url: 'blob:http://127.0.0.1:7744/dead',
    session: false
  }];
  saveState(s);
  const raw = JSON.parse(mem.get(KEY));
  const stored = ((raw.posts || [])[0] || {}).media || [];
  eq(stored.length, 1, 'one media kept');
  eq(stored[0].path, 'tests/tiny-x.webm', 'path kept');
  eq(stored[0].href, '/image?path=tests%2Ftiny-x.webm', 'href is /image?path=');
  eq(stored[0].url, '/image?path=tests%2Ftiny-x.webm', 'url rewritten off the blob');
  ok(!/^blob:/i.test(JSON.stringify(stored)), 'no blob in saved media');
  ok(!/^data:video/i.test(String(stored[0].url || '')), 'no data:video');
  const back = getActive(loadState());
  eq(back.media[0].path, 'tests/tiny-x.webm', 'reload path');
  eq(back.media[0].href, '/image?path=tests%2Ftiny-x.webm', 'reload href');
});

// --- outcome: clears on empty, never reaches the heuristic ----------------

// getPlatform is already imported above for the media/paste tests.
const { scorePost } = await import('../source/shared/score.js');

/** A post with enough copy that the score is stable and non-zero. */
function scorable(s) {
  const p = getActive(s);
  p.hook = 'Most posts fail before the second line.';
  p.body = 'The first line buys a second of attention and pays it back with something usable.';
  p.cta = 'What line would you cut first?';
  p.hashtags = ['craft'];
  p.audience = 'a creator staging a post';
  p.platform = 'x';
  return p;
}

t('setOutcome clears on every shape of empty note', () => {
  const s = loadState();
  const id = s.activeId;
  for (const empty of ['', '   ', '\t', '\n\n', null, undefined]) {
    store.setOutcome(s, id, 'a real note');
    ok(getActive(s).outcome, 'seeded a note first');
    eq(store.setOutcome(s, id, empty).outcome, null, `cleared by ${JSON.stringify(empty)}`);
    eq(getActive(s).outcome, null, 'cleared on the post too');
  }
});

t('clearing an outcome does not disturb the rest of the post', () => {
  const s = loadState();
  const p = scorable(s);
  store.setOutcome(s, s.activeId, 'flopped, 3 likes');
  store.setOutcome(s, s.activeId, '   ');
  eq(getActive(s).hook, p.hook, 'hook untouched');
  eq(getActive(s).status, 'draft', 'status untouched');
  eq(getActive(s).publishedAt, null, 'publishedAt untouched');
  eq(getActive(s).source, 'studio', 'source untouched');
});

t('a cleared outcome stays cleared across save and load', () => {
  const s = loadState();
  store.setOutcome(s, s.activeId, 'went viral');
  store.setOutcome(s, s.activeId, '');
  saveState(s);
  eq(getActive(loadState()).outcome, null, 'still null after reload');
});

t('setOutcome does not change the heuristic score, band or checks', () => {
  // The record of what happened must never feed the thing that predicts it —
  // otherwise the heuristic starts grading its own homework.
  const s = loadState();
  const p = scorable(s);
  const platform = getPlatform('x');
  const before = scorePost(p, platform);

  store.setOutcome(s, s.activeId, 'flopped, 3 likes, no clicks');
  const afterSet = scorePost(getActive(s), platform);
  eq(afterSet.score, before.score, 'score unchanged by recording an outcome');
  eq(afterSet.band, before.band, 'band unchanged');
  eq(afterSet.checks, before.checks, 'every check unchanged');

  store.setOutcome(s, s.activeId, '');
  const afterClear = scorePost(getActive(s), platform);
  eq(afterClear.score, before.score, 'score unchanged by clearing it');
  eq(afterClear.band, before.band, 'band unchanged by clearing it');
  eq(afterClear.checks, before.checks, 'checks unchanged by clearing it');
});

t('a glowing outcome cannot lift a thin post', () => {
  // The direction that would matter most if the wall ever broke.
  const s = loadState();
  const p = getActive(s);
  p.hook = 'Hi';
  p.body = '';
  p.cta = 'Click here';
  p.hashtags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  p.platform = 'instagram';
  const platform = getPlatform('instagram');
  const before = scorePost(p, platform);

  store.setOutcome(s, s.activeId, 'best performing post of the year, 40k saves');
  const after = scorePost(getActive(s), platform);
  eq(after.score, before.score, 'still scores the same');
  eq(after.band, before.band, 'still the same band');
  ok(after.band === 'thin' || after.band === 'draft', 'and still not ready');
});

t('the scorer never reads an outcome field', () => {
  const s = loadState();
  const p = scorable(s);
  const platform = getPlatform('x');
  const clean = scorePost(p, platform);

  // Same copy, an outcome bolted straight onto the object the scorer receives.
  const withOutcome = { ...p, outcome: { note: 'went viral', recordedAt: new Date().toISOString() } };
  const scored = scorePost(withOutcome, platform);
  eq(scored.score, clean.score, 'score identical');
  eq(scored.checks, clean.checks, 'checks identical');
  ok(!('outcome' in clean), 'scorePost does not echo outcome in its result');
  ok(!clean.checks.some((c) => /outcome/i.test(c.id)), 'no outcome-derived check exists');
});

t('the scorer never reads lastPaste', () => {
  const s = loadState();
  const p = scorable(s);
  const platform = getPlatform('x');
  const clean = scorePost(p, platform);
  store.setLastPaste(s, s.activeId, { text: 'viral paste 1/1', platformId: 'x', partIndex: 0 });
  const after = scorePost(getActive(s), platform);
  eq(after.score, clean.score, 'score identical');
  eq(after.checks, clean.checks, 'checks identical');
  ok(!('lastPaste' in clean), 'scorePost does not echo lastPaste');
  ok(!clean.checks.some((c) => /paste|reach|impress/i.test(c.id + c.note)), 'no paste metrics in checks');
});

// --- quota honesty ----------------------------------------------------------
// A `QuotaExceededError` from localStorage.setItem must never look like a
// successful save. saveState must not throw it, and must not pretend the
// write happened.

t('saveState returns true and clears saveError on an ordinary save', () => {
  const s = loadState();
  const ok1 = saveState(s);
  ok(ok1 === true, 'saveState returns true on success');
  ok(s.saveError === null, 'saveError is null after a successful save');
});

t('a QuotaExceededError does not throw out of saveState', () => {
  const s = loadState();
  throwOnSet = quotaException();
  let threw = false;
  let result;
  try {
    result = saveState(s);
  } catch {
    threw = true;
  }
  ok(!threw, 'saveState must not throw a quota error out to the caller');
  ok(result === false, 'saveState returns false when the write did not happen');
});

t('a QuotaExceededError sets state.saveError to "quota", not a lie', () => {
  const s = loadState();
  throwOnSet = quotaException();
  saveState(s);
  eq(s.saveError, 'quota', 'saveError names the failure');
});

t('the previously-saved data is not overwritten by a failed save', () => {
  const s = loadState();
  const p = getActive(s);
  p.hook = 'first hook, actually saved';
  saveState(s);
  const savedRaw = mem.get(KEY);

  p.hook = 'second hook, never saved';
  throwOnSet = quotaException();
  saveState(s);

  eq(mem.get(KEY), savedRaw, 'storage still holds the last real save, not a partial or newer write');
  ok(!mem.get(KEY).includes('never saved'), 'the failed write did not sneak into storage some other way');
});

t('a non-quota error still throws — only quota is softened', () => {
  const s = loadState();
  throwOnSet = new Error('disk full, not a quota error');
  throwOnSet.name = 'SomeOtherError';
  let threw = false;
  try {
    saveState(s);
  } catch {
    threw = true;
  }
  ok(threw, 'a non-quota storage error still propagates — this is not a blanket try/catch');
});

t('saveState recognizes the legacy code === 22 quota shape too', () => {
  const s = loadState();
  const err = new Error('QUOTA_EXCEEDED_ERR');
  err.code = 22;
  throwOnSet = err;
  const result = saveState(s);
  ok(result === false, 'code 22 is treated as a quota error');
  eq(s.saveError, 'quota', 'saveError is set for the legacy shape too');
});

t('saveError clears on the next successful save after a quota failure', () => {
  const s = loadState();
  throwOnSet = quotaException();
  saveState(s);
  eq(s.saveError, 'quota', 'set after the failure');

  throwOnSet = null;
  saveState(s);
  eq(s.saveError, null, 'cleared after the next real save succeeds');
});

console.log(failed ? `\n${failed} FAILED` : '\nall store tests pass');
process.exit(failed ? 1 : 0);
