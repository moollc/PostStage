/**
 * Ask-shop live href tests. Run: node tests/ask-live.test.mjs
 *
 * The stage brief is the packet that leaves this machine and lands in another
 * agent's pane. Contract for the live link:
 *
 *   - `publishedUrl` appears in the brief when set
 *   - the line is omitted entirely when null — not rendered as "(empty)"
 *   - no view, like or engagement number ever appears
 *   - the scorer is not read to build it
 *
 * These are written against the **contract**, not a label. The line may read
 * `Live:` or `Live URL:` — the assertions look for the href itself and for a
 * line carrying it, so the wording stays the implementer's choice.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { formatStageBrief } from '../source/shared/brief.js';
import { W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const here = dirname(fileURLToPath(import.meta.url));
const BRIEF_SRC = readFileSync(resolve(here, '../source/shared/brief.js'), 'utf8');
const SCORE_SRC = readFileSync(resolve(here, '../source/shared/score.js'), 'utf8');

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
const SCORED = { band: 'draft', checks: [{ id: 'hook', ok: false }, { id: 'body', ok: true }] };
const PARTS = [{ id: 'media', filled: false }, { id: 'tags', filled: true }];

const post = (over = {}) => ({
  audience: 'a creator staging a post',
  audienceHow: 'stated',
  platform: 'x',
  hook: 'Most posts fail before the second line.',
  body: 'The first line buys a second of attention.',
  cta: 'What line would you cut first?',
  hashtags: ['craft'],
  genPrompt: '',
  publishedUrl: null,
  ...over
});

const brief = (over) => formatStageBrief(post(over), PLATFORM, SCORED, PARTS);

/** Lines that carry a live-post href, whatever the label is. */
const hrefLines = (out) => out.split('\n').filter((l) => /https:\/\/x\.com\/\S+\/status\/\d+/.test(l));

// --- present when set -----------------------------------------------------

t('the brief carries publishedUrl when the post has one', () => {
  const out = brief({ publishedUrl: W1_PUBLISHED_URL });
  ok(out.includes(W1_PUBLISHED_URL), `href missing from:\n${out}`);
});

t('the href appears as its own labelled field line, exactly once', () => {
  // The closer may also mention the href (see ask-open); the *field* line is
  // the one this asserts — a labelled line ending in the url.
  const field = hrefLines(brief({ publishedUrl: W1_PUBLISHED_URL }))
    .filter((l) => l.trim().endsWith(W1_PUBLISHED_URL) && /^[A-Za-z][A-Za-z ]*:/.test(l));
  eq(field.length, 1, `expected one href field line, got ${JSON.stringify(field)}`);
});

t('a messy but real url is normalized before it goes out', () => {
  const out = brief({ publishedUrl: 'https://www.twitter.com/Jayson_X/status/2087952991638716610?s=20' });
  ok(out.includes(W1_PUBLISHED_URL), 'canonical x.com form');
  ok(!out.includes('?s=20'), 'query stripped');
  ok(!out.includes('twitter.com'), 'host normalized');
});

// --- omitted when absent --------------------------------------------------

t('no href line at all when publishedUrl is null', () => {
  const out = brief({ publishedUrl: null });
  eq(hrefLines(out).length, 0, `an href line appeared:\n${out}`);
  ok(!/live[^\n]*\(empty\)/i.test(out), 'rendered an empty placeholder');
});

t('no href line for undefined, empty, whitespace or a missing key', () => {
  for (const value of [undefined, '', '   ']) {
    eq(hrefLines(brief({ publishedUrl: value })).length, 0, `${JSON.stringify(value)} produced a line`);
  }
  const bare = formatStageBrief({ hook: 'H' }, PLATFORM, SCORED, PARTS);
  eq(hrefLines(bare).length, 0, 'a post with no publishedUrl key at all');
});

t('a junk url is dropped, not passed through', () => {
  for (const junk of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///Users/me/x.html',
    '/Users/me/Pictures/post.png',
    'https://evil.test/a/status/1',
    'https://x.com/notastatus',
    'not a url'
  ]) {
    const out = brief({ publishedUrl: junk });
    eq(hrefLines(out).length, 0, `${junk} produced an href line`);
    ok(!out.includes(junk), `${junk} leaked into the brief verbatim`);
  }
});

