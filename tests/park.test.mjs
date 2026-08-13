/**
 * Park tests. Run: node tests/park.test.mjs
 *
 * US-P4: a post can be parked — hidden from the default board list — without
 * being deleted. The invariants that matter are the ones about *not losing
 * things*: content survives, the active post cannot vanish, and a board cannot
 * park itself into showing nothing.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

const store = await import('../source/shared/store.js');
const { loadState, saveState, getActive, setActive, addPost, setParked, visiblePosts, parkedCount, __testing } = store;
const { KEY } = __testing;

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

/** Board with three posts; returns their ids in order. */
function board() {
  const s = loadState();
  const a = s.activeId;
  const b = addPost(s, { title: 'B' }).id;
  const c = addPost(s, { title: 'C' }).id;
  setActive(s, a);
  return { s, a, b, c };
}

// --- default state --------------------------------------------------------

t('a new post is not parked', () => {
  const s = loadState();
  eq(getActive(s).parked, false, 'default false');
  eq(addPost(s).parked, false, 'addPost default false');
});

t('boards written before park read as unparked', () => {
  mem.set(KEY, JSON.stringify({ activeId: 'p1', posts: [{ id: 'p1', title: 'Old' }] }));
  eq(getActive(loadState()).parked, false, 'backfilled false');
});

t('only a literal true parks — a truthy value must not hide work', () => {
  for (const junk of ['yes', 1, {}, [], 'true']) {
    mem.clear();
    mem.set(KEY, JSON.stringify({ activeId: 'p1', posts: [{ id: 'p1', parked: junk }] }));
    eq(getActive(loadState()).parked, false, `${JSON.stringify(junk)} is not parked`);
  }
});

// --- park hides, does not delete -----------------------------------------

t('parking removes the row but keeps the post and its content', () => {
  const { s, a, b } = board();
  const post = s.posts.find((p) => p.id === b);
  post.hook = 'kept hook';
  post.outcome = { note: 'kept note', recordedAt: null };
  post.lastPaste = { text: 'kept paste', platformId: 'x', partIndex: 0, at: null };

  setParked(s, b, true);

  eq(s.posts.length, 3, 'nothing was removed from the board');
  eq(visiblePosts(s).map((p) => p.id), [a, s.posts[2].id], 'parked row is out of the list');
  const still = s.posts.find((p) => p.id === b);
  eq(still.hook, 'kept hook', 'hook kept');
  eq(still.outcome.note, 'kept note', 'note kept');
  eq(still.lastPaste.text, 'kept paste', 'paste kept');
});

t('unparking puts the row back', () => {
  const { s, b } = board();
  setParked(s, b, true);
  ok(!visiblePosts(s).some((p) => p.id === b), 'hidden');
  setParked(s, b, false);
  ok(visiblePosts(s).some((p) => p.id === b), 'back in the list');
});

t('parked survives save and load', () => {
  const { s, b } = board();
  setParked(s, b, true);
  saveState(s);
  const back = loadState();
  eq(back.posts.find((p) => p.id === b).parked, true, 'still parked');
  eq(back.posts.length, 3, 'all three persisted');
});

// --- the active post cannot vanish ---------------------------------------

t('parking the active post moves the board to a neighbour first', () => {
  const { s, a } = board();
  eq(s.activeId, a, 'a is active');
  setParked(s, a, true);
  ok(s.activeId !== a, 'active moved off the parked post');
  ok(visiblePosts(s).some((p) => p.id === s.activeId), 'the new active post is visible');
  eq(s.posts.find((p) => p.id === a).parked, true, 'a really did park');
});

t('the board never moves to another parked post', () => {
  const { s, a, b } = board();
  setParked(s, b, true);
  setParked(s, a, true);
  eq(s.posts.find((p) => p.id === s.activeId).parked, false, 'landed on an unparked post');
});

