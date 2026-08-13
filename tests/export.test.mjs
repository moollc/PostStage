/**
 * Copy-out tests. Run: node tests/export.test.mjs
 *
 * `formatPost` produces the string the operator actually pastes into a network,
 * which makes it the highest-consequence output in the app. These tests pin the
 * exact string per platform so a future edit to the section joining or the tag
 * rules cannot silently change what lands in someone's timeline.
 *
 * `platforms.js` carries a synchronous FALLBACK list and `getPlatform` works
 * without fetch, so both real modules import directly — nothing is stubbed.
 */

import { formatPost, formatThread, isFinalThreadPart } from '../source/shared/export.js';
import { getPlatform } from '../source/shared/platforms.js';

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
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

/** The standard post every platform test formats. */
const POST = {
  title: 'Video title here',
  hook: 'Most posts fail before the second line.',
  body: 'The first line buys a second of attention.',
  cta: 'What line would you cut first?',
  hashtags: ['craft', 'audience']
};

const HOOK = POST.hook;
const BODY = POST.body;
const CTA = POST.cta;
const TAGS = '#craft #audience';

// --- per platform, exact strings -----------------------------------------

t('x — hook/body/cta blank-line separated, tags after a blank line', () => {
  eq(formatPost(POST, getPlatform('x')), `${HOOK}\n\n${BODY}\n\n${CTA}\n\n${TAGS}`);
});

t('linkedin — same paragraph shape as x', () => {
  eq(formatPost(POST, getPlatform('linkedin')), `${HOOK}\n\n${BODY}\n\n${CTA}\n\n${TAGS}`);
});

t('instagram — tags on their own line, single newline before them', () => {
  eq(formatPost(POST, getPlatform('instagram')), `${HOOK}\n\n${BODY}\n\n${CTA}\n${TAGS}`);
});

t('tiktok — same tagged-caption shape as instagram', () => {
  eq(formatPost(POST, getPlatform('tiktok')), `${HOOK}\n\n${BODY}\n\n${CTA}\n${TAGS}`);
});

t('facebook — same tagged-caption shape as instagram', () => {
  eq(formatPost(POST, getPlatform('facebook')), `${HOOK}\n\n${BODY}\n\n${CTA}\n${TAGS}`);
});

t('youtube — title first, then body and cta, hook and tags omitted', () => {
  eq(formatPost(POST, getPlatform('youtube')), `${POST.title}\n${BODY}\n\n${CTA}`);
});

t('an unknown platform id falls back to the paragraph shape', () => {
  eq(formatPost(POST, { id: 'mastodon', maxChars: 500 }), `${HOOK}\n\n${BODY}\n\n${CTA}\n\n${TAGS}`);
});

t('platform may be omitted — resolved from post.platform', () => {
  eq(
    formatPost({ ...POST, platform: 'instagram' }),
    `${HOOK}\n\n${BODY}\n\n${CTA}\n${TAGS}`
  );
});

// --- empty copy -----------------------------------------------------------

t('an empty post copies an empty string on every platform', () => {
  for (const id of ['x', 'instagram', 'tiktok', 'youtube', 'linkedin', 'facebook']) {
    eq(formatPost({ hashtags: [] }, getPlatform(id)), '', `${id} empty`);
  }
});

t('a post with only whitespace copies an empty string', () => {
  const blank = { title: '  ', hook: '   ', body: '\n\n', cta: '\t', hashtags: [] };
  for (const id of ['x', 'instagram', 'youtube']) {
    eq(formatPost(blank, getPlatform(id)), '', `${id} whitespace-only`);
  }
});

t('missing fields entirely — no crash, no stray separators', () => {
  eq(formatPost({}, getPlatform('x')), '');
  eq(formatPost({}, getPlatform('youtube')), '');
});

t('tags alone still copy on a tagged-caption platform', () => {
  eq(formatPost({ hashtags: ['only', 'tags'] }, getPlatform('instagram')), '#only #tags');
});

t('tags alone are dropped on youtube, which never emits tags', () => {
  eq(formatPost({ hashtags: ['only', 'tags'] }, getPlatform('youtube')), '');
});

// --- partial posts --------------------------------------------------------

