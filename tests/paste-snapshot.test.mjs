/**
 * Paste snapshot + outcome tests. Run: node tests/paste-snapshot.test.mjs
 *
 * Contract under test:
 *   1. Copy remembers { text, platformId, partIndex, at }
 *   2. a later hook/body/cta edit does not change lastPaste
 *   3. setOutcome stays on the post and does not invent scores
 *   4. an empty note still clears outcome
 *
 * Halves 3 and 4 exist today and run. Halves 1 and 2 need a store helper that
 * is not in `store.js` yet — there is no `lastPaste` field on `blankPost`, no
 * repair in `normalize`, and no exported setter. The only record of a copy is
 * `copiedIds`, an in-memory Set in index.js that holds ids only: no text, no
 * platform, no part index, and it dies on reload.
 *
 * Rather than invent that API, the lastPaste block resolves whichever setter
 * ships and reports SKIP until one does. Behaviour is pinned; names are not.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

const store = await import('../source/shared/store.js');
const { loadState, saveState, getActive, setOutcome } = store;
const { scorePost } = await import('../source/shared/score.js');
const { getPlatform } = await import('../source/shared/platforms.js');

let failed = 0;
let passed = 0;
let skipped = 0;

function t(name, fn) {
  mem.clear();
  try {
    fn();
    passed++;
    console.log('ok    ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + name + '\n        ' + err.message);
  }
}
function skip(name, why) {
  skipped++;
  console.log('SKIP  ' + name + '\n        ' + why);
}
function eq(a, b, msg) {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || 'not equal'}: ${A} !== ${B}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

/** A post with enough copy for a stable, non-zero score. */
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

// --- 1 + 2. lastPaste ------------------------------------------------------

/**
 * Whichever paste-recording setter ships. The shipped `setLastPaste` takes
 * (state, id, snap); this wrapper hides the id so the tests below read as
 * "record a paste on the active post".
 */
const rawRecord = store.setLastPaste || store.rememberPaste || store.rememberLastPaste || null;
const recordPaste = rawRecord
  ? (state, snap) => rawRecord(state, state.activeId, snap)
  : null;

const PASTE_WHY =
  'no lastPaste setter exported from store.js — looked for rememberPaste, ' +
  'setLastPaste, rememberLastPaste. `blankPost` has no lastPaste field and ' +
  '`normalize` does not repair one; index.js only tracks copiedIds (ids, in memory).';

if (!recordPaste) {
  skip('Copy remembers { text, platformId, partIndex, at }', PASTE_WHY);
  skip('a later hook/body/cta edit does not change lastPaste', PASTE_WHY);
  skip('lastPaste survives save and load', PASTE_WHY);
  skip('a malformed stored lastPaste does not crash a load', PASTE_WHY);
} else {
  t('Copy remembers { text, platformId, partIndex, at }', () => {
    const s = loadState();
    const p = scorable(s);
    const text = 'Most posts fail before the second line.';
    recordPaste(s, { text, platformId: 'x', partIndex: 0 });

    const snap = getActive(s).lastPaste;
    ok(snap, 'a snapshot was written');
    eq(snap.text, text, 'text');
    eq(snap.platformId, 'x', 'platformId');
    eq(snap.partIndex, 0, 'partIndex');
    ok(snap.at, 'at is stamped');
    ok(!Number.isNaN(Date.parse(snap.at)), 'at is a real timestamp');
    ok(p.hook === 'Most posts fail before the second line.', 'the post itself is untouched');
  });

  t('a later hook/body/cta edit does not change lastPaste', () => {
    const s = loadState();
    scorable(s);
    const text = 'the exact string that was pasted';
    recordPaste(s, { text, platformId: 'x', partIndex: 2 });
    const before = JSON.stringify(getActive(s).lastPaste);

    const p = getActive(s);
    p.hook = 'a completely different hook';
    p.body = 'rewritten body';
    p.cta = 'new call';

    eq(JSON.stringify(getActive(s).lastPaste), before, 'snapshot is frozen');
    eq(getActive(s).lastPaste.text, text, 'still the pasted text, not the live copy');
    eq(getActive(s).lastPaste.partIndex, 2, 'partIndex unchanged');
  });

  t('lastPaste survives save and load', () => {
    const s = loadState();
    scorable(s);
    recordPaste(s, { text: 'pasted once', platformId: 'instagram', partIndex: 1 });
    const before = JSON.stringify(getActive(s).lastPaste);
    saveState(s);
    eq(JSON.stringify(getActive(loadState()).lastPaste), before, 'round-tripped intact');
  });

  t('a malformed stored lastPaste does not crash a load', () => {
    const s = loadState();
    scorable(s);
    saveState(s);
    const raw = JSON.parse(mem.get(store.__testing.KEY));
    raw.posts[0].lastPaste = 'not an object';
    mem.set(store.__testing.KEY, JSON.stringify(raw));

    const back = loadState();
    eq(getActive(back).hook, 'Most posts fail before the second line.', 'copy intact');
    const snap = getActive(back).lastPaste;
    ok(snap === null || typeof snap === 'object', 'repaired to null or an object');
  });
}

