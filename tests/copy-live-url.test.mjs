/**
 * copy-live-url.js — the gate before publishedUrl reaches the clipboard.
 * Run: node tests/copy-live-url.test.mjs
 *
 * Written before any UI wiring for a "copy the published URL" action
 * existed — the rail has a `#f-published-url` text input and a `#btn-guest-
 * scan` button, but no copy-to-clipboard control for the URL specifically.
 * This pins the safety contract so whichever button lands next has a
 * known-correct gate to call rather than reinventing the check inline.
 */

import { copyLiveText, canCopyLive } from '../source/shared/copy-live-url.js';
import { W1_PUBLISHED_URL } from '../source/shared/published-url.js';

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
  if (a !== b) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

// --- accepted -----------------------------------------------------------

t('a clean, already-normalized status href copies as-is', () => {
  const u = 'https://x.com/jayson_x/status/42';
  eq(copyLiveText(u), u);
  ok(canCopyLive(u));
});

t('the real W1 fixture copies as-is', () => {
  eq(copyLiveText(W1_PUBLISHED_URL), W1_PUBLISHED_URL);
});

// --- must already be clean — never silently rewritten then copied --------

t('a URL that would be rewritten by normalization does not copy', () => {
  ok(!canCopyLive('https://www.x.com/jayson_x/status/42'), 'www. would be stripped');
  ok(!canCopyLive('https://x.com/jayson_x/status/42/'), 'trailing slash would be stripped');
  ok(!canCopyLive('http://x.com/jayson_x/status/42'), 'http would be upgraded to https');
  eq(copyLiveText('https://www.x.com/jayson_x/status/42'), null, 'returns null, does not copy the rewritten form silently');
});

t('twitter.com does not copy — it normalizes to x.com, so it is not clean as stored', () => {
  eq(copyLiveText('https://twitter.com/jayson_x/status/42'), null);
});

// --- no counts, no junk in the query --------------------------------------

t('a query string carrying view/like counts does not copy', () => {
  eq(copyLiveText('https://x.com/jayson_x/status/42?views=999999&likes=1000'), null, 'query present at all is enough to refuse — nothing here strips it and copies the rest');
});

t('a URL with any query string at all does not copy, junk or not', () => {
  eq(copyLiveText('https://x.com/jayson_x/status/42?s=20'), null, 'even benign-looking share params refuse copy rather than being silently dropped');
});

// --- explicit rejections ---------------------------------------------------

t('a home path never copies', () => {
  eq(copyLiveText('/Users/someone/status/42'), null);
  eq(copyLiveText('https://x.com/status/42?x=/Users/someone'), null, 'home path in a query still refuses the whole thing');
});

t('javascript: never copies', () => {
  eq(copyLiveText('javascript:alert(1)'), null);
});

t('a non-status link never copies', () => {
  eq(copyLiveText('https://x.com/jayson_x'), null, 'profile link, not a post');
  eq(copyLiveText('https://evil.com/jayson_x/status/42'), null, 'wrong host');
});

t('a non-digit status id never copies', () => {
  eq(copyLiveText('https://x.com/jayson_x/status/abc'), null);
});

// --- junk safety -----------------------------------------------------------

t('junk input never throws and never copies', () => {
  eq(copyLiveText(null), null);
  eq(copyLiveText(undefined), null);
  eq(copyLiveText(''), null);
  eq(copyLiveText('   '), null);
  eq(copyLiveText(42), null);
  eq(copyLiveText({}), null);
  eq(copyLiveText('not a url'), null);
});

t('canCopyLive agrees with copyLiveText on every case', () => {
  const cases = [
    'https://x.com/jayson_x/status/42',
    'https://www.x.com/jayson_x/status/42',
    'javascript:alert(1)',
    '',
    null,
    'https://x.com/jayson_x/status/42?s=20'
  ];
  for (const c of cases) {
    eq(canCopyLive(c), copyLiveText(c) !== null, `mismatch for ${JSON.stringify(c)}`);
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nall copy-live-url tests pass');
process.exit(failed ? 1 : 0);
