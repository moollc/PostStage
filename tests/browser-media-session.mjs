/**
 * Browser path: large / session-only media must not look durable.
 * A file persistableMedia will drop (blob, over the small-image data-URL
 * budget) shows "This picture leaves when you refresh." A small data-URL
 * image stays quiet. Run: npm run test:browser-media-session
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 * Buffers are generated here — no fixture file on disk.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const LEAVES = 'This picture leaves when you refresh';

/** 1×1 PNG, generated here so the test does not read an image off disk. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Just over the 900000-byte data-URL budget — attach stores this as a blob. */
const BIG_PNG = Buffer.concat([TINY_PNG, Buffer.alloc(900001 - TINY_PNG.length, 0)]);

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

async function attachPng(page, name, buffer) {
  await page.waitForSelector('.preview .media-slot input[type="file"]', {
    timeout: 15000,
    state: 'attached'
  });
  await page.locator('.preview .media-slot input[type="file"]').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer
  });
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

  await attachPng(page, 'tiny.png', TINY_PNG);

  const img = page.locator('.stage-card .preview img.media-img');
  await img.waitFor({ state: 'visible', timeout: 8000 });
  const srcTiny = String(await img.getAttribute('src') || '');
  if (!srcTiny.startsWith('data:image/png')) {
    fail(`small PNG was not a data URL (src ${JSON.stringify(srcTiny.slice(0, 80))})`);
  }
  const leavesTiny = page.locator('.stage-card .preview .media-leaves');
  if (await leavesTiny.count()) {
    fail('small data-URL image showed a session-only leave line');
  }
  const slotTiny = String(await page.locator('.stage-card .preview .media-slot').innerText() || '');
  if (/leaves when you refresh/i.test(slotTiny)) {
    fail(`small image slot said ${JSON.stringify(slotTiny)}`);
  }

  await attachPng(page, 'big.png', BIG_PNG);

  const leavesBig = page.locator('.stage-card .preview .media-leaves');
  await leavesBig.waitFor({ state: 'visible', timeout: 8000 });
  const leaveText = String(await leavesBig.textContent() || '').trim();
  if (leaveText !== LEAVES) {
    fail(`leave line was ${JSON.stringify(leaveText)}, expected ${JSON.stringify(LEAVES)}`);
  }
  const srcBig = String(await img.getAttribute('src') || '');
  if (!/^blob:/i.test(srcBig)) {
    fail(`over-budget PNG was not a blob (src ${JSON.stringify(srcBig.slice(0, 80))})`);
  }
  if (!(await img.isVisible())) {
    fail('over-budget PNG did not stay on screen as a picture');
  }

  console.log('ok    small data-URL image stays quiet; over-budget blob says it leaves on refresh');
} finally {
  await browser.close();
}

process.exit(0);
