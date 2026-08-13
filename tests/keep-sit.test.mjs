/**
 * Keep shop line: no path, no address, no secret.
 * Run: node tests/keep-sit.test.mjs
 *
 * `lastShopLine` reads a Herdr pane and Keep puts the result on the idea lane,
 * where it persists and can reach the stage — and from there, via Ask shop, back
 * out to another agent. So a `cd` line or an ENOENT landing here is a leak into
 * saved work, not a cosmetic slip.
 *
 * The contract is **skip, do not sanitize**: an unsafe line is passed over and
 * the reader falls through to the next usable one, which is what the operator
 * meant to keep. A redacted half-line would look like an idea and would be
 * worse than nothing.
 *
 * No Keep UI here, no `saveState` probe — this tests the pure reader.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { lastShopLine, isUnsafeShopLine } from '../source/shared/agent-bridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, '../source/shared/agent-bridge.js'), 'utf8');

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

const GOOD = 'The preview was a dark box. That is how you post a video you have not watched.';

// --- home paths -----------------------------------------------------------

t('a cd line with a home path is never returned', () => {
  const out = lastShopLine('$ cd /Users/roymcgregor/My Drive/Antigravity/poststage-workspace');
  eq(out, '', 'returned the path');
});

t('a stack trace or ENOENT with a home path is never returned', () => {
  for (const line of [
    'Error: ENOENT: no such file or directory, open /Users/roymcgregor/Library/x.pem',
    '    at Module._compile (/Users/roymcgregor/proj/node_modules/thing.js:12:9)',
    'cannot read C:\\Users\\roy\\Documents\\notes.txt'
  ]) {
    eq(lastShopLine(line), '', `returned: ${line}`);
  }
});

t('cloud-synced roots are treated as home paths', () => {
  for (const line of [
    '/Users/roymcgregor/Library/CloudStorage/GoogleDrive-someone@example.com/x',
    'saved to ~/OneDrive/Work/deck.key with no errors at all',
    'syncing Dropbox/Shared/campaign assets folder now please'
  ]) {
    eq(lastShopLine(line), '', `returned: ${line}`);
  }
});

t('a tilde or dot-relative path is skipped; a file url too', () => {
  eq(lastShopLine('writing to ~/Library/poststage/output.log now'), '', 'tilde path');
  eq(lastShopLine('open ./certs/localhost.pem before you start'), '', 'dot path');
  eq(lastShopLine('load ../.env.local before the pane boots up'), '', 'dotdot path');
  eq(lastShopLine('open file:///etc/hosts to see the mapping'), '', 'file url');
});

t('a slash in shop copy is kept — it is not a path', () => {
  const spaced = 'cut the second sentence / keep the hook';
  eq(lastShopLine(spaced), spaced, 'slash with spaces');
  const tight = 'make the hook /snappier and cut the CTA';
  eq(lastShopLine(tight), tight, 'tight /word aside');
});

// --- addresses and secrets ------------------------------------------------

t('an email address is never returned', () => {
  for (const line of [
    'contact jayson.m.y@gmail.com for access to the board',
    'from: someone.else@example.co.uk — asking about the clip'
  ]) {
    eq(lastShopLine(line), '', `returned: ${line}`);
  }
});

t('a named secret is never returned', () => {
  for (const line of [
    'export API_KEY=abc123def456ghi789jkl',
    'Authorization: Bearer abcdefghijklmnop',
    'set the password to hunter2hunter2 before you start',
    'TOKEN is stored in the shell profile already'
  ]) {
    eq(lastShopLine(line), '', `returned: ${line}`);
  }
});

t('a key-shaped string is never returned', () => {
  for (const line of [
    'the key is sk-live-abcdefgh12345678 do not share',
    'use ghp_AbCdEfGh12345678 for the checkout step',
    'slack hook xoxb-1234567890-abcdefghij right here'
  ]) {
    eq(lastShopLine(line), '', `returned: ${line}`);
  }
});

// --- skip, do not sanitize ------------------------------------------------

t('an unsafe line is skipped and the next usable line is returned', () => {
  const pane = [
    GOOD,
    '$ cd /Users/roymcgregor/My Drive/Antigravity'
  ].join('\n');
  eq(lastShopLine(pane), GOOD, 'fell through to the real line');
});

t('several unsafe lines in a row are all skipped', () => {
  const pane = [
    GOOD,
    'export API_KEY=abc123def456ghi789jkl',
    'Error: ENOENT, open /Users/roymcgregor/x.pem',
    'contact jayson.m.y@gmail.com for access to it',
    '❯ npm start'
  ].join('\n');
  eq(lastShopLine(pane), GOOD, 'walked back past all of them');
});

t('the returned line is never a redacted fragment', () => {
  const out = lastShopLine('$ cd /Users/roymcgregor/My Drive/Antigravity');
  ok(!out.includes('<path>'), 'sanitized rather than skipped');
  ok(!out.includes('cd'), 'returned a mangled remnant');
  eq(out, '', 'empty is the right answer');
});

t('a pane of nothing but unsafe lines returns empty', () => {
  const pane = [
    '$ cd /Users/roymcgregor/proj',
    'export TOKEN=abcdefghijklmnop',
    'jayson.m.y@gmail.com'
  ].join('\n');
  eq(lastShopLine(pane), '', 'no fallback to a bad line');
});

// --- ordinary lines still work -------------------------------------------

t('a normal shop line is still returned', () => {
  eq(lastShopLine(GOOD), GOOD, 'clean line kept');
});

t('the old skips still apply', () => {
  eq(lastShopLine('❯ npm run test:store'), '', 'prompt');
  eq(lastShopLine('│────────────────────│'), '', 'box art');
  eq(lastShopLine('short'), '', 'under the length floor');
  eq(lastShopLine(''), '', 'empty input');
  eq(lastShopLine(null), '', 'null input');
});

t('a line mentioning a post about paths is not caught by accident', () => {
  // "path" as a word is fine; only path-shaped text is unsafe.
  const line = 'Every hook needs a path from the promise to the payoff, not a detour.';
  eq(lastShopLine(line), line, 'false positive on the word path');
});

t('a url in a post line is kept — it is not a filesystem path', () => {
  const line = 'Read https://x.com/Jayson_X/status/2087952991638716610 before you reply';
  eq(lastShopLine(line), line, 'https url dropped');
});

// --- the guard itself -----------------------------------------------------

t('isUnsafeShopLine is exported and agrees with the reader', () => {
  ok(isUnsafeShopLine('$ cd /Users/me/x'), 'flags a home path');
  ok(!isUnsafeShopLine(GOOD), 'clean line is safe');
  ok(!isUnsafeShopLine(''), 'empty is safe');
  ok(!isUnsafeShopLine(null), 'null is safe');
});

t('the reader skips rather than rewrites', () => {
  const fn = SRC.slice(SRC.indexOf('export function lastShopLine('));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  ok(/continue;/.test(body), 'skips via continue');
  ok(!/replace\(|scrubPaths|<path>/.test(body), 'rewrites the line instead of skipping');
});

t('no saveState or Keep UI is touched from this module', () => {
  ok(!/saveState|persist\(|document\./.test(SRC), 'agent-bridge reaches into the store or DOM');
});

console.log(failed ? `\n${failed} FAILED` : '\nall keep sit tests pass');
process.exit(failed ? 1 : 0);
