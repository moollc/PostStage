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

function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

console.log(failed ? `\n${failed} FAILED` : '\nall brief tests pass');
process.exit(failed ? 1 : 0);
