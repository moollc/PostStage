/**
 * Ask-shop closer tests. Run: node tests/ask-open.test.mjs
 *
 * The brief ends on a question, and a draft and a live post deserve different
 * ones. Before it ships, the useful ask is which part is weak. Once it is out,
 * the shop agent can open the thing and read it cold — so the closer points at
 * the href.
 *
 * Contract:
 *   - publishedUrl set   → the last line mentions opening that href
 *   - publishedUrl unset → the original draft question, unchanged
 *   - either way, no rate, no count, no "how did it do"
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { formatStageBrief } from '../source/shared/brief.js';
import { W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const here = dirname(fileURLToPath(import.meta.url));
const BRIEF_SRC = readFileSync(resolve(here, '../source/shared/brief.js'), 'utf8');

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

const PLATFORM = { id: 'x', label: 'X', maxChars: 280, bestForm: 'Short claim' };
const SCORED = { band: 'draft', checks: [{ id: 'hook', ok: false }] };
const PARTS = [{ id: 'media', filled: false }];

const post = (over = {}) => ({
  audience: 'a creator staging a post',
  audienceHow: 'stated',
  platform: 'x',
  hook: 'Most posts fail before the second line.',
  body: 'The first line buys a second of attention.',
  cta: 'What line would you cut first?',
  hashtags: ['craft'],
  publishedUrl: null,
  ...over
});

const closer = (over) => formatStageBrief(post(over), PLATFORM, SCORED, PARTS).split('\n').pop();
const DRAFT_CLOSER = 'Which part is not doing its job? One line.';

// --- live: the closer points at the href ---------------------------------

t('a published post closes on opening that href', () => {
  const line = closer({ publishedUrl: W1_PUBLISHED_URL });
  ok(/open/i.test(line), `no open verb: ${JSON.stringify(line)}`);
  ok(line.includes(W1_PUBLISHED_URL), `href missing from closer: ${JSON.stringify(line)}`);
});

t('the closer names the post URL, not some other link', () => {
  const other = 'https://x.com/someoneelse/status/999';
  const line = closer({ publishedUrl: other });
  ok(line.includes(other), 'uses this post’s href');
  ok(!line.includes(W1_PUBLISHED_URL), 'did not fall back to a fixture');
});

t('a messy url is normalized in the closer too', () => {
  const line = closer({ publishedUrl: 'https://www.twitter.com/Jayson_X/status/2087952991638716610?s=20' });
  ok(line.includes(W1_PUBLISHED_URL), `not canonical: ${JSON.stringify(line)}`);
  ok(!/\?s=20|twitter\.com/.test(line), 'query or host survived');
});

t('the live closer is still one line and still asks for one line', () => {
  const line = closer({ publishedUrl: W1_PUBLISHED_URL });
  ok(!line.includes('\n'), 'closer spans lines');
  ok(/one line\.?$/i.test(line), `does not ask for one line: ${JSON.stringify(line)}`);
});

// --- draft: the old closer, unchanged ------------------------------------

t('an unpublished post keeps the original question', () => {
  eq(closer({ publishedUrl: null }), DRAFT_CLOSER, 'draft closer');
});

t('the draft closer holds for empty, whitespace and a missing key', () => {
  for (const value of [undefined, '', '   ']) {
    eq(closer({ publishedUrl: value }), DRAFT_CLOSER, `${JSON.stringify(value)}`);
  }
  const bare = formatStageBrief({ hook: 'H' }, PLATFORM, SCORED, PARTS).split('\n').pop();
  eq(bare, DRAFT_CLOSER, 'post with no publishedUrl key');
});

t('a junk url falls back to the draft closer and is not echoed', () => {
  for (const junk of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///Users/me/x.html',
    '/Users/me/Pictures/post.png',
    'https://evil.test/a/status/1',
    'https://x.com/notastatus',
    'not a url'
  ]) {
    const line = closer({ publishedUrl: junk });
    eq(line, DRAFT_CLOSER, `${junk} changed the closer`);
    ok(!line.includes(junk), `${junk} leaked into the closer`);
  }
});

t('a junk url never puts a home path in the closer', () => {
  const line = closer({ publishedUrl: '/Users/roymcgregor/Pictures/post.png' });
  ok(!/\/Users\//.test(line), `home path: ${JSON.stringify(line)}`);
});

// --- the closer is always last -------------------------------------------

t('the closer is the final line in both states', () => {
  const live = formatStageBrief(post({ publishedUrl: W1_PUBLISHED_URL }), PLATFORM, SCORED, PARTS).split('\n');
  ok(/open/i.test(live[live.length - 1]), 'live closer is last');
  const draft = formatStageBrief(post(), PLATFORM, SCORED, PARTS).split('\n');
  eq(draft[draft.length - 1], DRAFT_CLOSER, 'draft closer is last');
});

t('the heuristic line still sits directly above the closer', () => {
  const lines = formatStageBrief(post({ publishedUrl: W1_PUBLISHED_URL }), PLATFORM, SCORED, PARTS).split('\n');
  ok(/^Heuristic:/.test(lines[lines.length - 2]), `above closer was ${JSON.stringify(lines[lines.length - 2])}`);
});

// --- no rates, and no invitation to report one ---------------------------

t('the closer asks for a reading, never a number', () => {
  for (const url of [W1_PUBLISHED_URL, null]) {
    const line = closer({ publishedUrl: url });
    ok(!/\bviews?\b|\blikes?\b|\breposts?\b|\bimpressions?\b|\bfollowers?\b|\bengagement\b/i.test(line),
      `engagement word in closer: ${JSON.stringify(line)}`);
    ok(!/how (did|is) it (do|doing|perform)|how many|numbers|metrics|stats/i.test(line),
      `asks for performance: ${JSON.stringify(line)}`);
    ok(!/\d+%|\brate\b/i.test(line), `a rate appeared: ${JSON.stringify(line)}`);
  }
});

t('the closer helper does no arithmetic', () => {
  const start = BRIEF_SRC.indexOf('function closerFor(');
  ok(start > 0, 'closerFor exists');
  const body = BRIEF_SRC.slice(start, BRIEF_SRC.indexOf('\n}', start) + 2);
  ok(!/toFixed|\*\s*100|reduce\(|\.length\s*\//.test(body), 'computes something');
  ok(!/scorePost|scored|\.band/.test(body), 'reads the scorer');
});

console.log(failed ? `\n${failed} FAILED` : '\nall ask-open tests pass');
process.exit(failed ? 1 : 0);
