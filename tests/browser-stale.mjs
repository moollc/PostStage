/**
 * Browser path: a persistable linked clip must not pretend /image will seek
 * when the process on 7744 does not handle that route. Probe uses a dummy
 * path, never the real clip. Hint has no home path.
 * Attaches to http://127.0.0.1:7744 only — does not spawn or kill the launcher.
 * Run: npm run test:browser-stale
 */

import http from 'http';
import { chromium } from 'playwright';
import {
  IMAGE_ROUTE_PROBE,
  mediaSrcForPath,
  imageRouteFromHealth,
  imageRouteFromProbe
} from '../source/shared/media-link.js';

const ORIGIN = 'http://127.0.0.1:7744';
const LINK_PATH = 'tests/tiny-x.webm';
const LINK_HREF = '/image?path=' + encodeURIComponent(LINK_PATH);
const LEAK = /Users|GoogleDrive|(^|\/)home(\/|$)|tiny-x|__poststage|tests\//i;

function originAnswers(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function request(method, urlPath, extraHeaders = {}) {
  return new Promise((resolve) => {
    const req = http.request(`${ORIGIN}${urlPath}`, {
      method,
      headers: extraHeaders,
      timeout: 3000
    }, (res) => {
      const headers = res.headers;
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers }));
    });
    req.on('error', () => resolve({ status: 0, headers: {} }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, headers: {} });
    });
    req.end();
  });
}

function fail(msg) {
  console.log('FAIL  ' + msg);
  process.exit(1);
}

if (!(await originAnswers(ORIGIN))) {
  fail(
    `${ORIGIN} did not answer — start the launcher yourself. This test will not spawn one and will not kill 7744.`
  );
}

let live = false;
try {
  const health = await new Promise((resolve, reject) => {
    const req = http.get(`${ORIGIN}/api/health`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
  live = imageRouteFromHealth(health);
} catch { /* probe the route */ }

if (!live) {
  let r = await request('HEAD', mediaSrcForPath(IMAGE_ROUTE_PROBE), { Range: 'bytes=0-0' });
  if (r.status === 405 || r.status === 501 || r.status === 0) {
    r = await request('GET', mediaSrcForPath(IMAGE_ROUTE_PROBE), { Range: 'bytes=0-0' });
  }
  live = imageRouteFromProbe(r.status, {
    'content-type': r.headers['content-type'] || '',
    'accept-ranges': r.headers['accept-ranges'] || ''
  });
}

if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(IMAGE_ROUTE_PROBE) || /Users|GoogleDrive|(^|\/)home(\/|$)/i.test(mediaSrcForPath(IMAGE_ROUTE_PROBE))) {
  fail('probe URL leaked a home path');
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  const hint = /Executable doesn't exist|browserType\.launch/i.test(String(err && err.message))
    ? ' — try: npx playwright install chromium'
    : '';
  fail(`Playwright Chromium did not launch${hint}\n        ${err.message}`);
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await page.goto(ORIGIN, {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  if (!res || !res.ok()) {
    fail(`GET ${ORIGIN} → HTTP ${res ? res.status() : 'fail'}`);
  }

  await page.waitForSelector('.preview .media-slot', {
    timeout: 15000,
    state: 'attached'
  });

  const prev = await page.evaluate(() => localStorage.getItem('poststage.v2'));
  await page.evaluate(({ path, href }) => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : { posts: [], activeId: '' };
    if (!Array.isArray(board.posts) || !board.posts.length) {
      board.posts = [{
        id: 'stale-probe',
        title: 'Stale probe',
        hook: '',
        body: '',
        cta: '',
        hashtags: [],
        media: [],
        ideas: [],
        platform: 'x',
        status: 'draft'
      }];
      board.activeId = 'stale-probe';
    }
    const active = board.posts.find((p) => p.id === board.activeId) || board.posts[0];
    active.media = [{
      name: 'tiny-x.webm',
      type: 'video/webm',
      path,
      href,
      url: href,
      session: false
    }];
    localStorage.setItem('poststage.v2', JSON.stringify(board));
  }, { path: LINK_PATH, href: LINK_HREF });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.stage-card .preview video.media-vid', {
    timeout: 15000,
    state: 'attached'
  });

  const stale = page.locator('.stage-card .preview .media-stale');
  const linked = page.locator('.stage-card .preview .media-linked');

  if (live) {
    if (await stale.count()) {
      fail('live /image still painted the stale-launcher hint');
    }
    if (!(await linked.count())) {
      fail('live /image had a persistable clip but no Linked clip mark');
    }
    console.log('ok    live /image: Linked clip, no stale hint');
  } else {
    await stale.waitFor({ state: 'visible', timeout: 8000 });
    const text = String(await stale.first().textContent() || '').trim();
    if (!text) fail('stale hint was empty');
    if (LEAK.test(text)) fail(`stale hint leaked a path: ${JSON.stringify(text)}`);
    if (await linked.count()) {
      fail('dead /image still painted Linked clip');
    }
    console.log('ok    dead /image: stage admits the linked clip will not play after refresh; no home path');
  }

  await page.evaluate((raw) => {
    if (raw) localStorage.setItem('poststage.v2', raw);
    else localStorage.removeItem('poststage.v2');
  }, prev);
} finally {
  await browser.close();
}

process.exit(0);
