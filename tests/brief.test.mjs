/**
 * Path-scrub tests. Run: node tests/brief.test.mjs
 *
 * `scrubPaths` is the one point every field of the "Ask shop" packet passes
 * through before it leaves the machine — Keep shop line can pull raw terminal
 * output (a cwd, a stack trace, an ENOENT message) straight into the hook, and
 * this is what stands between that and an agent pane. A regex gap here is a
 * real leak, not a cosmetic bug, so these pin the exact scrubbed string rather
 * than just asserting "no path substring survives."
 */

import { scrubPaths, formatStageBrief } from '../source/shared/brief.js';

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
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'not equal'}\n        actual:   ${JSON.stringify(actual)}\n        expected: ${JSON.stringify(expected)}`);
  }
}

// --- single-word segments (already worked before this fix) ----------------

t('a plain POSIX path redacts fully', () => {
  eq(scrubPaths('/Users/alex/notes/todo.txt'), '<path>');
});

t('a single two-word segment ("My Drive") redacts fully', () => {
  eq(
    scrubPaths('/Users/alex/My Drive/Antigravity/file.js'),
    '<path>'
  );
});

t('a Windows path redacts fully', () => {
  eq(scrubPaths('C:\\Users\\alex\\AppData\\Local\\mkcert failed'), '<path> failed');
});

t('a UNC path redacts fully', () => {
  eq(scrubPaths('\\\\host\\share\\file.txt'), '<path>');
});

t('a file:// URL redacts fully', () => {
  eq(scrubPaths('file:///Users/alex/notes.txt'), '<path>');
});

t('a ~/ path redacts fully', () => {
  eq(scrubPaths('~/Library/CloudStorage/notes.txt'), '<path>');
});

t('plain text with no path is untouched', () => {
  eq(scrubPaths('just plain text no path here'), 'just plain text no path here');
});

// --- DOCUMENTED: the bug this cycle fixed ----------------------------------
// `xThreadParts`/`formatThreadPart` reserved for their own module; this is
// about the scrubber only. Before the fix, only the FIRST word-plus-separator
// pair in a chain was absorbed, so a folder name with 3+ words in a row (no
// separator between any of them until the very end) left everything after
// the first word sitting in the output unredacted.

t('DOCUMENTED: a 3+ word segment ("A Folder With Spaces") redacts fully', () => {
  eq(
    scrubPaths('/Users/alex/My Drive/A Folder With Spaces/deep/file.txt'),
    '<path>'
  );
});

t('a longer real-world path with a multi-word segment redacts fully', () => {
  eq(
    scrubPaths(
      '/Users/alex/Library/CloudStorage/GoogleDrive-user-example-account/My Drive/Antigravity/poststage-workspace/PostStage/build/certs/localhost.pem'
    ),
    '<path>'
  );
});

t('a multi-word segment inside a quoted ENOENT message redacts fully', () => {
  eq(
    scrubPaths("ENOENT: no such file or directory, open '/Users/alex/My Drive/x.pem'"),
    "ENOENT: no such file or directory, open '<path>'"
  );
});

// --- guardrails: the fix must not over-match across unrelated text --------
// A naive "keep absorbing words until any separator turns up, however far
// away" fix would walk straight through the word "and" and merge two
// unrelated paths (or a path and unrelated prose) into one match.

t('two separate paths joined by "and" stay two markers, not one', () => {
  eq(
    scrubPaths('two paths: /Users/alex/a.txt and /Users/alex/b.txt'),
    'two paths: <path> and <path>'
  );
});

t('two relative paths joined by "and" stay two markers, not one', () => {
  eq(
    scrubPaths('relative ./local/file.js and ../parent/file.js'),
    'relative <path> and <path>'
  );
});

t('a path followed by prose is not swallowed into the match', () => {
  eq(
    scrubPaths('error at /Users/alex/My Drive/x, retrying'),
    'error at <path>, retrying'
  );
});

t('a sentence merely containing a folder-like phrase is not treated as a path', () => {
  eq(
    scrubPaths('a sentence with the word My Drive is nice but not a path'),
    'a sentence with the word My Drive is nice but not a path'
  );
});

// --- edge inputs ------------------------------------------------------------

t('empty, null, and undefined all scrub to an empty string', () => {
  eq(scrubPaths(''), '');
  eq(scrubPaths(null), '');
  eq(scrubPaths(undefined), '');
});

t('a non-string value is coerced before scrubbing', () => {
  eq(scrubPaths(123), '123');
});

// --- formatStageBrief integration ------------------------------------------

t('formatStageBrief scrubs a multi-word path inside the hook', () => {
  const post = {
    audience: 'creators',
    audienceHow: 'stated',
    platform: 'x',
    hook: 'A hook with /Users/alex/My Drive/A Folder With Spaces/file.js in it',
    body: 'body text',
    cta: 'call to action',
    hashtags: ['a', 'b']
  };
  const brief = formatStageBrief(post, { id: 'x', label: 'X' }, { band: 'ready', checks: [] }, []);
  ok(brief.includes('Hook: A hook with <path> in it'), 'hook line is fully scrubbed');
  ok(!brief.includes('Folder'), 'no fragment of the folder name survives anywhere in the brief');
  ok(!brief.includes('alex'), 'no fragment of the path survives anywhere in the brief');
});

t('formatStageBrief omits copied paste when lastPaste is missing', () => {
  const brief = formatStageBrief(
    { audience: 'creators', audienceHow: 'stated', platform: 'x', hook: 'live hook' },
    { id: 'x', label: 'X' },
    { band: 'ready', checks: [] },
    []
  );
  ok(!brief.includes('Copied paste'), 'no Copied paste line');
  ok(!brief.includes('Copied platform'), 'no Copied platform line');
  ok(!brief.includes('Copied part'), 'no Copied part line');
});

t('formatStageBrief includes frozen lastPaste, not the live rail', () => {
  const pasted = 'exact X paste 2/2';
  const brief = formatStageBrief(
    {
      audience: 'creators',
      audienceHow: 'stated',
      platform: 'linkedin',
      hook: 'live hook after a later edit',
      body: 'live body',
      lastPaste: { text: pasted, platformId: 'x', partIndex: 1 }
    },
    { id: 'linkedin', label: 'LinkedIn' },
    { band: 'ready', checks: [] },
    []
  );
  ok(brief.includes(`Copied paste: ${pasted}`), 'frozen clipboard string');
  ok(brief.includes('Copied platform: x'), 'copied platformId');
  ok(brief.includes('Copied part: 1'), 'copied partIndex');
  ok(brief.includes('Hook: live hook after a later edit'), 'live rail still present');
  ok(brief.includes('Platform: LinkedIn'), 'live preview platform still present');
  ok(!/reach|impress|likes|views|followers/i.test(brief), 'no invented metrics');
});

t('formatStageBrief scrubs a path inside lastPaste text', () => {
  const brief = formatStageBrief(
    {
      audience: 'creators',
      audienceHow: 'stated',
      platform: 'x',
      hook: 'clean hook',
      lastPaste: {
        text: 'copied /Users/alex/My Drive/A Folder With Spaces/file.js onto X',
        platformId: 'x',
        partIndex: 0
      }
    },
    { id: 'x', label: 'X' },
    { band: 'ready', checks: [] },
    []
  );
  ok(brief.includes('Copied paste: copied <path> onto X'), 'lastPaste text is scrubbed');
  ok(!brief.includes('Folder'), 'no folder fragment in lastPaste');
  ok(!brief.includes('alex'), 'no home fragment in lastPaste');
});

// --- Ask shop's live href is a status URL, no junk -------------------------
// Lead brief: the brief must not include junk, home paths, or view counts.
// liveHrefLines re-normalizes post.publishedUrl through normalizePublishedUrl
// rather than trusting it as stored, since the brief is the last stop before
// this leaves the machine for a Herdr pane.
//
// The line's exact label ("Live:" vs "Live URL:") has changed under
// concurrent edits to this file more than once while these tests were being
// written. The label is cosmetic; the safety contract is not. These match
// on content — a line that contains "Live" and the URL — rather than one
// exact label string, so the tests hold regardless of which label wins.

const BASE_POST = { audience: 'creators', audienceHow: 'stated', platform: 'x', hook: 'H' };
const PLATFORM_X = { id: 'x', label: 'X' };
const CLEAN_SCORE = { band: 'ready', checks: [] };

/** The line carrying the live href, or undefined if there is none. */
function liveLine(brief) {
  return brief.split('\n').find((l) => /^Live/i.test(l) && l.includes('http'));
}

t('formatStageBrief includes a clean published URL as a Live line', () => {
  const brief = formatStageBrief(
    { ...BASE_POST, publishedUrl: 'https://x.com/jayson_x/status/42' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  const line = liveLine(brief);
  ok(line, 'a live line exists');
  ok(line.endsWith('https://x.com/jayson_x/status/42'), `live line was ${JSON.stringify(line)}`);
});

t('formatStageBrief omits the live line entirely when there is no publishedUrl', () => {
  const brief = formatStageBrief(BASE_POST, PLATFORM_X, CLEAN_SCORE, []);
  ok(!liveLine(brief), 'no live line at all — not even an "(empty)" placeholder');
});

t('formatStageBrief omits the live line for a home-path publishedUrl rather than leaking it', () => {
  const brief = formatStageBrief(
    { ...BASE_POST, publishedUrl: '/Users/someone/status/42' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  ok(!liveLine(brief), 'no live line — junk is dropped silently, not stamped in as empty');
  ok(!brief.includes('/Users/'), 'no fragment of the home path anywhere in the brief');
  ok(!brief.includes('someone'), 'no fragment of the path segment anywhere in the brief');
});

t('formatStageBrief omits the live line for javascript: and other junk schemes', () => {
  const junk = ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.com/jayson_x/status/42', 'not a url'];
  for (const publishedUrl of junk) {
    const brief = formatStageBrief({ ...BASE_POST, publishedUrl }, PLATFORM_X, CLEAN_SCORE, []);
    ok(!liveLine(brief), `junk "${publishedUrl}" did not produce a live line`);
  }
});

t('formatStageBrief strips a view-count query string from the live href rather than including it', () => {
  const brief = formatStageBrief(
    { ...BASE_POST, publishedUrl: 'https://x.com/jayson_x/status/42?views=999999&likes=1000' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  const line = liveLine(brief);
  ok(line && line.endsWith('https://x.com/jayson_x/status/42'), 'the clean status link is still included');
  ok(!brief.includes('views'), 'no "views" text anywhere in the brief');
  ok(!brief.includes('999999'), 'no count number anywhere in the brief');
  ok(!line.includes('?'), `no leftover query-string punctuation on the live line itself: ${JSON.stringify(line)}`);
});

t('formatStageBrief canonicalizes twitter.com to x.com on the live line, same as storage', () => {
  const brief = formatStageBrief(
    { ...BASE_POST, publishedUrl: 'https://twitter.com/jayson_x/status/42' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  const line = liveLine(brief);
  ok(line && line.endsWith('https://x.com/jayson_x/status/42'), 'canonical x.com form, matching stored normalization');
  ok(!brief.includes('twitter.com'), 'the raw twitter.com host does not survive into the brief');
});

t('formatStageBrief has no field name shaped like an engagement metric anywhere near the live line', () => {
  const brief = formatStageBrief(
    { ...BASE_POST, publishedUrl: 'https://x.com/jayson_x/status/42' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  ok(!/view|like|repl(y|ies)|quote|impress|follower/i.test(brief), 'no engagement-shaped word anywhere in the whole brief');
});

t('formatStageBrief includes the live href exactly once, not duplicated', () => {
  const brief = formatStageBrief(
    { ...BASE_POST, publishedUrl: 'https://x.com/jayson_x/status/42' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  const lines = brief.split('\n').filter((l) => /^Live/i.test(l) && l.includes('http'));
  eq(lines.length, 1, 'exactly one live-href line, not repeated by a duplicated call');
});

t('formatStageBrief closer tells the pane to open the live href', () => {
  const brief = formatStageBrief(
    { ...BASE_POST, publishedUrl: 'https://x.com/jayson_x/status/42' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  const last = brief.split('\n').pop();
  ok(/^Open /i.test(last), `closer was ${JSON.stringify(last)}`);
  ok(last.includes('https://x.com/jayson_x/status/42'), 'closer carries the href');
  ok(last.endsWith('Which part is not doing its job? One line.'), 'still asks which part');
});

t('formatStageBrief closer stays the draft question without a URL', () => {
  const brief = formatStageBrief(BASE_POST, PLATFORM_X, CLEAN_SCORE, []);
  eq(brief.split('\n').pop(), 'Which part is not doing its job? One line.', 'draft closer');
});

t('formatStageBrief closer does not leak a home path or views query', () => {
  const home = formatStageBrief(
    { ...BASE_POST, publishedUrl: '/Users/someone/status/42' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  ok(!home.includes('/Users/'), 'home path in a no-url brief');
  ok(!/^Open /i.test(home.split('\n').pop()), 'Open on junk');
  const messy = formatStageBrief(
    { ...BASE_POST, publishedUrl: 'https://x.com/jayson_x/status/42?views=9' },
    PLATFORM_X,
    CLEAN_SCORE,
    []
  );
  const last = messy.split('\n').pop();
  ok(last.includes('https://x.com/jayson_x/status/42'), 'canonical in closer');
  ok(!last.includes('views') && !/\?views=/.test(last), `query in closer: ${JSON.stringify(last)}`);
});

function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

console.log(failed ? `\n${failed} FAILED` : '\nall brief tests pass');
process.exit(failed ? 1 : 0);
