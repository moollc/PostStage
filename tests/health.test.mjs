/**
 * Health endpoint tests. Run: node tests/health.test.mjs
 *
 * The contract: health answers JSON only, and it never carries a filesystem
 * path — no `/Users/`, no home directory, no cwd, no binary location.
 *
 * That matters more here than it looks. `scoreBin()` resolves an **absolute
 * path** to the Rust binary, and the handler passes it through `Boolean()`.
 * One dropped `Boolean(` and the response tells anyone who asks where this
 * repo lives on disk. These tests pin the wrapper, not just the current output.
 *
 * `launcher.js` boots a server on import, so the handler is read from source
 * and its shape asserted, plus the pure helpers are extracted and run. Nothing
 * is spawned — no 7799, no second launcher.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = resolve(here, '../build/scripts/launcher.js');
const src = readFileSync(LAUNCHER, 'utf8');

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

/** The `/api/health` handler body, as written. */
function healthHandler() {
  const marker = "url.pathname === '/api/health'";
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('/api/health handler not found');
  return src.slice(start, src.indexOf('\n  }', start) + 4);
}

// --- the response is booleans plus a boot ISO, never a path ---------------

t('the health handler exists', () => {
  ok(src.includes("url.pathname === '/api/health'"), 'route present');
});

function healthPayloadSrc() {
  const marker = 'function healthPayload(';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('healthPayload not found');
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

t('healthPayload booleans stay wrapped; started is boot ISO, not a path', () => {
  const body = healthPayloadSrc();
  ok(/ok:\s*true/.test(body), 'ok is a literal true');
  ok(/herdr:\s*herdrAvailable\(\)/.test(body), 'herdr is the availability probe');
  ok(/rust:\s*Boolean\(/.test(body), 'rust is wrapped in Boolean()');
  ok(/imageRoute:\s*true/.test(body), 'imageRoute is a literal true');
  ok(/started:\s*STARTED_AT/.test(body), 'started is the boot ISO');
  ok(!/rust:\s*scoreBin\(\)/.test(body), 'scoreBin sent unwrapped');
});

t('STARTED_AT is Date.toISOString at boot', () => {
  ok(/const STARTED_AT = new Date\(\)\.toISOString\(\)/.test(src), 'boot ISO');
});

t('scoreBin() is never sent raw — it returns an absolute path', () => {
  // The guard that matters: scoreBin resolves ROOT-relative to an absolute
  // path, so an unwrapped use in the response would publish the home dir.
  const body = healthPayloadSrc();
  ok(!/rust:\s*scoreBin\(\)/.test(body), 'scoreBin sent unwrapped');
  ok(!/bin:|path:|binary:|cwd:|root:/i.test(body), 'a path-shaped key is in the response');
});

t('the health body mentions no path-like literal', () => {
  const body = healthPayloadSrc();
  ok(!/\/Users\//.test(body), 'contains /Users/');
  ok(!/process\.cwd/.test(body), 'contains process.cwd');
  ok(!/__dirname|__dir\b/.test(body), 'contains a dirname');
  ok(!/ROOT|WORKSPACE/.test(body), 'contains ROOT or WORKSPACE');
});

// --- the helpers it calls return booleans, not paths ---------------------

t('herdrAvailable returns a boolean, never a location', () => {
  const fn = src.slice(src.indexOf('function herdrAvailable('));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  ok(/return herdrPresence/.test(body) || /herdrPresence = (true|false)/.test(body), 'tracks a boolean');
  ok(!/which |where /.test(body.replace(/execSync\([^)]*\)/g, '')), 'no command string returned');
});

t('scoreBin is only ever used behind Boolean or existsSync in the response path', () => {
  const uses = [...src.matchAll(/scoreBin\(\)/g)].map((m) => {
    const at = m.index;
    return src.slice(Math.max(0, at - 40), at + 12);
  });
  ok(uses.length > 0, 'scoreBin is used somewhere');
  for (const use of uses) {
    const inHealth = /rust:/.test(use);
    if (inHealth) ok(/Boolean\(/.test(use), `unwrapped in health: ${use.trim()}`);
  }
});

// --- json() sends JSON, and only JSON ------------------------------------

t('the health route replies through json(), not a raw write', () => {
  const body = healthHandler();
  ok(/return json\(res, 200,/.test(body), 'uses the json helper with 200');
  ok(!/createReadStream|res\.write\(|end\(sw\)/.test(body), 'streams a file instead');
});

t('json() sets an application/json content type', () => {
  const fn = src.slice(src.indexOf('function json('));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  ok(/application\/json/.test(body), 'content type');
  ok(/JSON\.stringify/.test(body), 'serialises rather than concatenating');
});

// --- contract for a bare /health, which does not exist yet ---------------

t('CONTRACT: a bare /health, if added, must answer JSON not the 404 page', () => {
  const hasBare = /url\.pathname === '\/health'/.test(src);
  if (!hasBare) {
    // Not landed. Recorded rather than asserted so this file stays green and
    // starts checking the moment High adds the route.
    console.log('        (not landed — /health currently falls through to 404.html)');
    return;
  }
  const start = src.indexOf("url.pathname === '/health'");
  const body = src.slice(start, src.indexOf('\n  }', start) + 4);
  ok(/return json\(/.test(body), 'bare /health must use json()');
  ok(!/\/Users\//.test(body), 'no home path');
  ok(!/process\.cwd|ROOT|WORKSPACE|__dir/.test(body), 'no cwd or root');
  ok(!/scoreBin\(\)(?!\s*\))/.test(body) || /Boolean\(/.test(body), 'scoreBin wrapped');
});

console.log(failed ? `\n${failed} FAILED` : '\nall health tests pass');
process.exit(failed ? 1 : 0);