t('the last unparked post refuses to park rather than blank the canvas', () => {
  const { s, a, b, c } = board();
  setParked(s, b, true);
  setParked(s, c, true);
  eq(s.activeId, a, 'a is the only one left');
  eq(setParked(s, a, true), false, 'refusal is visible in the return value');
  eq(s.posts.find((p) => p.id === a).parked, false, 'refused to park the last one');
  eq(s.activeId, a, 'still active');
  eq(visiblePosts(s).length, 1, 'the list is never empty');
});

t('a single-post board cannot park itself away', () => {
  const s = loadState();
  const only = s.activeId;
  eq(setParked(s, only, true), false, 'refused, and says so');
  eq(getActive(s).parked, false, 'not parked');
  eq(visiblePosts(s).length, 1, 'still one visible row');
});

t('refusal is distinguishable from success and from an unknown id', () => {
  // false = declined, null = no such post, post = done. A caller must be able
  // to tell the three apart without re-reading the board.
  const s = loadState();
  const only = s.activeId;
  eq(setParked(s, only, true), false, 'declined');
  eq(setParked(s, 'nope', true), null, 'unknown id');
  const second = addPost(s, { title: 'Second' }).id;
  setActive(s, only);
  const done = setParked(s, only, true);
  ok(done && done.id === only, 'success returns the post');
  eq(done.parked, true, 'and it really parked');
  ok(second, 'sanity');
});

t('selecting a parked post keeps it visible while it is active', () => {
  const { s, a, b } = board();
  setParked(s, b, true);
  setActive(s, b);
  ok(visiblePosts(s).some((p) => p.id === b), 'active parked post shows a row');
  eq(getActive(s).id, b, 'and it is the active one');
  setActive(s, a);
  ok(!visiblePosts(s).some((p) => p.id === b), 'hidden again once it is not active');
});

// --- counting and shape safety -------------------------------------------

t('parkedCount reports hidden posts only', () => {
  const { s, b, c } = board();
  eq(parkedCount(s), 0, 'none yet');
  setParked(s, b, true);
  eq(parkedCount(s), 1, 'one');
  setParked(s, c, true);
  eq(parkedCount(s), 2, 'two');
  setActive(s, b);
  eq(parkedCount(s), 1, 'the active parked post is not counted as hidden');
});

t('setParked returns null for an unknown id and changes nothing', () => {
  const { s } = board();
  const before = JSON.stringify(s.posts);
  eq(setParked(s, 'nope', true), null, 'null');
  eq(JSON.stringify(s.posts), before, 'board untouched');
});

t('setParked(false) on an already-unparked post is a no-op', () => {
  const { s, b } = board();
  const before = JSON.stringify(s.posts);
  setParked(s, b, false);
  eq(JSON.stringify(s.posts), before, 'unchanged');
});

t('visiblePosts and parkedCount are safe on junk', () => {
  eq(visiblePosts(null), [], 'null state');
  eq(visiblePosts({}), [], 'no posts array');
  eq(parkedCount(null), 0, 'null state');
  eq(parkedCount({}), 0, 'no posts array');
});

t('park never touches outcome, paste, status, source or publishedUrl', () => {
  const { s, b } = board();
  const post = s.posts.find((p) => p.id === b);
  post.status = 'published';
  post.publishedAt = '2026-08-13T00:00:00.000Z';
  post.source = 'banter';
  post.publishedUrl = 'https://x.com/Jayson_X/status/2087952991638716610';
  setParked(s, b, true);
  const after = s.posts.find((p) => p.id === b);
  eq(after.status, 'published', 'status');
  eq(after.publishedAt, '2026-08-13T00:00:00.000Z', 'publishedAt');
  eq(after.source, 'banter', 'source');
  eq(after.publishedUrl, 'https://x.com/Jayson_X/status/2087952991638716610', 'publishedUrl');
});

console.log(failed ? `\n${failed} FAILED` : '\nall park tests pass');
process.exit(failed ? 1 : 0);
