/**
 * Browser path: a dead /api/guest-scan must not become a snapshot.
 * 200 HTML 404 → "scan will not run until the launcher is restarted".
 * Last snapshot stays. Probe uses a dummy, never the live href.
 * Attaches to http://127.0.0.1:7744 only — does not spawn or kill the launcher.
 * Run: npm run test:browser-scan-stale
 */

import http from 'http';
import { chromium } from 'playwright';
import { W1_POST_ID, W1_PUBLISHED_URL } from '../source/shared/published-url.js';
import {
  GUEST_SCAN_PROBE,
  STALE_SCAN_HINT,
  guestScanRouteFromHealth,
  guestScanRouteFromProbe
} from '../source/shared/scan-stale.js';

const ORIGIN = 'http://127.0.0.1:7744';
const SNAP = {
  at: '2026-08-13T20:00:00.000Z',
  title: "You wouldn't post a video you haven't watched, right?",
  text: 'Slop Makers: BoxxyVid'
};
const LEAK = /Users|GoogleDrive|(^|\/)home(\/|$)/i;

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

function postProbe() {
  return new Promise((resolve) => {
    const data = JSON.stringify({ url: GUEST_SCAN_PROBE });
    const req = http.request(`${ORIGIN}/api/guest-scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 4000
    }, (res) => {
      const type = res.headers['content-type'] || '';
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, type, raw }));
    });
    req.on('error', () => resolve({ status: 0, type: '', raw: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, type: '', raw: '' });
    });
    req.end(data);
  });
}

function getHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${ORIGIN}/api/health`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.on('timeout', () => {
      req.destroy();
      resolve({});
    });
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

const health = await getHealth();
let live = guestScanRouteFromHealth(health);
if (!live) {
  const probe = await postProbe();
  live = guestScanRouteFromProbe(probe.status, { 'content-type': probe.type });
  if (!live && /json/i.test(probe.type)) live = true;
  if (LEAK.test(probe.raw)) fail(`probe response leaked a home path`);
  if (probe.raw.includes(W1_PUBLISHED_URL)) fail('probe response echoed the operator href');
}

if (live) {
  console.log('ok    7744 guest-scan route is live — stale hint not expected; snapshot path stays identity-only');
  process.exit(0);
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
  const leaked = [];
  const scanPosts = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|fxtwitter\.com)\b/i.test(u)) leaked.push(u);
    if (u.includes('/api/guest-scan')) {
      scanPosts.push(req.postData() || '');
    }
  });

  const res = await page.goto(ORIGIN, {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  if (!res || !res.ok()) {
    fail(`GET ${ORIGIN} → HTTP ${res ? res.status() : 'fail'}`);
  }

  await page.waitForSelector('#f-published-url', { timeout: 15000 });

  await page.evaluate(({ id, url, snap }) => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : { posts: [], activeId: '' };
    if (!Array.isArray(board.posts)) board.posts = [];
    let post = board.posts.find((p) => p.id === id)
      || board.posts.find((p) => p.id === board.activeId)
      || board.posts[0];
    if (!post) {
      post = {
        id,
        title: 'W1',
        publishedUrl: url,
        guestScan: snap,
        ideas: [],
        media: [],
        platform: 'x',
        status: 'draft'
      };
      board.posts = [post];
      board.activeId = id;
    } else {
      post.publishedUrl = url;
      post.guestScan = snap;
      board.activeId = post.id;
    }
    localStorage.setItem('poststage.v2', JSON.stringify(board));
  }, { id: W1_POST_ID, url: W1_PUBLISHED_URL, snap: SNAP });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#guest-scan-hint', { timeout: 15000 });

  await page.waitForFunction((want) => {
    const el = document.getElementById('guest-scan-hint');
    return Boolean(el && !el.hidden && el.textContent === want);
  }, STALE_SCAN_HINT, { timeout: 10000 });

  const hint = String(await page.locator('#guest-scan-hint').textContent() || '');
  if (hint !== STALE_SCAN_HINT) fail(`hint was ${JSON.stringify(hint)}`);
  if (LEAK.test(hint)) fail(`hint leaked a home path: ${JSON.stringify(hint)}`);
  if (/Not found/i.test(hint)) fail('hint used the 404 page title as a snapshot');
  if (!await page.locator('#guest-scan-hint').evaluate((el) => el.classList.contains('guest-scan-stale'))) {
    fail('hint missing .guest-scan-stale');
  }

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : null;
    const active = board && board.posts && (board.posts.find((p) => p.id === board.activeId) || board.posts[0]);
    return active && active.guestScan;
  });
  if (!stored || stored.title !== SNAP.title || stored.text !== SNAP.text) {
    fail(`dead route faked or cleared the snapshot: ${JSON.stringify(stored)}`);
  }
  if (Object.keys(stored).some((k) => /view|like|reply|quote|html|count/i.test(k))) {
    fail(`stored guestScan grew extra keys: ${JSON.stringify(Object.keys(stored))}`);
  }

  if (await page.locator('#btn-guest-scan').isEnabled()) {
    fail('#btn-guest-scan was enabled on a dead route');
  }

  for (const body of scanPosts) {
    if (body.includes(W1_PUBLISHED_URL)) fail('probe/scan posted the operator href on a dead route');
    if (LEAK.test(body)) fail(`scan POST leaked a home path: ${body}`);
    if (body && !body.includes(GUEST_SCAN_PROBE) && body.includes('http')) {
      fail(`scan POST was not the dummy: ${body}`);
    }
  }
  if (leaked.length) fail(`page fetched a live network: ${JSON.stringify(leaked)}`);
  if (await page.locator('.board-live').count()) fail('a fourth board mark appeared');

  console.log('ok    dead 7744 guest-scan: restart hint; last snapshot kept; no fake 404 snapshot');
} finally {
  await browser.close();
}

process.exit(0);
