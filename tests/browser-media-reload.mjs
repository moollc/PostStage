/**
 * Browser path: a small attached PNG still shows in the platform preview after
 * reload (data URL persist). A stored blob URL must not render as a picture.
 * Run: npm run test:browser-media
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 * The PNG is generated in this test — no fixture file on disk.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';

/** 1×1 PNG, generated here so the test does not read an image off disk. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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

function fail(msg) {
  console.log('FAIL  ' + msg);
  process.exit(1);
}

if (!(await originAnswers(ORIGIN))) {
  fail(
    `${ORIGIN} did not answer — start the launcher yourself. This test will not spawn one and will not kill 7744.`
  );
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

  await page.waitForSelector('.preview .media-slot input[type="file"]', {
    timeout: 15000,
    state: 'attached'
  });
  await page.locator('.preview .media-slot input[type="file"]').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: TINY_PNG
  });

  const img = page.locator('.stage-card .preview img.media-img');
  await img.waitFor({ state: 'visible', timeout: 8000 });
  const srcBefore = String(await img.getAttribute('src') || '');
  if (!srcBefore.startsWith('data:image/png')) {
    fail(`small PNG was not stored as a data URL (src ${JSON.stringify(srcBefore.slice(0, 80))})`);
  }
  const loadedBefore = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
  if (!loadedBefore) fail('small PNG did not paint in the preview before reload');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await img.waitFor({ state: 'visible', timeout: 15000 });
  const srcAfter = String(await img.getAttribute('src') || '');
  if (!srcAfter.startsWith('data:image/png')) {
    fail(`after reload, preview src was ${JSON.stringify(srcAfter.slice(0, 80))}, expected a data URL`);
  }
  const loadedAfter = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
  if (!loadedAfter) fail('small PNG did not paint in the preview after reload');

  await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : null;
    if (!board || !Array.isArray(board.posts) || !board.posts[0]) {
      throw new Error('no board in localStorage');
    }
    const active = board.posts.find((p) => p.id === board.activeId) || board.posts[0];
    active.media = [{
      name: 'dead.png',
      type: 'image/png',
      url: 'blob:http://127.0.0.1:7744/dead-blob-id'
    }];
    localStorage.setItem('poststage.v2', JSON.stringify(board));
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.stage-card .preview', { timeout: 15000 });
  const deadPics = await page.locator('.preview img.media-img[src^="blob:"], .preview video.media-vid[src^="blob:"]').count();
  if (deadPics) {
    fail('a stored blob URL rendered as a picture after reload');
  }

  console.log('ok    small PNG preview survives reload; dead blob is not a picture');
} finally {
  await browser.close();
}

process.exit(0);
