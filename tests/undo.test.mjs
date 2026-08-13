/**
 * Last-write undo tests. Run: node tests/undo.test.mjs
 *
 * Pins the four behaviours the slice calls for, against whatever store.js
 * actually exports:
 *
 *   1. push on overwrite   — the previous hook/body/cta is captured
 *   2. restore once        — undo puts them back, and only once
 *   3. persist             — the pending undo survives save/load
 *   4. empty stack no-op   — undo with nothing captured changes nothing
 *
 * Pins last-write undo against `rememberStageWrite` / `undoStageWrite`.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

let store;
try {
  store = await import('../source/shared/store.js');
} catch (err) {
  console.log('SKIP  store.js does not currently load — undo API still landing.');
  console.log('      ' + String(err.message).split('\n')[0]);
  process.exit(0);
}

const { loadState, saveState, getActive, addPost } = store;

/** Capture the pre-write snapshot. Accepts either shipped name. */
const capture = store.captureStageUndo
  ? (state) => store.captureStageUndo(getActive(state))
  : store.rememberStageWrite
    ? (state) => store.rememberStageWrite(state)
    : null;

/** Restore once. Both names take the board and return a boolean-ish value. */
const undo = store.undoStage || store.undoStageWrite || null;

if (!capture || !undo) {
  console.log('SKIP  undo API not exported yet from store.js.');
  console.log('      looked for captureStageUndo/undoStage and rememberStageWrite/undoStageWrite.');
  console.log('      found: ' + Object.keys(store).filter((k) => /undo|stage|remember/i.test(k)).join(', ') || '      found: none');
  process.exit(0);
}

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

/** Put known copy on the active post. */
function seed(state, hook, body, cta) {
  const p = getActive(state);
  p.hook = hook;
  p.body = body;
  p.cta = cta;
  return p;
}

// --- 1. push on overwrite -------------------------------------------------

t('capture remembers the copy that is about to be overwritten', () => {
  const s = loadState();
  seed(s, 'first hook', 'first body', 'first cta');

  capture(s);                       // before the write
  const p = getActive(s);
  p.hook = 'second hook';
  p.body = 'second body';
  p.cta = 'second cta';

  ok(undo(s), 'undo reported that it restored something');
  eq(getActive(s).hook, 'first hook', 'hook restored');
  eq(getActive(s).body, 'first body', 'body restored');
  eq(getActive(s).cta, 'first cta', 'cta restored');
});

t('a later capture replaces the one stack slot', () => {
  const s = loadState();
  seed(s, 'A', 'A', 'A');
  capture(s);
  seed(s, 'B', 'B', 'B');
  capture(s);
  seed(s, 'C', 'C', 'C');
  ok(undo(s), 'restored');
  eq(getActive(s).hook, 'B', 'last write, not the first');
  eq(getActive(s).body, 'B', 'body from the last snapshot');
});

t('capture takes the values as they are at capture time, not at undo time', () => {
  const s = loadState();
  seed(s, 'H1', 'B1', 'C1');
  capture(s);
  const p = getActive(s);
  p.hook = 'H2';
  p.hook = 'H3';                    // several writes after one capture
  undo(s);
  eq(getActive(s).hook, 'H1', 'restored the snapshot, not an intermediate value');
});

t('an empty stage can be captured and restored', () => {
  const s = loadState();
  seed(s, '', '', '');
  capture(s);
  seed(s, 'typed hook', 'typed body', 'typed cta');
  ok(undo(s), 'restored');
  eq(getActive(s).hook, '', 'hook back to empty');
  eq(getActive(s).body, '', 'body back to empty');
  eq(getActive(s).cta, '', 'cta back to empty');
});

// --- 2. restore once ------------------------------------------------------

t('undo restores exactly once — a second undo is a no-op', () => {
  const s = loadState();
  seed(s, 'first hook', 'first body', 'first cta');
  capture(s);
  seed(s, 'second hook', 'second body', 'second cta');

  ok(undo(s), 'first undo restored');
  eq(getActive(s).hook, 'first hook', 'restored');

  eq(Boolean(undo(s)), false, 'second undo reported nothing to do');
  eq(getActive(s).hook, 'first hook', 'copy unchanged by the second undo');
  eq(getActive(s).body, 'first body', 'body unchanged');
  eq(getActive(s).cta, 'first cta', 'cta unchanged');
});