t('a hook on its own copies with no leading or trailing blank lines', () => {
  eq(formatPost({ hook: 'Just a hook', hashtags: [] }, getPlatform('x')), 'Just a hook');
});

t('a missing body does not leave a double gap', () => {
  eq(formatPost({ hook: 'H', cta: 'C', hashtags: [] }, getPlatform('x')), 'H\n\nC');
});

t('youtube with no title falls back to body and cta', () => {
  eq(formatPost({ body: 'B', cta: 'C', hashtags: [] }, getPlatform('youtube')), 'B\n\nC');
});

t('youtube with only a title copies just the title', () => {
  eq(formatPost({ title: 'T', hashtags: [] }, getPlatform('youtube')), 'T');
});

// --- tag handling ---------------------------------------------------------

t('a leading # on a stored tag is not doubled', () => {
  eq(formatPost({ hook: 'H', hashtags: ['#craft', 'audience'] }, getPlatform('x')), 'H\n\n#craft #audience');
});

t('blank and whitespace-only tags are dropped', () => {
  eq(formatPost({ hook: 'H', hashtags: ['craft', '', '   ', 'audience'] }, getPlatform('x')), 'H\n\n#craft #audience');
});

t('a post with no tags has no trailing separator', () => {
  eq(formatPost({ hook: 'H', body: 'B', hashtags: [] }, getPlatform('x')), 'H\n\nB');
  eq(formatPost({ hook: 'H', body: 'B', hashtags: [] }, getPlatform('instagram')), 'H\n\nB');
});

// --- documented edge cases ------------------------------------------------
// These pin behaviour that is currently intentional but was never recorded.
// If any of these change, it should be a decision, not a side effect.

t('DOCUMENTED: tags are dropped when they would breach maxChars', () => {
  // X is 280. A 275-char hook leaves no room for " \n\n#craft #audience".
  const tight = { hook: 'y'.repeat(275), hashtags: ['craft', 'audience'] };
  const out = formatPost(tight, getPlatform('x'));
  eq(out, 'y'.repeat(275), 'tags dropped whole rather than truncated');
  ok(!out.includes('#'), 'no partial tag line');
});

t('DOCUMENTED: tags are kept when they do fit exactly', () => {
  const tags = '#craft #audience';                 // 17 chars
  const room = 280 - tags.length - 2;              // minus the "\n\n"
  const fits = { hook: 'y'.repeat(room), hashtags: ['craft', 'audience'] };
  const out = formatPost(fits, getPlatform('x'));
  eq(out.length, 280, 'exactly at the ceiling');
  ok(out.endsWith(tags), 'tags retained at the boundary');
});

t('DOCUMENTED: an over-limit post is copied in full, not truncated', () => {
  // The rail shows "over limit" separately; the clipboard does not enforce it.
  const over = { hook: 'x'.repeat(300), hashtags: [] };
  const out = formatPost(over, getPlatform('x'));
  eq(out.length, 300, 'emitted at full length despite the 280 ceiling');
});

t('DOCUMENTED: every platform emits full text when the post is over maxChars', () => {
  // maxChars gates two things only: the rail's "over limit" label, and whether
  // tags are appended on x/linkedin. It never truncates the copy. The operator
  // pastes what they wrote and the network decides — losing the tail silently
  // would be worse than a post the network rejects.
  for (const id of ['x', 'instagram', 'tiktok', 'youtube', 'linkedin', 'facebook']) {
    const platform = getPlatform(id);
    const body = 'B'.repeat(platform.maxChars + 500);
    const post = { title: 'TITLE', hook: 'HOOK', body, cta: 'CTA', hashtags: ['craft'] };
    const out = formatPost(post, platform);

    ok(out.length > platform.maxChars, `${id} did not exceed maxChars — bad fixture`);
    ok(out.includes(body), `${id} truncated the body`);
    ok(out.includes('CTA'), `${id} lost the trailing cta`);
    // Nothing is appended to mark the overflow.
    ok(!out.includes('…') && !out.includes('...'), `${id} added an ellipsis`);
  }
});