// --- 3. setOutcome stays on the post, invents no scores -------------------

t('setOutcome writes only to the post it names', () => {
  const s = loadState();
  const first = s.activeId;
  const second = store.addPost(s, { hook: 'second post' });

  setOutcome(s, first, 'flopped, 3 likes');
  eq(s.posts.find((p) => p.id === first).outcome.note, 'flopped, 3 likes', 'landed on the named post');
  eq(second.outcome, null, 'the other post is untouched');
});

t('setOutcome adds no score, band or metric field to the post', () => {
  const s = loadState();
  scorable(s);
  const keysBefore = Object.keys(getActive(s)).sort();

  setOutcome(s, s.activeId, 'best post of the year, 40k saves');

  const after = getActive(s);
  eq(Object.keys(after).sort(), keysBefore, 'no new keys appeared on the post');
  ok(!('score' in after), 'no score field');
  ok(!('band' in after), 'no band field');
  ok(!('reach' in after), 'no reach field');
  ok(!('impressions' in after), 'no impressions field');
  eq(Object.keys(after.outcome).sort(), ['note', 'recordedAt'], 'outcome carries only note and recordedAt');
});

t('setOutcome does not move the heuristic score, band or checks', () => {
  const s = loadState();
  const p = scorable(s);
  const platform = getPlatform('x');
  const before = scorePost(p, platform);

  setOutcome(s, s.activeId, 'went viral, 40k saves');
  const after = scorePost(getActive(s), platform);

  eq(after.score, before.score, 'score unchanged');
  eq(after.band, before.band, 'band unchanged');
  eq(after.checks, before.checks, 'every check unchanged');
});

t('a glowing outcome cannot lift a thin post', () => {
  const s = loadState();
  const p = getActive(s);
  p.hook = 'Hi';
  p.body = '';
  p.cta = 'Click here';
  p.hashtags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  p.platform = 'instagram';
  const platform = getPlatform('instagram');
  const before = scorePost(p, platform);

  setOutcome(s, s.activeId, 'best performing post of the year');
  const after = scorePost(getActive(s), platform);
  eq(after.score, before.score, 'same score');
  ok(after.band !== 'ready', 'still not ready');
});

t('setOutcome returns null for an unknown id and writes nothing', () => {
  const s = loadState();
  scorable(s);
  eq(setOutcome(s, 'nope', 'a note'), null, 'returns null');
  eq(getActive(s).outcome, null, 'no outcome was written anywhere');
});

// --- 4. an empty note still clears outcome --------------------------------

t('every shape of empty note clears the outcome', () => {
  const s = loadState();
  const id = s.activeId;
  for (const empty of ['', '   ', '\t', '\n\n', null, undefined]) {
    setOutcome(s, id, 'a real note');
    ok(getActive(s).outcome, 'seeded first');
    eq(setOutcome(s, id, empty).outcome, null, `cleared by ${JSON.stringify(empty)}`);
  }
});

t('clearing an outcome leaves the rest of the post alone', () => {
  const s = loadState();
  const p = scorable(s);
  setOutcome(s, s.activeId, 'flopped');
  setOutcome(s, s.activeId, '   ');

  const after = getActive(s);
  eq(after.hook, p.hook, 'hook untouched');
  eq(after.status, 'draft', 'status untouched');
  eq(after.publishedAt, null, 'publishedAt untouched');
  eq(after.source, 'studio', 'source untouched');
});

t('a cleared outcome stays cleared across save and load', () => {
  const s = loadState();
  setOutcome(s, s.activeId, 'went viral');
  setOutcome(s, s.activeId, '');
  saveState(s);
  eq(getActive(loadState()).outcome, null, 'still null after reload');
});

console.log('');
console.log(`passed ${passed}   failed ${failed}   skipped ${skipped}`);
console.log(failed ? `${failed} FAILED` : 'all runnable paste-snapshot tests pass');
process.exit(failed ? 1 : 0);
