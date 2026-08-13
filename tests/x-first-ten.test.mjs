/**
 * X practices: no timing claims. Run: node tests/x-first-ten.test.mjs
 *
 * "Reply to the first ten" and "replies within the first hour" are folklore.
 * Nothing in the published mixer weights prices *earliness* — the boost the old
 * line was reaching for is **+15 for a reply between people who follow each
 * other**, which is about the relationship, not the clock.
 *
 * The distinction matters because a timing claim reads as a rank instruction:
 * do this fast and the model rewards you. Saying that without a weight behind
 * it is exactly the folklore this playbook was rewritten to remove.
 *
 * Being a good host in your replies is still good advice. It is manners, and
 * the copy should say so rather than dress it as ranking.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { interactionsFor, effectsFor } from '../source/shared/playbook.js';

const here = dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_SRC = readFileSync(resolve(here, '../source/shared/playbook.js'), 'utf8');

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

const x = interactionsFor('x');
const practices = x.practices.join(' | ');
const expect = x.expect.join(' | ');
const effects = effectsFor('x').map((e) => `${e.action} ${e.effect}`).join(' | ');
const all = [practices, expect, effects].join(' | ');

// --- no earliness claim ---------------------------------------------------

t('practices do not tell the operator to reply to the first N', () => {
  ok(!/first ten|first 10|first five|first 5|first three|first few/i.test(practices),
    `a first-N instruction survives: ${practices}`);
});

t('nothing anywhere claims a first-hour or first-minutes window', () => {
  ok(!/first hour|first 60|first minutes|first few minutes|golden hour/i.test(all),
    `a timing window appears: ${all}`);
});

t('no line prices speed, earliness or being quick', () => {
  ok(!/\bearly\b|\bearliness\b|\bquickly\b|\bfast\b|\bimmediately\b|\bwithin \d/i.test(all),
    `speed language appears: ${all}`);
});

t('no clock or elapsed-time instruction at all', () => {
  // 48h AgeFilter is real but is not a reader action and is not claimed here.
  ok(!/\b\d+\s*(hours?|hrs?|minutes?|mins?)\b/i.test(all), `a time window appears: ${all}`);
});

// --- what replaced it is supported by the weights ------------------------

t('the reply practice points at mutuals, which is what the boost is for', () => {
  ok(/follow each other|mutual/i.test(practices),
    `the reply line does not mention the relationship: ${practices}`);
});

t('the reply advice is still about being a host, not gaming a number', () => {
  ok(/host|guest/i.test(practices), `the manners half was lost: ${practices}`);
  ok(!/\+?15\b|\bboost\b.*\d|\bweight\s*\d/i.test(practices), 'a weight number leaked into the copy');
});

t('replies are still named as a conversation signal', () => {
  ok(/repl(y|ies)/i.test(expect) || /repl(y|ies)/i.test(effects), 'replies vanished from the rail');
});

// --- the other overstatement my audit flagged ---------------------------

t('likes are not claimed to be the least weighted thing in the model', () => {
  // Dwell (0.004) and video view (0.05) both sit below like (0.5). "Worth
  // least" full stop was wrong; "worth least of the actions a reader chooses"
  // is the honest form, and matches what the effects list already says.
  const bare = /worth least(?!\s+of the actions)/i.test(expect);
  ok(!bare, `unqualified "worth least" survives: ${expect}`);
});

t('the effects list keeps its honest hedge about likes', () => {
  const like = effectsFor('x').find((e) => /^like$/i.test(e.action));
  ok(like, 'a like row exists');
  ok(/among the least|cheapest/i.test(like.effect), `hedge lost: ${like.effect}`);
});

// --- still not a rank ----------------------------------------------------

t('no weight number is rendered to the operator', () => {
  ok(!/\b20\b|\b0\.5\b|\b0\.05\b|\b15\b/.test(all), `a weight leaked into copy: ${all}`);
});

t('no rank or scoring vocabulary in the copy', () => {
  ok(!/\bscore\b|\brank\b|\bsum\b|predicted|probability/i.test(all), 'rank language in the copy');
});

t('the playbook still cites the source and computes nothing', () => {
  ok(/home-mixer\/params\/param\.rs/.test(PLAYBOOK_SRC), 'param.rs citation lost');
  ok(!/Σ|reduce\(|\*\s*weight|weight\s*\*/i.test(PLAYBOOK_SRC), 'playbook computes with weights');
});

console.log(failed ? `\n${failed} FAILED` : '\nall x first-ten tests pass');
process.exit(failed ? 1 : 0);