t('DOCUMENTED: an over-limit post keeps its leading text too', () => {
  // Truncation from the front would be just as lossy as from the back.
  const platform = getPlatform('x');
  const post = { hook: 'HOOK-START', body: 'b'.repeat(400), cta: 'CTA-END', hashtags: [] };
  const out = formatPost(post, platform);
  ok(out.startsWith('HOOK-START'), 'hook survived at the front');
  ok(out.endsWith('CTA-END'), 'cta survived at the back');
  eq(out, `HOOK-START\n\n${'b'.repeat(400)}\n\nCTA-END`, 'exact string, nothing trimmed');
});

t('DOCUMENTED: youtube omits the hook entirely', () => {
  const out = formatPost(POST, getPlatform('youtube'));
  ok(!out.includes(HOOK), 'hook is not in the YouTube description');
  ok(out.startsWith(POST.title), 'title leads instead');
});

t('DOCUMENTED: tagged-caption platforms ignore maxChars for tags', () => {
  // Unlike x/linkedin, instagram appends tags regardless of length.
  const long = { hook: 'z'.repeat(2200), hashtags: ['craft'] };
  const out = formatPost(long, getPlatform('instagram'));
  ok(out.endsWith('\n#craft'), 'tags appended even past the ceiling');
  ok(out.length > 2200, 'result exceeds maxChars');
});

// --- media never reaches the clipboard ------------------------------------

t('media is not in the paste string on any platform', () => {
  // A local file name and a blob URL are machine-local artifacts. The paste
  // string goes into a public timeline, so neither may appear in it — and
  // genPrompt is an authoring note, not copy.
  const withMedia = {
    ...POST,
    media: [{ name: 'private-shot.png', type: 'image/png', url: 'blob:https://localhost:7744/9f8e-4c2a' }],
    genPrompt: 'a still of a desk at night'
  };
  for (const id of ['x', 'instagram', 'tiktok', 'youtube', 'linkedin', 'facebook']) {
    const out = formatPost(withMedia, getPlatform(id));
    ok(!out.includes('blob:'), `${id} leaked a blob URL`);
    ok(!out.includes('private-shot.png'), `${id} leaked a file name`);
    ok(!out.includes('image/png'), `${id} leaked a MIME type`);
    ok(!out.includes('desk at night'), `${id} leaked the gen prompt`);
    // The copy is exactly what it would be with no media attached at all.
    eq(out, formatPost(POST, getPlatform(id)), `${id} media changed the copy`);
  }
});

t('a post that is only media copies an empty string', () => {
  const mediaOnly = {
    media: [{ name: 'shot.png', type: 'image/png', url: 'blob:https://localhost:7744/abc' }],
    genPrompt: 'describe the still',
    hashtags: []
  };
  for (const id of ['x', 'instagram', 'youtube']) {
    eq(formatPost(mediaOnly, getPlatform(id)), '', `${id} media-only`);
  }
});

// --- X thread split -------------------------------------------------------

t('X under 280 is one unnumbered part, same as formatPost', () => {
  const parts = formatThread(POST, getPlatform('x'));
  eq(parts.length, 1, 'single part');
  eq(parts[0], formatPost(POST, getPlatform('x')));
  ok(!/ \d+\/\d+$/.test(parts[0]), 'no 1/1 mark under the limit');
});

t('an empty post threads to no parts', () => {
  eq(formatThread({ hashtags: [] }, getPlatform('x')).length, 0);
});

t('Instagram over 280 stays one paste, no numbers', () => {
  const long = { hook: 'z'.repeat(400), body: 'b'.repeat(400), cta: 'C', hashtags: ['craft'] };
  const parts = formatThread(long, getPlatform('instagram'));
  eq(parts.length, 1, 'one caption');
  eq(parts[0], formatPost(long, getPlatform('instagram')));
  ok(!/ \d+\/\d+$/.test(parts[0].trim()), 'no thread mark');
});

t('LinkedIn over 280 stays one paste', () => {
  const long = { hook: 'H', body: 'b'.repeat(400), cta: 'C', hashtags: [] };
  const parts = formatThread(long, getPlatform('linkedin'));
  eq(parts.length, 1);
  eq(parts[0], formatPost(long, getPlatform('linkedin')));
});