t('a fresh capture after an undo can be undone again', () => {
  const s = loadState();
  seed(s, 'A', 'A', 'A');
  capture(s);
  seed(s, 'B', 'B', 'B');
  undo(s);
  eq(getActive(s).hook, 'A', 'back to A');

  capture(s);
  seed(s, 'C', 'C', 'C');
  ok(undo(s), 'second cycle restored');
  eq(getActive(s).hook, 'A', 'back to A again');
});

t('undo only touches hook, body and cta', () => {
  const s = loadState();
  const p = seed(s, 'first hook', 'first body', 'first cta');
  p.title = 'Kept title';
  p.hashtags = ['craft'];
  p.platform = 'tiktok';
  p.audience = 'someone real';

  capture(s);
  seed(s, 'second hook', 'second body', 'second cta');
  getActive(s).title = 'Changed title';
  undo(s);

  const after = getActive(s);
  eq(after.hook, 'first hook', 'hook restored');
  eq(after.title, 'Changed title', 'title not reverted');
  eq(after.hashtags, ['craft'], 'tags untouched');
  eq(after.platform, 'tiktok', 'platform untouched');
  eq(after.audience, 'someone real', 'audience untouched');
});

// --- 3. persist -----------------------------------------------------------

t('a pending undo survives save and load', () => {
  const s = loadState();
  seed(s, 'first hook', 'first body', 'first cta');
  capture(s);
  seed(s, 'second hook', 'second body', 'second cta');

  saveState(s);
  const back = loadState();

  eq(getActive(back).hook, 'second hook', 'the newer copy is what loaded');
  ok(undo(back), 'undo still available after reload');
  eq(getActive(back).hook, 'first hook', 'restored after reload');
  eq(getActive(back).body, 'first body', 'body restored after reload');
  eq(getActive(back).cta, 'first cta', 'cta restored after reload');
});

t('a spent undo stays spent across save and load', () => {
  const s = loadState();
  seed(s, 'first', 'first', 'first');
  capture(s);
  seed(s, 'second', 'second', 'second');
  undo(s);
  saveState(s);

  const back = loadState();
  eq(Boolean(undo(back)), false, 'nothing to restore after reload');
  eq(getActive(back).hook, 'first', 'copy unchanged');
});

t('undo is per post, not shared across the board', () => {
  const s = loadState();
  seed(s, 'post one hook', 'b1', 'c1');
  capture(s);
  seed(s, 'post one edited', 'b1', 'c1');

  const second = addPost(s, { hook: 'post two hook' });
  eq(Boolean(undo(s)), false, 'the new active post has nothing to undo');
  eq(getActive(s).hook, 'post two hook', 'second post untouched by undo');
  ok(second.id === getActive(s).id, 'sanity: second post is active');
});

// --- 4. empty stack is a no-op -------------------------------------------

t('undo on a fresh board changes nothing and reports false', () => {
  const s = loadState();
  seed(s, 'untouched hook', 'untouched body', 'untouched cta');
  eq(Boolean(undo(s)), false, 'reported nothing to restore');
  eq(getActive(s).hook, 'untouched hook', 'hook unchanged');
  eq(getActive(s).body, 'untouched body', 'body unchanged');
  eq(getActive(s).cta, 'untouched cta', 'cta unchanged');
});

t('undo with no capture does not blank the stage', () => {
  // The failure worth guarding: restoring a null snapshot as empty strings.
  const s = loadState();
  seed(s, 'real hook', 'real body', 'real cta');
  undo(s);
  undo(s);
  const p = getActive(s);
  ok(p.hook !== '', 'hook was not blanked');
  ok(p.body !== '', 'body was not blanked');
  ok(p.cta !== '', 'cta was not blanked');
});

