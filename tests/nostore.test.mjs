/**
 * Cache-Control no-store tests. Run: node tests/nostore.test.mjs
 *
 * The app's own source must not stick in the service worker cache — editing
 * CSS while the canvas runs should not require a hard refresh.
 *
 * `launcher.js` boots a server on import, so `cacheControlFor` is extracted
 * from source and run in isolation. It is a pure function, so this is the real
 * implementation rather than a re-statement of it.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, extname } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = resolve(here, '../build/scripts/launcher.js');
const src = readFileSync(LAUNCHER, 'utf8');

/** Pull a named function plus its adjacent const out of the launcher source. */
function extract(name, deps = {}) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (!depth) {
        const keys = Object.keys(deps);
        return new Function(...keys, `${src.slice(start, i + 1)}; return ${name};`)(...keys.map((k) => deps[k]));
      }
    }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}

const NO_STORE_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map']);
const cacheControlFor = extract('cacheControlFor', { extname, NO_STORE_EXT });

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
  if (a !== b) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

// --- the app's own source is no-store ------------------------------------

t('html, js, css and json are no-store', () => {
  for (const f of [
    '/x/index.html', '/x/404.html',
    '/x/source/app/index.js', '/x/source/shared/store.mjs',
    '/x/source/app/style.css',
    '/x/source/assets/data/platforms.json',
    '/x/build/out.map'
  ]) {
    eq(cacheControlFor(f), 'no-store', f);
  }
});

t('extension matching is case-insensitive', () => {
  eq(cacheControlFor('/x/INDEX.HTML'), 'no-store', 'uppercase html');
  eq(cacheControlFor('/x/Style.CSS'), 'no-store', 'mixed css');
});

// --- media is deliberately left alone ------------------------------------

t('media does not get no-store', () => {
  // /image serves Range for video; no-store would refetch on every seek.
  for (const f of ['/x/clip.mp4', '/x/clip.webm', '/x/still.png', '/x/still.jpg', '/x/still.webp', '/x/icon.svg']) {
    eq(cacheControlFor(f), '', f);
  }
});

t('fonts and wasm are left alone', () => {
  eq(cacheControlFor('/x/font.woff2'), '', 'font');
  eq(cacheControlFor('/x/score.wasm'), '', 'wasm');
});

t('an unknown extension is left alone rather than guessed at', () => {
  eq(cacheControlFor('/x/README'), '', 'no extension');
  eq(cacheControlFor('/x/thing.xyz'), '', 'unknown ext');
});

t('junk input does not throw', () => {
  eq(cacheControlFor(null), '', 'null');
  eq(cacheControlFor(undefined), '', 'undefined');
  eq(cacheControlFor(''), '', 'empty');
  eq(cacheControlFor(42), '', 'number');
});

// --- the wiring, read from source ----------------------------------------

t('the static handler sets the header from the helper', () => {
  ok(/const cache = cacheControlFor\(filePath\);/.test(src), 'helper is called on the static path');
  ok(/if \(cache\) res\.setHeader\('Cache-Control', cache\);/.test(src), 'header set when non-empty');
});

t('the service worker route is explicitly no-store', () => {
  const swBlock = src.slice(src.indexOf("url.pathname === '/service-worker.js'"), src.indexOf("const rel = url.pathname === '/'"));
  ok(/res\.setHeader\('Cache-Control', 'no-store'\)/.test(swBlock), 'sw sends no-store');
});

t('the /image range path is untouched', () => {
  // The brief says do not change /image range. Assert no Cache-Control was
  // added anywhere near the range branch.
  const rangeStart = src.indexOf("res.setHeader('Accept-Ranges', 'bytes')");
  ok(rangeStart > 0, 'range handler still present');
  const rangeBlock = src.slice(rangeStart, rangeStart + 1200);
  ok(!/Cache-Control/.test(rangeBlock), 'no Cache-Control added to the range path');
  ok(/206/.test(rangeBlock) || /parseByteRange/.test(rangeBlock), 'range logic intact');
});

console.log(failed ? `\n${failed} FAILED` : '\nall no-store tests pass');
process.exit(failed ? 1 : 0);
