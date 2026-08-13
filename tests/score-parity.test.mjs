/**
 * Cross-engine score parity. Run: node tests/score-parity.test.mjs
 *
 * The bug this exists to catch: JS and Rust agreed on every check id, every
 * `ok`, and every note string, while disagreeing on the *score* by one point
 * (`Math.round` vs integer truncation). Twenty Rust unit tests passed through
 * it, because every one of them asserted on checks rather than the number.
 *
 * So this test does the one thing those could not — runs the same post through
 * both engines and compares the integers.
 *
 * Requires the release binary:  npm run score
 * If it is missing, the run SKIPS rather than silently passing.
 */

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const BIN = resolve(ROOT, 'build/score/target/release/poststage-score');
const FIXTURES = resolve(here, 'score-fixtures.json');

if (!existsSync(BIN)) {
  console.log('SKIP  release binary not built — run `npm run score` first.');
  console.log(`      expected at ${BIN.replace(ROOT, '.')}`);
  process.exit(0);
}

/**
 * Load scorePost without its two side-imports. `platforms.js` reads a JSON file
 * over fetch and `playbook.js` only supplies a count, so we stub both and feed
 * the platform straight in — the arithmetic under test is untouched.
 */
const src = readFileSync(resolve(ROOT, 'source/shared/score.js'), 'utf8')
  .replace("import { getPlatform } from './platforms.js';", '')
  .replace("import { PARTS } from './playbook.js';", 'const PARTS = [1, 2, 3, 4, 5];')
  .replace('const platform = getPlatform(post.platform);', 'const platform = post.__platform;');
const { scorePost } = await import('data:text/javascript,' + encodeURIComponent(src));

const { cases } = JSON.parse(readFileSync(FIXTURES, 'utf8'));

/** The fixture's flat payload is the Rust CLI's input shape. */
function runRust(payload) {
  const out = execFileSync(BIN, { input: JSON.stringify(payload), encoding: 'utf8' });
  return JSON.parse(out);
}

/** Reshape the same fixture into what scorePost expects. */
function runJs(p) {
  return scorePost({
    hook: p.hook,
    body: p.body,
    cta: p.cta,
    hashtags: Array.from({ length: p.tag_count }, (_, i) => 't' + i),
    media: Array.from({ length: p.media_count }, () => ({ url: 'x' })),
    platform: p.platform,
    __platform: {
      id: p.platform,
      label: p.platform_label,
      maxChars: p.max_chars,
      bestForm: p.has_best_form ? p.best_form || 'a form' : ''
    }
  });
}

let failed = 0;
const fail = (name, msg) => { failed++; console.log(`FAIL  ${name}\n        ${msg}`); };

for (const c of cases) {
  const js = runJs(c.post);
  const rust = runRust(c.post);
  const problems = [];

  // The heart of it: the two engines must produce the same integer.
  if (js.score !== rust.score) {
    problems.push(`score: js ${js.score} vs rust ${rust.score} — the engines disagree on the number`);
  }
  if (js.band !== rust.band) {
    problems.push(`band: js "${js.band}" vs rust "${rust.band}"`);
  }

  // And the fixture pins the expected value, so a matching pair that both
  // drifted still fails.
  if (js.score !== c.score) problems.push(`js score ${js.score}, fixture expects ${c.score}`);
  if (rust.score !== c.score) problems.push(`rust score ${rust.score}, fixture expects ${c.score}`);
  if (js.band !== c.band) problems.push(`js band "${js.band}", fixture expects "${c.band}"`);

  // Checks must still line up id-for-id and ok-for-ok.
  const jsIds = js.checks.map((x) => x.id).join(',');
  const ruIds = rust.checks.map((x) => x.id).join(',');
  if (jsIds !== ruIds) problems.push(`check ids differ:\n          js   ${jsIds}\n          rust ${ruIds}`);

  const jsOk = js.checks.map((x) => `${x.id}=${x.ok}`).join(' ');
  const ruOk = rust.checks.map((x) => `${x.id}=${x.ok}`).join(' ');
  if (jsOk !== ruOk) problems.push(`check results differ:\n          js   ${jsOk}\n          rust ${ruOk}`);

  const jsPassed = js.checks.filter((x) => x.ok).length;
  if (jsPassed !== c.passed) problems.push(`${jsPassed} checks passed, fixture expects ${c.passed}`);

  // Notes are user-visible copy and must match too.
  for (let i = 0; i < js.checks.length; i++) {
    const a = js.checks[i];
    const b = rust.checks[i];
    if (b && a.note !== b.note) {
      problems.push(`note for "${a.id}" differs:\n          js   ${JSON.stringify(a.note)}\n          rust ${JSON.stringify(b.note)}`);
    }
  }

  // The score is a heuristic over the checks and nothing else.
  if ('outcome' in rust || 'outcome' in js) {
    problems.push('an engine surfaced `outcome` — post outcomes must not feed the score');
  }

  if (problems.length) fail(c.name, problems.join('\n        '));
  else console.log(`ok    ${c.name} · ${js.score} ${js.band} (${c.passed}/8)`);
}

// A guard on the arithmetic itself, independent of any fixture: for every
// possible number of passing checks, both engines must round the same way.
console.log('');
for (let passed = 0; passed <= 8; passed++) {
  const expected = Math.round((passed / 8) * 100);
  const post = {
    hook: passed >= 1 ? 'A perfectly fine hook' : '',
    body: passed >= 2 ? 'A long enough body to keep a stranger reading past the first line.' : '',
    cta: passed >= 3 ? 'Tell me what broke' : 'Click here',
    tag_count: 0,
    media_count: 1,
    platform: 'x',
    platform_label: 'X',
    max_chars: 280,
    has_best_form: true,
    best_form: 'Short claim'
  };
  const rust = runRust(post);
  const js = runJs(post);
  if (js.score !== rust.score) {
    fail(`rounding at ${passed}/8`, `js ${js.score} vs rust ${rust.score}`);
  }
  const n = js.checks.filter((c) => c.ok).length;
  if (Math.round((n / 8) * 100) !== js.score) {
    fail(`rounding at ${passed}/8`, `js score ${js.score} is not Math.round for ${n}/8`);
  }
}
console.log('ok    both engines round identically across every 0/8..8/8 outcome');

console.log(failed ? `\n${failed} FAILED` : '\nJS and Rust agree on every fixture');
process.exit(failed ? 1 : 0);