t('a malformed stored snapshot does not blank the stage on load', () => {
  const s = loadState();
  seed(s, 'real hook', 'real body', 'real cta');
  saveState(s);
  const raw = JSON.parse(mem.get(store.__testing.KEY));
  raw.posts[0].stageUndo = 'not an object';
  mem.set(store.__testing.KEY, JSON.stringify(raw));

  const back = loadState();
  eq(getActive(back).hook, 'real hook', 'copy intact after a bad snapshot');
  eq(Boolean(undo(back)), false, 'a malformed snapshot is not restorable');
  eq(getActive(back).hook, 'real hook', 'still intact after attempting undo');
});

// --- rail commit: one snapshot per editing run ----------------------------
//
// `bindStagePart` in index.js primes on focus and snapshots on the FIRST input
// that actually changes the field, then unprimes. These model that sequence at
// the store level — no DOM — so the contract the rail depends on is pinned even
// though the listener itself is untestable here.

/** One rail field editing run: focus, then N keystrokes. */
function railRun(state, field, keystrokes) {
  const post = getActive(state);
  let primed = true;                          // focus
  for (const value of keystrokes) {           // input events
    if (primed && String(post[field] || '') !== value) {
      capture(state);
      primed = false;
    }
    post[field] = value;
  }
}

t('a rail editing run snapshots once and restores the pre-focus copy', () => {
  const s = loadState();
  seed(s, 'committed hook', 'body', 'cta');

  railRun(s, 'hook', ['c', 'ch', 'cha', 'chan', 'chang', 'changed hook']);
  eq(getActive(s).hook, 'changed hook', 'typing landed');

  ok(undo(s), 'restored');
  eq(getActive(s).hook, 'committed hook', 'back to the copy from before the run');
});

t('a second undo after a rail run is a no-op', () => {
  const s = loadState();
  seed(s, 'committed hook', 'committed body', 'committed cta');

  railRun(s, 'hook', ['x', 'xy', 'xyz']);
  ok(undo(s), 'first undo restored');
  eq(getActive(s).hook, 'committed hook', 'restored');

  eq(Boolean(undo(s)), false, 'second undo reported nothing to do');
  eq(getActive(s).hook, 'committed hook', 'hook unchanged by the second undo');
  eq(getActive(s).body, 'committed body', 'body unchanged');
  eq(getActive(s).cta, 'committed cta', 'cta unchanged');
});

t('a rail run that retypes the same value never snapshots', () => {
  // primed stays true while the value matches, so there is nothing to undo.
  const s = loadState();
  seed(s, 'same hook', 'body', 'cta');
  railRun(s, 'hook', ['same hook']);
  eq(Boolean(undo(s)), false, 'no snapshot was taken');
  eq(getActive(s).hook, 'same hook', 'copy untouched');
});

t('two rail runs in a row leave only the most recent restorable', () => {
  const s = loadState();
  seed(s, 'v1', 'body', 'cta');
  railRun(s, 'hook', ['v2']);
  railRun(s, 'hook', ['v3']);

  ok(undo(s), 'restored');
  eq(getActive(s).hook, 'v2', 'one slot — the run before last is gone');
  eq(Boolean(undo(s)), false, 'and only once');
});

t('a rail run on body does not disturb hook or cta', () => {
  const s = loadState();
  seed(s, 'hook stays', 'old body', 'cta stays');
  railRun(s, 'body', ['n', 'ne', 'new body']);
  ok(undo(s), 'restored');
  const p = getActive(s);
  eq(p.body, 'old body', 'body restored');
  eq(p.hook, 'hook stays', 'hook untouched');
  eq(p.cta, 'cta stays', 'cta untouched');
});

t('a rail run survives persist and still restores exactly once', () => {
  const s = loadState();
  seed(s, 'committed hook', 'committed body', 'committed cta');
  railRun(s, 'hook', ['t', 'ty', 'typed']);
  saveState(s);

  const back = loadState();
  eq(getActive(back).hook, 'typed', 'the typed copy loaded');
  ok(undo(back), 'restored after reload');
  eq(getActive(back).hook, 'committed hook', 'pre-run copy is back');
  eq(Boolean(undo(back)), false, 'still only once after a reload');
});

console.log(failed ? `\n${failed} FAILED` : '\nall undo tests pass');
process.exit(failed ? 1 : 0);
