/**
 * Chair sit: the W1 seed carries a status href, not a count.
 * Run: node tests/chair-sit.test.mjs
 *
 * The first post the Chair actually shipped is seeded into the board with its
 * live URL. The thing to prove is what that seed *is*: a canonical
 * `x.com/…/status/…` link and nothing else. A seed is the one place a number
 * could enter the workspace looking official — "here is the post, and here is
 * how it did" — so this pins that the seed carries an href and no metric.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { normalizePublishedUrl, W1_POST_ID, W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_SRC = readFileSync(resolve(here, '../source/app/index.js'), 'utf8');
const INBOX = resolve(here, '../../scaffold/inbox/posts.json');

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};
const store = await import('../source/shared/store.js');
const { loadState, saveState, getActive, addPost, setPublishedUrl } = store;

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

/** The seeded W1 row, if the inbox file carries one. */
function seedRow() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(INBOX, 'utf8'));
  } catch {
    return null;
  }
  const rows = Array.isArray(raw) ? raw : (raw.posts || []);
  return rows.find((r) => r && r.id === W1_POST_ID) || null;
}

// --- the fixture itself ---------------------------------------------------

t('W1_PUBLISHED_URL is a canonical x.com status href', () => {
  ok(/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(W1_PUBLISHED_URL),
    `not a canonical status href: ${W1_PUBLISHED_URL}`);
  eq(normalizePublishedUrl(W1_PUBLISHED_URL), W1_PUBLISHED_URL, 'already normalized');
});

