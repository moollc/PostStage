/**
 * Read-only outcome ledger tests. Run: node tests/ledger.test.mjs
 *
 * The three the brief names explicitly:
 *   - the scorer is not imported
 *   - a glowing note does not change the band
 *   - no rate fields anywhere
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { formatLedger, hasLedgerRows } from '../source/shared/ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const LEDGER_SRC = resolve(here, '../source/shared/ledger.js');

let failed = 0;
function t(name, fn) {
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

const post = (over = {}) => ({
  id: 'p1',
  title: 'A post',
  hook: 'Most posts fail before the second line.',
  lastPaste: { text: 'Most posts fail before the second line.', platformId: 'x', partIndex: 0, at: '2026-08-13T00:00:00.000Z' },
  outcome: { note: 'flopped, 3 likes', recordedAt: '2026-08-13T01:00:00.000Z' },
  ...over
});

// --- the scorer is never reached -----------------------------------------

t('ledger.js does not import the scorer', () => {
  const src = readFileSync(LEDGER_SRC, 'utf8');
  ok(!/from\s+['"].*score\.js['"]/.test(src), 'imports score.js');
  ok(!/scorePost|scorePostLive|scorePostMaybeWasm/.test(src), 'references a scorer function');
  ok(!/import\s*\(/.test(src), 'contains a dynamic import');
  // The only import-like text should be none at all — it is a pure module.
  ok(!/^import\s/m.test(src), 'has any import statement');
});

t('a band appears only when handed in, never computed', () => {
  const posts = [post()];
  eq(formatLedger(posts)[0].band, undefined, 'no band without scores');
  eq(formatLedger(posts, { p1: { band: 'ready' } })[0].band, 'ready', 'band from the map');
  eq(formatLedger(posts, new Map([['p1', { band: 'thin' }]]))[0].band, 'thin', 'Map works too');
  eq(formatLedger(posts, { p1: 'draft' })[0].band, 'draft', 'bare string works too');
});

t('an unknown or invented band is dropped, not passed through', () => {
  const posts = [post()];
  eq(formatLedger(posts, { p1: { band: 'viral' } })[0].band, undefined, 'invented band dropped');
  eq(formatLedger(posts, { p1: { band: 'A+' } })[0].band, undefined, 'grade dropped');
  eq(formatLedger(posts, { other: { band: 'ready' } })[0].band, undefined, 'wrong id ignored');
});

t('a glowing note does not change the band', () => {
  const scores = { p1: { band: 'thin' } };
  const dull = formatLedger([post({ outcome: { note: 'nothing', recordedAt: null } })], scores)[0];
  const glowing = formatLedger([post({ outcome: { note: 'best post of the year, 40k saves', recordedAt: null } })], scores)[0];
  eq(glowing.band, 'thin', 'still thin');
  eq(glowing.band, dull.band, 'band identical regardless of the note');
});

t('the ledger never mutates the posts it is given', () => {
  const p = post();
  const before = JSON.stringify(p);
  formatLedger([p], { p1: { band: 'ready' } });
  eq(JSON.stringify(p), before, 'post unchanged');
});

// --- no rates, counts or invented numbers --------------------------------

t('no row carries a rate, count or percentage field', () => {
  const rows = formatLedger([post(), post({ id: 'p2', title: 'Second' })], { p1: { band: 'ready' }, p2: { band: 'thin' } });
  const banned = /rate|percent|pct|avg|average|mean|total|count|score|reach|impress|likes|views|followers|engagement|ratio|trend|delta/i;
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      ok(!banned.test(key), `row carried field "${key}"`);
    }
  }
});

t('a row has only id, title and the fields that had content', () => {
  const full = formatLedger([post()], { p1: { band: 'ready' } })[0];
  eq(Object.keys(full).sort(), ['band', 'id', 'note', 'paste', 'title'], 'full row shape');
  const pasteOnly = formatLedger([post({ outcome: null })])[0];
  eq(Object.keys(pasteOnly).sort(), ['id', 'paste', 'title'], 'no empty note key');
  const noteOnly = formatLedger([post({ lastPaste: null })])[0];
  eq(Object.keys(noteOnly).sort(), ['id', 'note', 'title'], 'no empty paste key');
  const hrefOnly = formatLedger([post({
    lastPaste: null,
    outcome: null,
    publishedUrl: 'https://x.com/Jayson_X/status/2087952991638716610'
  })])[0];
  eq(Object.keys(hrefOnly).sort(), ['href', 'id', 'title'], 'url-only row');
  eq(hrefOnly.href, 'https://x.com/Jayson_X/status/2087952991638716610', 'href kept');
});

t('ledger.js source contains no arithmetic on row values', () => {
  const src = readFileSync(LEDGER_SRC, 'utf8');
  ok(!/\.length\s*\/|\/\s*\w+\.length|\*\s*100|toFixed|Math\.round|reduce\(/.test(src),
    'source performs a calculation that could become a rate');
});

// --- which posts are listed ----------------------------------------------

t('a post with a paste but no note is still listed', () => {
  // "shipped it, never followed up" is a finding, not a row to hide.
  const rows = formatLedger([post({ outcome: null })]);
  eq(rows.length, 1, 'listed');
  eq(rows[0].note, undefined, 'no note field');
  ok(rows[0].paste, 'paste present');
});

t('a post with a note but no paste is still listed', () => {
  const rows = formatLedger([post({ lastPaste: null })]);
  eq(rows.length, 1, 'listed');
  eq(rows[0].paste, undefined, 'no paste field');
});

t('a post with neither is omitted', () => {
  eq(formatLedger([post({ lastPaste: null, outcome: null })]).length, 0, 'omitted');
  eq(formatLedger([post({ lastPaste: { text: '   ' }, outcome: { note: '\n' } })]).length, 0, 'whitespace is empty');
});

t('a post with only a publishedUrl is listed', () => {
  const rows = formatLedger([post({
    lastPaste: null,
    outcome: null,
    publishedUrl: 'https://x.com/Jayson_X/status/2087952991638716610'
  })]);
  eq(rows.length, 1, 'listed');
  eq(rows[0].href, 'https://x.com/Jayson_X/status/2087952991638716610', 'href');
  eq(rows[0].paste, undefined, 'no paste');
  eq(rows[0].note, undefined, 'no note');
});

t('junk publishedUrl is not a ledger href', () => {
  eq(formatLedger([post({
    lastPaste: null,
    outcome: null,
    publishedUrl: 'javascript:alert(1)'
  })]).length, 0, 'javascript omitted');
  eq(formatLedger([post({
    lastPaste: null,
    outcome: null,
    publishedUrl: '/Users/me/clip'
  })]).length, 0, 'home path omitted');
});

t('rows keep board order', () => {
  const rows = formatLedger([
    post({ id: 'a', title: 'First' }),
    post({ id: 'b', title: 'Second' }),
    post({ id: 'c', title: 'Third' })
  ]);
  eq(rows.map((r) => r.id), ['a', 'b', 'c'], 'order preserved');
});

t('an untitled post gets a readable label, not an empty cell', () => {
  eq(formatLedger([post({ title: '' })])[0].title, 'Untitled post', 'fallback title');
  eq(formatLedger([post({ title: '   ' })])[0].title, 'Untitled post', 'whitespace title');
});

t('paste and note are collapsed to one line', () => {
  const row = formatLedger([post({
    lastPaste: { text: 'line one\n\nline two' },
    outcome: { note: 'a\tnote\nwrapped' }
  })])[0];
  eq(row.paste, 'line one line two', 'paste collapsed');
  eq(row.note, 'a note wrapped', 'note collapsed');
});

// --- shape safety ---------------------------------------------------------

t('junk input does not throw', () => {
  eq(formatLedger(null), [], 'null');
  eq(formatLedger(undefined), [], 'undefined');
  eq(formatLedger('not an array'), [], 'string');
  eq(formatLedger([null, undefined, 42, 'x']), [], 'junk entries skipped');
  eq(formatLedger([post()], 'not a map').length, 1, 'bad scoreById ignored');
});

t('hasLedgerRows agrees with formatLedger', () => {
  eq(hasLedgerRows([post()]), true, 'has rows');
  eq(hasLedgerRows([post({ lastPaste: null, outcome: null })]), false, 'no rows');
  eq(hasLedgerRows([]), false, 'empty board');
  eq(hasLedgerRows(null), false, 'junk');
});

console.log(failed ? `\n${failed} FAILED` : '\nall ledger tests pass');
process.exit(failed ? 1 : 0);