t('X over 280 splits into numbered 1/n parts that each fit', () => {
  const over = {
    hook: 'HOOK-START',
    body: 'word '.repeat(90).trim(),
    cta: 'CTA-END',
    hashtags: []
  };
  const full = formatPost(over, getPlatform('x'));
  ok(full.length > 280, 'fixture is over 280');
  const parts = formatThread(over, getPlatform('x'));
  const n = parts.length;
  ok(n > 1, 'more than one tweet');
  parts.forEach((part, i) => {
    ok(part.length <= 280, `part ${i + 1} is ${part.length} chars`);
    ok(part.endsWith(` ${i + 1}/${n}`), `part ${i + 1} numbered ${i + 1}/${n}`);
  });
  ok(parts[0].includes('HOOK-START'), 'hook in first part');
  ok(parts[n - 1].includes('CTA-END'), 'cta in last part');
});

t('X thread does not invent reach or impression numbers', () => {
  const over = { hook: 'H', body: 'word '.repeat(80).trim(), cta: 'C', hashtags: [] };
  const blob = formatThread(over, getPlatform('x')).join('\n');
  ok(!/impressions/i.test(blob), 'no impressions');
  ok(!/reach/i.test(blob), 'no reach');
});

t('X thread keeps tags on the last part only when they still fit', () => {
  const over = {
    hook: 'H',
    body: 'word '.repeat(80).trim(),
    cta: 'C',
    hashtags: ['craft', 'audience']
  };
  const parts = formatThread(over, getPlatform('x'));
  const last = parts[parts.length - 1];
  const earlier = parts.slice(0, -1).join('\n');
  ok(!earlier.includes('#craft'), 'tags not on earlier parts');
  if (last.includes('#craft')) {
    ok(last.length <= 280, 'tagged last part still fits');
    ok(last.includes('#audience'), 'tag line stays whole');
  }
});

// --- live paste string is the current thread part -------------------------
//
// index.js keeps a `threadCursor` and copies `parts[threadCursor.index]`
// (`formatLiveCopy`). The cursor lives in the UI, but the invariant it depends
// on is pure: whatever the cursor points at must be exactly one element of
// `formatThread`, never a join of several and never the whole `formatPost`
// string once a post has split. These model that selection without a DOM.

/** What formatLiveCopy returns, given a cursor position. */
function liveCopyAt(post, platform, index) {
  const parts = formatThread(post, platform);
  const clamped = parts.length ? Math.min(Math.max(index, 0), parts.length - 1) : 0;
  return parts[clamped] || '';
}

t('live paste equals the current thread part at every cursor position', () => {
  const platform = getPlatform('x');
  const over = { hook: 'H'.repeat(260), body: 'B'.repeat(260), cta: 'C'.repeat(260), hashtags: [] };
  const parts = formatThread(over, platform);
  ok(parts.length > 1, 'fixture actually split');

  for (let i = 0; i < parts.length; i++) {
    eq(liveCopyAt(over, platform, i), parts[i], `cursor ${i} pastes part ${i + 1}`);
    ok(parts[i].length <= platform.maxChars, `part ${i + 1} fits the ceiling`);
  }
});

t('live paste is never the whole post once it has split', () => {
  const platform = getPlatform('x');
  const over = { hook: 'H'.repeat(300), body: 'B'.repeat(300), cta: '', hashtags: [] };
  const parts = formatThread(over, platform);
  const whole = formatPost(over, platform);
  ok(parts.length > 1, 'fixture split');
  for (let i = 0; i < parts.length; i++) {
    const live = liveCopyAt(over, platform, i);
    ok(live !== whole, `cursor ${i} did not paste the unsplit string`);
    ok(live.length <= platform.maxChars, `cursor ${i} within the ceiling`);
  }
});

t('a cursor past the end clamps to the last part', () => {
  const platform = getPlatform('x');
  const over = { hook: 'H'.repeat(600), hashtags: [] };
  const parts = formatThread(over, platform);
  ok(parts.length > 1, 'fixture split');
  eq(liveCopyAt(over, platform, 99), parts[parts.length - 1], 'clamped to the last part');
  eq(liveCopyAt(over, platform, -3), parts[0], 'clamped to the first part');
});

t('an X post under the ceiling pastes the formatPost string exactly', () => {
  // One part, so the live copy and the plain copy must agree byte for byte.
  const platform = getPlatform('x');
  const parts = formatThread(POST, platform);
  eq(parts.length, 1, 'did not split');
  eq(liveCopyAt(POST, platform, 0), formatPost(POST, platform), 'same string');
});