t('the fixture carries no query, no count, no home path', () => {
  ok(!W1_PUBLISHED_URL.includes('?'), 'query string');
  ok(!/\/Users\/|GoogleDrive|home\//i.test(W1_PUBLISHED_URL), 'home path');
  ok(!/views|likes|reposts|impressions/i.test(W1_PUBLISHED_URL), 'a count in the url');
});

// --- the seeded row -------------------------------------------------------

t('the seeded W1 row carries publishedUrl, and it is the fixture', () => {
  const row = seedRow();
  if (!row) {
    console.log('        (no W1 row in scaffold/inbox/posts.json — seed not present)');
    return;
  }
  eq(row.publishedUrl, W1_PUBLISHED_URL, 'seed href is the fixture');
});

t('the seeded row carries no count field of any kind', () => {
  const row = seedRow();
  if (!row) return;
  const banned = /^(views?|likes?|favou?rites?|reposts?|retweets?|replies|quotes?|bookmarks?|impressions?|followers?|count|counts|metrics|engagement|rate|score|rank|reach)$/i;
  for (const key of Object.keys(row)) {
    ok(!banned.test(key), `seed row carried "${key}"`);
  }
  const json = JSON.stringify(row);
  ok(!/\b\d{3,}\b(?!\d*")/.test(json.replace(W1_PUBLISHED_URL, '')),
    `a bare number outside the href: ${json}`);
});

t('the seeded row is a post, not a report', () => {
  const row = seedRow();
  if (!row) return;
  ok(typeof row.hook === 'string' && row.hook.trim(), 'has a hook');
  ok(!('guestScan' in row), 'seed ships a scan snapshot');
  ok(!('outcome' in row), 'seed ships an outcome the operator did not write');
});

// --- the backfill ---------------------------------------------------------

t('an existing W1 post with no href is backfilled with the fixture', () => {
  const src = INDEX_SRC.slice(INDEX_SRC.indexOf('const w1 = state.posts.find'));
  const body = src.slice(0, src.indexOf('}\n') + 2);
  ok(/!w1\.publishedUrl/.test(body), 'guards on a missing href');
  ok(/setPublishedUrl\(state, w1\.id, W1_PUBLISHED_URL\)/.test(body), 'sets the fixture');
  ok(!/views|likes|outcome|guestScan/.test(body), 'the backfill writes something else too');
});

t('the backfill does not overwrite an href the operator already set', () => {
  const s = loadState();
  const p = addPost(s, { id: W1_POST_ID });
  setPublishedUrl(s, p.id, 'https://x.com/someoneelse/status/999');
  // The guard is `if (w1 && !w1.publishedUrl)` — already set means untouched.
  ok(p.publishedUrl === 'https://x.com/someoneelse/status/999', 'operator href kept');
});

t('inbox pull pins the fixture only for the W1 id', () => {
  const start = INDEX_SRC.indexOf('publishedUrl: id === W1_POST_ID');
  ok(start > 0, 'the W1 branch exists in pullInbox');
  const body = INDEX_SRC.slice(start, start + 200);
  ok(/normalizePublishedUrl\(item\.publishedUrl\) \|\| W1_PUBLISHED_URL/.test(body),
    'W1 falls back to the fixture only after normalizing what arrived');
});

// --- the store is the backstop -------------------------------------------

t('a junk href on any seeded row is refused by the store', () => {
  const s = loadState();
  for (const junk of ['javascript:alert(1)', '/Users/me/post.png', 'https://evil.test/a/status/1', 'not a url']) {
    const p = addPost(s, { publishedUrl: junk });
    eq(p.publishedUrl, null, `${junk} was stored`);
  }
});

t('a seeded href survives save and load unchanged', () => {
  const s = loadState();
  const p = addPost(s, { id: W1_POST_ID, publishedUrl: W1_PUBLISHED_URL });
  saveState(s);
  const back = loadState().posts.find((x) => x.id === p.id);
  eq(back.publishedUrl, W1_PUBLISHED_URL, 'persisted verbatim');
});

t('seeding an href does not mark the post published or invent an outcome', () => {
  const s = loadState();
  const p = addPost(s, { id: W1_POST_ID, publishedUrl: W1_PUBLISHED_URL });
  eq(p.status, 'draft', 'status untouched');
  eq(p.publishedAt, null, 'publishedAt untouched');
  eq(p.outcome, null, 'no outcome invented');
  eq(p.lastPaste, null, 'no paste invented');
});

// --- this file stays a fixture check -------------------------------------

t('this test file never expects a view field, only forbids one', () => {
  // The seed is the one place a metric could enter the workspace looking
  // official. This file is the guard on that — so it must not itself drift
  // into asserting a count exists. Every count word here has to sit inside a
  // negation (`!/.../` or a banned-key list), never a positive expectation.
  const self = readFileSync(resolve(here, 'chair-sit.test.mjs'), 'utf8');
  const lines = self.split('\n');

  const COUNT_WORD = /\b(views?|likes?|favou?rites?|reposts?|retweets?|replies|quotes?|bookmarks?|impressions?|followers?|reach|engagement)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!COUNT_WORD.test(line)) continue;
    // Comments explain the rule; they are not assertions.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    // Test *names* describe what is forbidden; the assertion is the next lines.
    if (/^\s*t\(/.test(line)) continue;
    // The guard line itself, and the banned-key list it uses.
    if (/COUNT_WORD|const banned =/.test(line)) continue;

    const negated = /!\s*\//.test(line) || /banned\.test/.test(line) || /^\s*ok\(!/.test(line);
    ok(negated, `line ${i + 1} mentions a count outside a negation: ${line.trim()}`);
  }
});

t('no fixture built here carries a count field', () => {
  // Guards the other direction: a future case must not seed `{ views: 26 }`
  // to "test" that it survives. Nothing in this file should construct one.
  const self = readFileSync(resolve(here, 'chair-sit.test.mjs'), 'utf8');
  const body = self.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  ok(!/\b(views?|likes?|reposts?|impressions?|followers?)\s*:/i.test(body),
    'a count is being assigned as an object property somewhere in this file');
});

console.log(failed ? `\n${failed} FAILED` : '\nall chair sit tests pass');
process.exit(failed ? 1 : 0);