t('a junk url never leaks a home path into the packet', () => {
  const out = brief({ publishedUrl: '/Users/roymcgregor/Pictures/post.png' });
  ok(!/\/Users\//.test(out), `home path in the brief:\n${out}`);
});

// --- no rates, ever -------------------------------------------------------

t('the brief carries no view, like or engagement word', () => {
  const out = brief({ publishedUrl: W1_PUBLISHED_URL });
  ok(!/\bviews?\b|\blikes?\b|\breposts?\b|\bimpressions?\b|\bfollowers?\b|\bengagement\b/i.test(out),
    `an engagement word appeared:\n${out}`);
  ok(!/\brate\b|\bpercent|\d+%/i.test(out), 'a rate appeared');
});

t('counts hung on the post never reach the brief', () => {
  const out = brief({
    publishedUrl: W1_PUBLISHED_URL,
    guestScan: { at: '2026-08-13T12:00:00.000Z', title: 'T', text: 'X' },
    views: 1204553,
    likes: 8411
  });
  ok(!out.includes('1204553') && !out.includes('8411'), 'a count leaked');
  ok(!/1,204,553/.test(out), 'a formatted count leaked');
});

t('brief.js does no arithmetic that could become a rate', () => {
  const code = BRIEF_SRC.replace(/^\s*(\*|\/\*|\/\/).*$/gm, '');
  ok(!/toFixed|\*\s*100|\/\s*\w+\.length|reduce\(/.test(code), 'computes something rate-shaped');
});

// --- the scorer is unread -------------------------------------------------

t('brief.js does not import or call the scorer', () => {
  ok(!/from\s+['"].*score\.js['"]/.test(BRIEF_SRC), 'imports score.js');
  ok(!/scorePost|scorePostLive|scorePostMaybeWasm/.test(BRIEF_SRC), 'calls a scorer');
});

t('the band shown is the one handed in, never recomputed', () => {
  ok(/Heuristic: draft/.test(brief({ publishedUrl: W1_PUBLISHED_URL })), 'uses the passed band');
  const other = formatStageBrief(post({ publishedUrl: W1_PUBLISHED_URL }), PLATFORM, { band: 'ready', checks: [] }, PARTS);
  ok(/Heuristic: ready/.test(other), 'a different band is reflected verbatim');
});

t('score.js knows nothing about the brief or the live href', () => {
  ok(!/formatStageBrief|publishedUrl/.test(SCORE_SRC), 'scorer references the brief or href');
});

// --- the rest of the brief is unchanged by this slice --------------------

t('the existing brief lines still render', () => {
  const out = brief({ publishedUrl: W1_PUBLISHED_URL });
  for (const label of ['Who:', 'How we know:', 'Platform:', 'Hook:', 'Body:', 'Call:', 'Tags:', 'Unclaimed parts:', 'Heuristic:']) {
    ok(out.includes(label), `${label} missing`);
  }
  ok(/One line\.$/.test(out), 'a one-line closing question is kept last');
});

t('an unpublished brief still ends on the draft question', () => {
  const out = brief({ publishedUrl: null });
  ok(out.endsWith('Which part is not doing its job? One line.'), `ended with: ${JSON.stringify(out.split('\n').pop())}`);
});

t('the href field line sits before the closing question', () => {
  const lines = brief({ publishedUrl: W1_PUBLISHED_URL }).split('\n');
  const field = lines.findIndex((l) => /^[A-Za-z][A-Za-z ]*:/.test(l) && l.trim().endsWith(W1_PUBLISHED_URL));
  ok(field >= 0, 'href field line present');
  ok(field < lines.length - 1, `href field at ${field} of ${lines.length}, not before the closer`);
});

// --- closer tells the pane to open the href --------------------------------

t('when publishedUrl is set, the last line tells the pane to open that href', () => {
  const last = brief({ publishedUrl: W1_PUBLISHED_URL }).split('\n').pop();
  ok(/^Open /i.test(last), `closer does not start with Open: ${JSON.stringify(last)}`);
  ok(last.includes(W1_PUBLISHED_URL), 'closer omits the href');
  ok(/Which part is not doing its job\? One line\.$/.test(last), 'still asks which part, one line');
});

t('when publishedUrl is missing, the last line is the draft closer', () => {
  const last = brief({ publishedUrl: null }).split('\n').pop();
  eq(last, 'Which part is not doing its job? One line.', 'draft closer');
  ok(!/^Open /i.test(last), 'told the pane to open something');
});

t('the closer uses the normalized href, not junk or a query', () => {
  const last = brief({
    publishedUrl: 'https://www.twitter.com/Jayson_X/status/2087952991638716610?views=99&likes=1'
  }).split('\n').pop();
  ok(last.includes(W1_PUBLISHED_URL), 'canonical href in closer');
  ok(!/twitter\.com|\?views=|\?likes=/i.test(last), 'raw host or query in closer');
  ok(!/\bviews\b|\blikes\b/i.test(last), 'counts in closer');
});

t('a junk url does not put Open or a home path on the closer', () => {
  for (const junk of ['javascript:alert(1)', '/Users/me/status/1', 'not a url']) {
    const last = brief({ publishedUrl: junk }).split('\n').pop();
    eq(last, 'Which part is not doing its job? One line.', `${junk} closer`);
    ok(!/\/Users\//.test(last), `${junk} leaked a home path`);
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nall ask-live tests pass');
process.exit(failed ? 1 : 0);