t('non-X platforms always paste the whole formatPost string', () => {
  for (const id of ['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook']) {
    const platform = getPlatform(id);
    const body = 'B'.repeat(platform.maxChars + 800);
    const long = { title: 'T', hook: 'HOOK', body, cta: 'CTA', hashtags: ['craft'] };
    const parts = formatThread(long, platform);
    eq(parts.length, 1, `${id} did not split`);
    eq(liveCopyAt(long, platform, 0), formatPost(long, platform), `${id} live copy is the full string`);
    // A cursor that drifted past the end still cannot produce an empty paste.
    eq(liveCopyAt(long, platform, 5), formatPost(long, platform), `${id} clamps to the single part`);
  }
});

t('an empty post pastes an empty string rather than undefined', () => {
  for (const id of ['x', 'instagram', 'youtube']) {
    const platform = getPlatform(id);
    eq(formatThread({ hashtags: [] }, platform).length, 0, `${id} has no parts`);
    eq(liveCopyAt({ hashtags: [] }, platform, 0), '', `${id} pastes an empty string`);
  }
});

t('every part of a split post is non-empty', () => {
  // A blank part would let the operator paste nothing and think they had posted.
  const platform = getPlatform('x');
  const over = { hook: 'H'.repeat(900), body: 'B'.repeat(400), cta: 'C', hashtags: ['craft'] };
  for (const part of formatThread(over, platform)) {
    ok(part.trim().length > 0, 'no blank part');
  }
});

t('What happened? does not fire on thread part 1/n', () => {
  const n = 4;
  ok(!isFinalThreadPart(0, n), '1/4 is not the last part');
  ok(!isFinalThreadPart(1, n), '2/4 is not the last part');
  ok(!isFinalThreadPart(2, n), '3/4 is not the last part');
  ok(isFinalThreadPart(3, n), '4/4 is the last part');
});

t('a non-thread Copy is its own last part', () => {
  ok(isFinalThreadPart(0, 1), 'single paste opens What happened?');
  ok(!isFinalThreadPart(0, 0), 'nothing to copy does not');
});

t('a live X split only completes on the last formatThread part', () => {
  const over = { hook: 'H'.repeat(300), body: 'B'.repeat(300), cta: 'C', hashtags: [] };
  const parts = formatThread(over, getPlatform('x'));
  ok(parts.length > 1, 'fixture split');
  for (let i = 0; i < parts.length - 1; i++) {
    ok(!isFinalThreadPart(i, parts.length), `part ${i + 1}/${parts.length} must not open the prompt`);
  }
  ok(isFinalThreadPart(parts.length - 1, parts.length), 'last part opens the prompt');
});

t('a two-part thread prompts only on the second', () => {
  const platform = getPlatform('x');
  const over = { hook: 'H'.repeat(300), hashtags: [] };
  const parts = formatThread(over, platform);
  eq(parts.length, 2, 'fixture is exactly two parts');
  ok(!isFinalThreadPart(0, parts.length), '1/2 does not prompt');
  ok(isFinalThreadPart(1, parts.length), '2/2 prompts');
});

t('non-X platforms are one part, so copy always prompts', () => {
  for (const id of ['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook']) {
    const platform = getPlatform(id);
    const body = 'B'.repeat(platform.maxChars + 800);
    const parts = formatThread({ title: 'T', hook: 'HOOK', body, cta: 'CTA', hashtags: [] }, platform);
    eq(parts.length, 1, `${id} did not split`);
    ok(isFinalThreadPart(0, parts.length), `${id} prompts on copy`);
  }
});

t('going back to 1/n after the last part does not re-fire the prompt', () => {
  const platform = getPlatform('x');
  const over = { hook: 'H'.repeat(600), hashtags: [] };
  const parts = formatThread(over, platform);
  ok(parts.length > 1, 'fixture split');
  ok(isFinalThreadPart(parts.length - 1, parts.length), 'last part prompts');
  ok(!isFinalThreadPart(0, parts.length), '1/n does not prompt');
});

console.log(failed ? `\n${failed} FAILED` : '\nall export tests pass');
process.exit(failed ? 1 : 0);
