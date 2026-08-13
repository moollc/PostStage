/**
 * Copy-live tests. Run: node tests/copy-live.test.mjs
 *
 * Copy link puts the **published URL** on the clipboard — the href of the live
 * post — not `lastPaste`, which is the draft text that went out. Two different
 * strings, two different buttons, and confusing them would hand someone the
 * post body when they meant to share the link.
 *
 * Contract:
 *   - the copied string is `publishedUrl`
 *   - a junk URL never becomes copyable
 *   - the control is disabled when there is no URL
 *   - the scorer is not read
 *
 * `index.js` is a browser module, so the copy handler is asserted from source
 * and the store rules it depends on are executed for real. No launcher spawned.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { normalizePublishedUrl, W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_SRC = readFileSync(resolve(here, '../source/app/index.js'), 'utf8');
const SCORE_SRC = readFileSync(resolve(here, '../source/shared/score.js'), 'utf8');

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};
const store = await import('../source/shared/store.js');
const { loadState, saveState, getActive, setPublishedUrl } = store;

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

/** The bindCopyLink handler body, as written. */
function copyLinkSrc() {
  const start = INDEX_SRC.indexOf('function bindCopyLink(');
  if (start < 0) throw new Error('bindCopyLink not found');
  return INDEX_SRC.slice(start, INDEX_SRC.indexOf('\n}\n', start) + 3);
}

// --- the copied string is the href, not the paste ------------------------

t('copy link writes publishedUrl to the clipboard', () => {
  const body = copyLinkSrc();
  ok(/copyLiveText\(getActive\(state\)\.publishedUrl\)/.test(body), 'gates publishedUrl through copyLiveText');
  ok(/writeText\(href\)/.test(body), 'writes that href');
});

t('copy link never writes lastPaste or the formatted post', () => {
  const body = copyLinkSrc();
  ok(!/lastPaste/.test(body), 'reads lastPaste');
  ok(!/formatLiveCopy|formatPost|formatThread/.test(body), 'formats the post instead');
  ok(!/\.hook|\.body\b|\.cta/.test(body), 'reads draft fields');
});

t('the two copy paths are genuinely different code', () => {
  // bindLiveCopy copies the paste; bindCopyLink copies the href. If one ever
  // delegated to the other, this slice's whole distinction would collapse.
  const live = INDEX_SRC.slice(INDEX_SRC.indexOf('function bindLiveCopy('));
  const liveBody = live.slice(0, live.indexOf('\n}\n') + 3);
  ok(/formatLiveCopy/.test(liveBody), 'bindLiveCopy copies the paste');
  ok(!/publishedUrl/.test(liveBody), 'bindLiveCopy must not copy the href');
  ok(!/bindLiveCopy/.test(copyLinkSrc()), 'bindCopyLink delegates to the paste path');
});

// --- junk never becomes a copyable string --------------------------------

t('a junk URL is never stored, so it can never be copied', () => {
  const s = loadState();
  const id = s.activeId;
  for (const junk of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///Users/me/x.html',
    '/Users/me/Pictures/post.png',
    'https://evil.test/a/status/1',
    'https://x.com/notastatus',
    'https://x.com/a/status/abc',
    'not a url',
    ''
  ]) {
    setPublishedUrl(s, id, junk);
    eq(getActive(s).publishedUrl, null, `${JSON.stringify(junk)} stored`);
  }
});

t('a real status link is stored normalized and is what gets copied', () => {
  const s = loadState();
  setPublishedUrl(s, s.activeId, W1_PUBLISHED_URL);
  eq(getActive(s).publishedUrl, W1_PUBLISHED_URL, 'stored as given');
  eq(getActive(s).publishedUrl, normalizePublishedUrl(W1_PUBLISHED_URL), 'already canonical');
});

