/**
 * Browser path: guest scan of publishedUrl is identity only.
 * Persist { at, title, text }. Fail keeps last snapshot. No views/likes.
 * Attaches to http://127.0.0.1:7744 only — does not spawn or kill the launcher.
 * Run: npm run test:browser-guest-scan
 */

import http from 'http';
import { chromium } from 'playwright';
import { W1_POST_ID, W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const ORIGIN = 'http://127.0.0.1:7744';
const SNAP = {
  at: '2026-08-13T20:00:00.000Z',
  title: "You wouldn't post a video you haven't watched, right?",
  text: 'Slop Makers: BoxxyVid'
};

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

function postJson(urlPath, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(`${ORIGIN}${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 12000
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, raw: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null, raw: '' }); });
    req.end(data);
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

const probe = await postJson('/api/guest-scan', { url: W1_PUBLISHED_URL });
const routeLive = probe.status === 200 && probe.json && probe.json.ok === true;

if (routeLive) {
  const keys = Object.keys(probe.json).sort();
  if (keys.some((k) => /view|like|reply|quote|html|count/i.test(k))) {
    fail(`live scan returned count/html fields: ${JSON.stringify(keys)}`);
  }
  if (!probe.json.title && !probe.json.text) fail('live scan had no title or text');
  if (!probe.json.at) fail('live scan missing at');
  if (/fxtwitter/i.test(probe.raw)) fail('live scan mentioned fxtwitter');
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
  page.on('request', (req) => {
    const u = req.url();
    if (/fxtwitter/i.test(u)) leaked.push(u);
  });

  const res = await page.goto(ORIGIN, {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  if (!res || !res.ok()) {
    fail(`GET ${ORIGIN} → HTTP ${res ? res.status() : 'fail'}`);
  }

  await page.waitForSelector('#f-published-url', { timeout: 15000 });

  const w1 = page.locator('#post-board .board-row', {
    has: page.locator('.board-pick', { hasText: /Slop Makers: BoxxyVid/ })
  });
  if (await w1.count()) {
    await w1.locator('.board-pick').first().click();
  }

  await page.evaluate(({ id, url, snap }) => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : { posts: [], activeId: '' };
    let post = (board.posts || []).find((p) => p.id === id)
      || (board.posts || []).find((p) => p.id === board.activeId)
      || board.posts[0];
    if (!post) {
      post = { id, title: 'W1', publishedUrl: url, guestScan: snap, ideas: [], media: [], platform: 'x' };
      board.posts = [post];
      board.activeId = id;
    } else {
      post.publishedUrl = url;
      post.guestScan = snap;
    }
    localStorage.setItem('poststage.v2', JSON.stringify(board));
  }, { id: W1_POST_ID, url: W1_PUBLISHED_URL, snap: SNAP });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#f-published-url', { timeout: 15000 });
  if (await w1.count()) await w1.locator('.board-pick').first().click();

  const hint = page.locator('#guest-scan-hint');
  await hint.waitFor({ state: 'visible', timeout: 8000 });
  const before = String(await hint.textContent() || '');
  if (!before.includes("wouldn't post a video") && !before.includes('Scan failed')) {
    fail(`hint after reload was ${JSON.stringify(before)}`);
  }
  if (/26 views|likes|replies/i.test(before)) fail(`hint painted counts: ${JSON.stringify(before)}`);

  await page.locator('#btn-guest-scan').click();
  if (routeLive) {
    await page.waitForFunction(() => {
      const t = String(document.getElementById('guest-scan-hint')?.textContent || '');
      return t.length > 0;
    }, undefined, { timeout: 15000 });
  } else {
    await page.waitForFunction(() => {
      const t = String(document.getElementById('guest-scan-hint')?.textContent || '');
      return /Scan failed/i.test(t);
    }, undefined, { timeout: 15000 });
  }
  const after = String(await hint.textContent() || '');
  if (routeLive) {
    if (!after.trim()) fail('live scan left the hint empty');
    if (/fxtwitter/i.test(after)) fail('hint mentioned fxtwitter');
  } else if (!/Scan failed — last snapshot kept/i.test(after) && !/Scan failed/i.test(after)) {
    fail(`dead route hint was ${JSON.stringify(after)}, expected fail + last snapshot`);
  }

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : null;
    const active = board && board.posts && (board.posts.find((p) => p.id === board.activeId) || board.posts[0]);
    return active && active.guestScan;
  });
  if (!stored || typeof stored !== 'object') fail('guestScan missing after scan');
  const keys = Object.keys(stored);
  if (keys.some((k) => /view|like|reply|quote|html|count/i.test(k))) {
    fail(`stored guestScan has extra keys: ${JSON.stringify(keys)}`);
  }
  if (!stored.title && !stored.text) fail('stored guestScan empty');
  if (!routeLive) {
    if (stored.title !== SNAP.title) fail(`dead route overwrote the snapshot: ${JSON.stringify(stored)}`);
  }

  if (await page.locator('.board-live').count()) fail('fourth board mark appeared');
  if (leaked.length) fail(`page requested fxtwitter: ${JSON.stringify(leaked)}`);

  console.log(
    routeLive
      ? 'ok    live guest-scan: identity snapshot; no views; no fxtwitter'
      : 'ok    dead 7744 guest-scan route: fail keeps last snapshot; no views; no fxtwitter'
  );
} finally {
  await browser.close();
}

process.exit(0);
