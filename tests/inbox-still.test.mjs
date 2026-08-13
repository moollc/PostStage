/**
 * Inbox still tests. Run: node tests/inbox-still.test.mjs
 *
 * US-P1: an inbox post may carry a persistable still — a data-URL image under
 * budget, or a launcher `/image?path=` ref. No video ingest, no home paths, no
 * blob urls.
 *
 * `launcher.js` starts a server on import, so `persistableInboxMedia` is
 * extracted from source and run in isolation. `inboxStill` (the client's second
 * gate) is extracted the same way from `index.js`, which is a browser module.
 * Both are pure functions, so this is exact rather than a re-implementation.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { isSafeRelPath, mediaSrcForPath } from '../source/shared/media-link.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Pull one named function's source out of a module and make it callable. */
function extract(file, name, deps = {}) {
  const src = readFileSync(resolve(here, file), 'utf8');
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (!depth) {
        const body = src.slice(start, i + 1);
        const keys = Object.keys(deps);
        return new Function(...keys, `${body}; return ${name};`)(...keys.map((k) => deps[k]));
      }
    }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}

const MAX = 900000;
const persistableInboxMedia = extract('../build/scripts/launcher.js', 'persistableInboxMedia', {
  isSafeRelPath,
  INBOX_DATA_URL_MAX: MAX
});
const inboxStill = extract('../source/app/index.js', 'inboxStill', {
  isSafeRelPath,
  mediaSrcForPath
});

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

const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const HOME = '/Users/someone/Pictures/private.png';

// --- what the launcher accepts -------------------------------------------

t('a small data-URL image is accepted', () => {
  const out = persistableInboxMedia([{ name: 'still.png', type: 'image/png', url: DATA_PNG }]);
  eq(out.length, 1, 'kept');
  eq(out[0].url, DATA_PNG, 'url preserved');
  eq(out[0].name, 'still.png', 'name preserved');
});

t('a project-relative path becomes a /image?path= href', () => {
  const out = persistableInboxMedia([{ path: 'source/assets/images/icon.svg' }]);
  eq(out.length, 1, 'kept');
  eq(out[0].path, 'source/assets/images/icon.svg', 'path preserved');
  ok(out[0].href.startsWith('/image?path='), 'href is a launcher ref');
  ok(!out[0].href.includes('/Users/'), 'href carries no home path');
});

// --- what it rejects ------------------------------------------------------

t('a home path is rejected', () => {
  eq(persistableInboxMedia([{ path: HOME }]), [], 'absolute posix path');
  eq(persistableInboxMedia([{ path: 'C:\\Users\\me\\x.png' }]), [], 'windows path');
  eq(persistableInboxMedia([{ path: '../../etc/passwd' }]), [], 'traversal');
  eq(persistableInboxMedia([{ url: 'file:///Users/me/x.png' }]), [], 'file url');
});

t('a blob url is rejected', () => {
  eq(persistableInboxMedia([{ url: 'blob:http://127.0.0.1:7744/dead' }]), [], 'blob dropped');
});

t('data:video is rejected — no video ingest', () => {
  eq(persistableInboxMedia([{ url: 'data:video/mp4;base64,AAAA' }]), [], 'data:video');
  eq(persistableInboxMedia([{ type: 'video/mp4', url: DATA_PNG }]), [], 'video type');
  eq(persistableInboxMedia([{ path: 'clips/reel.mp4' }]), [], 'mp4 path');
  eq(persistableInboxMedia([{ path: 'clips/reel.webm' }]), [], 'webm path');
});

t('an over-budget data URL is rejected', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(MAX);
  eq(persistableInboxMedia([{ url: big }]), [], 'over budget dropped');
});

t('a remote url is rejected', () => {
  eq(persistableInboxMedia([{ url: 'https://example.com/x.png' }]), [], 'https');
  eq(persistableInboxMedia([{ url: 'http://127.0.0.1:7744/x.png' }]), [], 'http');
});

t('junk never throws and never yields a row', () => {
  eq(persistableInboxMedia(null), [], 'null');
  eq(persistableInboxMedia('nope'), [], 'string');
  eq(persistableInboxMedia([null, 42, 'x', {}]), [], 'junk entries');
  eq(persistableInboxMedia([{ url: '' }, { path: '' }]), [], 'empty fields');
});

t('at most one still is carried', () => {
  const out = persistableInboxMedia([
    { url: DATA_PNG },
    { path: 'source/assets/images/icon.svg' },
    { url: DATA_PNG }
  ]);
  eq(out.length, 1, 'capped at one');
});

// --- the client's second gate --------------------------------------------

t('the client accepts what the launcher accepted', () => {
  const out = inboxStill([{ name: 'still.png', type: 'image/png', url: DATA_PNG }]);
  eq(out.length, 1, 'kept');
  eq(out[0].url, DATA_PNG, 'url');
});

t('the client turns a path into a usable src', () => {
  const out = inboxStill([{ path: 'source/assets/images/icon.svg' }]);
  eq(out.length, 1, 'kept');
  ok(out[0].url.includes('/image?path='), 'src is the launcher ref');
  eq(out[0].path, 'source/assets/images/icon.svg', 'path kept for persistence');
});

t('the client independently rejects blob, home path and video', () => {
  eq(inboxStill([{ url: 'blob:http://127.0.0.1:7744/dead' }]), [], 'blob');
  eq(inboxStill([{ path: HOME }]), [], 'home path');
  eq(inboxStill([{ url: 'data:video/mp4;base64,AAAA' }]), [], 'data:video');
  eq(inboxStill([{ type: 'video/mp4', path: 'clips/x.mp4' }]), [], 'video type');
});

t('the client is safe on junk', () => {
  eq(inboxStill(null), [], 'null');
  eq(inboxStill([]), [], 'empty');
  eq(inboxStill([null]), [], 'null entry');
  eq(inboxStill('nope'), [], 'string');
});

t('both gates agree on every fixture', () => {
  const cases = [
    { url: DATA_PNG },
    { path: 'source/assets/images/icon.svg' },
    { url: 'blob:http://x/y' },
    { path: HOME },
    { url: 'data:video/mp4;base64,AA' },
    { path: 'clips/reel.mp4' }
  ];
  for (const c of cases) {
    const launcher = persistableInboxMedia([c]).length > 0;
    const client = inboxStill(persistableInboxMedia([c])).length > 0;
    eq(client, launcher, `disagreement on ${JSON.stringify(c)}`);
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nall inbox still tests pass');
process.exit(failed ? 1 : 0);