t('a messy but real link is cleaned before it can be copied', () => {
  const s = loadState();
  setPublishedUrl(s, s.activeId, 'https://www.twitter.com/Jayson_X/status/2087952991638716610?s=20');
  eq(getActive(s).publishedUrl, W1_PUBLISHED_URL, 'normalized to the canonical x.com form');
  ok(!getActive(s).publishedUrl.includes('?s='), 'query stripped');
});

t('the copied href carries no home path, ever', () => {
  const s = loadState();
  for (const sneaky of [
    'https://x.com/a/status/1?ref=/Users/me',
    '/Users/me/status/1',
    'https://x.com/Users/status/1'
  ]) {
    setPublishedUrl(s, s.activeId, sneaky);
    const stored = getActive(s).publishedUrl;
    ok(stored === null || !/\/Users\//.test(stored), `${sneaky} → ${stored}`);
  }
});

// --- the control is off when there is nothing to copy --------------------

t('the button is disabled with no URL and enabled with one', () => {
  const paint = INDEX_SRC.slice(INDEX_SRC.indexOf('function paintCopyLink('));
  const body = paint.slice(0, paint.indexOf('\n}\n') + 3);
  ok(/canCopyLive\(getActive\(state\)\.publishedUrl\)/.test(body), 'gates on canCopyLive(publishedUrl)');
  ok(/disabled = !canCopyLive/.test(body), 'disabled when absent or junk');
});

t('clicking with no URL flashes rather than copying an empty string', () => {
  const body = copyLinkSrc();
  ok(/if \(!href\)/.test(body), 'guards on a missing href');
  const guard = body.slice(body.indexOf('if (!href)'), body.indexOf('try {'));
  ok(/flash\(/.test(guard) && /return/.test(guard), 'flashes and returns');
  ok(!/writeText/.test(guard), 'writes to the clipboard anyway');
});

t('clearing the URL makes it uncopyable again', () => {
  const s = loadState();
  setPublishedUrl(s, s.activeId, W1_PUBLISHED_URL);
  ok(getActive(s).publishedUrl, 'set');
  setPublishedUrl(s, s.activeId, '');
  eq(getActive(s).publishedUrl, null, 'cleared');
});

t('the URL survives save and load, so the link stays copyable', () => {
  const s = loadState();
  setPublishedUrl(s, s.activeId, W1_PUBLISHED_URL);
  saveState(s);
  eq(getActive(loadState()).publishedUrl, W1_PUBLISHED_URL, 'persisted');
});

// --- publishedUrl is not the local published toggle ----------------------

t('setting a URL does not mark the post published', () => {
  const s = loadState();
  setPublishedUrl(s, s.activeId, W1_PUBLISHED_URL);
  eq(getActive(s).status, 'draft', 'status untouched');
  eq(getActive(s).publishedAt, null, 'publishedAt untouched');
});

t('setting a URL does not touch lastPaste or outcome', () => {
  const s = loadState();
  const p = getActive(s);
  p.lastPaste = { text: 'the paste', platformId: 'x', partIndex: 0, at: null };
  p.outcome = { note: 'a note', recordedAt: null };
  setPublishedUrl(s, s.activeId, W1_PUBLISHED_URL);
  eq(getActive(s).lastPaste.text, 'the paste', 'paste kept');
  eq(getActive(s).outcome.note, 'a note', 'note kept');
});

// --- the scorer is unread -------------------------------------------------

t('a successful copy flashes saved, not a count', () => {
  const body = copyLinkSrc();
  ok(/flash\('Copied link', 'saved'\)/.test(body), 'flashes saved');
  ok(!/views|likes/.test(body), 'mentions a count');
});

t('the copy-link path does not read the scorer', () => {
  const body = copyLinkSrc();
  ok(!/scorePost|scored|\.band/.test(body), 'reads a score');
});

t('score.js knows nothing about publishedUrl', () => {
  ok(!/publishedUrl|copyLink|guestScan/.test(SCORE_SRC), 'scorer references the live URL');
});

console.log(failed ? `\n${failed} FAILED` : '\nall copy-live tests pass');
process.exit(failed ? 1 : 0);
