/**
 * X playbook tests. Run: node tests/x-playbook.test.mjs
 *
 * The X guidance is read from published defaults in xai-org/x-algorithm
 * (`home-mixer/params/param.rs`, Apache-2.0) rather than folklore. What these
 * tests hold to:
 *
 *   - copy-link, reply and quote appear before like
 *   - the source file is cited in a comment
 *   - it is guidance, not a rank — no weights, no sums, no predicted numbers
 *   - none of it reaches the scorer
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { interactionsFor, effectsFor } from '../source/shared/playbook.js';

const here = dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_SRC = readFileSync(resolve(here, '../source/shared/playbook.js'), 'utf8');
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
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}
function eq(a, b, msg) {
  if (String(a) !== String(b)) throw new Error(`${msg || 'not equal'}: ${a} !== ${b}`);
}

const xEffects = effectsFor('x');
const xText = xEffects.map((e) => `${e.action} ${e.effect}`).join(' | ').toLowerCase();
const idx = (re) => xText.search(re);

// --- ordering: the weights, not the folklore -----------------------------

t('copy-link appears before like', () => {
  const copy = idx(/copy-link/);
  const like = idx(/\blike\b/);
  ok(copy >= 0, 'copy-link is mentioned at all');
  ok(like >= 0, 'like is mentioned at all');
  ok(copy < like, `copy-link (${copy}) must come before like (${like})`);
});

t('reply and quote appear before like', () => {
  const reply = idx(/\breply\b/);
  const quote = idx(/quote/);
  const like = idx(/\blike\b/);
  ok(reply >= 0 && reply < like, `reply (${reply}) before like (${like})`);
  ok(quote >= 0 && quote < like, `quote (${quote}) before like (${like})`);
});

t('copy-link is the first effect listed', () => {
  ok(/copy-link/i.test(xEffects[0].action), `first action was ${JSON.stringify(xEffects[0].action)}`);
});

t('like is described as cheap, not as a win', () => {
  const like = xEffects.find((e) => /^like$/i.test(e.action));
  ok(like, 'a like row exists');
  ok(/cheap|least|poor/i.test(like.effect), `like effect was ${JSON.stringify(like.effect)}`);
});

t('the old folklore is gone', () => {
  // Bookmarks were the previous top-billed X action and are not in the weights.
  ok(!/bookmark/i.test(xText), 'bookmark still billed as an X effect');
  const expect = interactionsFor('x').expect.join(' ').toLowerCase();
  ok(!/bookmark for later reference/.test(expect), 'old expect line survives');
});

// --- expect and practices follow the same reading ------------------------

t('expect mentions copy-link sharing before likes', () => {
  const line = interactionsFor('x').expect.join(' | ').toLowerCase();
  const copy = line.search(/copy-link/);
  const like = line.search(/\blike/);
  ok(copy >= 0, 'copy-link in expect');
  ok(like < 0 || copy < like, 'copy-link precedes likes');
});

t('practices tell the operator to write something worth pasting', () => {
  const lines = interactionsFor('x').practices.join(' | ').toLowerCase();
  ok(/dm|paste|copy/.test(lines), 'no line about pasting or DMs');
});

t('the ten-second video floor is stated as a floor, not a target', () => {
  const all = (interactionsFor('x').practices.join(' ') + ' ' + xText).toLowerCase();
  ok(/ten second|10s|duration floor/.test(all), 'video duration floor not mentioned');
});

// --- provenance -----------------------------------------------------------

t('the source file is cited in a comment', () => {
  ok(/home-mixer\/params\/param\.rs/.test(PLAYBOOK_SRC), 'param.rs not cited');
  ok(/x-algorithm/.test(PLAYBOOK_SRC), 'repo not named');
  ok(/Apache-2\.0/.test(PLAYBOOK_SRC), 'licence not noted');
});

// --- guidance, not a rank -------------------------------------------------

t('no weight number is rendered to the operator', () => {
  // The comment may carry the numbers as provenance; the strings must not.
  const shown = [
    ...xEffects.map((e) => `${e.action} ${e.effect}`),
    ...interactionsFor('x').expect,
    ...interactionsFor('x').practices
  ].join(' | ');
  ok(!/\b20\b|\b0\.5\b|\b0\.05\b|\bweight\s*\d/i.test(shown), `a weight leaked into copy: ${shown}`);
});

t('nothing sums, ranks or predicts', () => {
  const shown = xEffects.map((e) => e.effect).join(' ').toLowerCase();
  ok(!/score|rank|\bsum\b|predicted|probability|final score/.test(shown), 'rank language in the copy');
  // And the module itself does no arithmetic on weights.
  ok(!/Σ|reduce\(|\* *weight|weight *\*/i.test(PLAYBOOK_SRC), 'playbook computes with weights');
});

t('the effects list is descriptive strings only', () => {
  for (const e of xEffects) {
    eq(typeof e.action, 'string', 'action is a string');
    eq(typeof e.effect, 'string', 'effect is a string');
    ok(Object.keys(e).sort().join(',') === 'action,effect', `extra key on ${e.action}`);
  }
});

// --- and none of it reaches the heuristic --------------------------------

t('the scorer does not import the playbook effects', () => {
  ok(!/effectsFor|INTERACTIONS|EFFECTS/.test(SCORE_SRC), 'score.js references playbook effects');
});

t('score.js carries no X weight vocabulary', () => {
  ok(!/copy-link|param\.rs|home-mixer|x-algorithm/i.test(SCORE_SRC), 'weights leaked into the scorer');
});

t('other platforms are untouched by this slice', () => {
  for (const id of ['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook']) {
    const eff = effectsFor(id);
    ok(Array.isArray(eff) && eff.length > 0, `${id} still has effects`);
    ok(!/param\.rs|copy-link share/i.test(eff.map((e) => e.effect).join(' ')), `${id} picked up X weights`);
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nall x playbook tests pass');
process.exit(failed ? 1 : 0);
