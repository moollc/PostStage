/**
 * Browser path: after last-part Copy, a What happened? note and the paste chip
 * survive page.reload(). Run: npm run test:browser-reload
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const OVER = 'H'.repeat(300);
const NOTE = 'quiet, 3 replies';

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

async function clickCopy(page) {
  const headerCopy = page.locator('#btn-export');
  const liveCopy = page.locator('.stage-copy');
  if (await headerCopy.count()) await headerCopy.click();
  else if (await liveCopy.count()) await liveCopy.click();
  else fail('neither #btn-export nor .stage-copy was on the page');
}

function flatten(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
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
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write']
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: ORIGIN
  });
  const page = await context.newPage();
  const res = await page.goto(ORIGIN, {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  if (!res || !res.ok()) {
    fail(`GET ${ORIGIN} → HTTP ${res ? res.status() : 'fail'}`);
  }

  await page.waitForSelector('#f-hook', { timeout: 15000 });
  const xBtn = page.locator('#plats button', { hasText: /^X$/ });
  if (await xBtn.count()) await xBtn.click();
  await page.waitForSelector('#f-hook', { timeout: 15000 });
  await page.fill('#f-hook', OVER);

  await page.waitForFunction(() => {
    const bar = document.getElementById('thread-bar');
    const pos = document.getElementById('thread-pos');
    return Boolean(bar && !bar.hidden && pos && /^1\/2\s*$/.test(pos.textContent.trim()));
  }, { timeout: 8000 });

  await clickCopy(page);
  await page.locator('#thread-next').click();
  await page.waitForFunction(() => {
    const pos = document.getElementById('thread-pos');
    return pos && /^2\/2\s*$/.test(pos.textContent.trim());
  }, { timeout: 5000 });

  const lastPart = flatten(await page.locator('#paste-view').innerText());
  await clickCopy(page);

  const outcome = page.locator('#f-outcome');
  await outcome.waitFor({ state: 'visible', timeout: 8000 });
  await outcome.fill(NOTE);
  await outcome.dispatchEvent('change');

  await page.waitForFunction((note) => {
    try {
      const raw = localStorage.getItem('poststage.v2');
      return Boolean(raw && raw.includes(note));
    } catch {
      return false;
    }
  }, NOTE, { timeout: 5000 });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#f-outcome', { timeout: 15000 });

  await outcome.waitFor({ state: 'visible', timeout: 8000 });
  const noteAfter = String(await outcome.inputValue()).trim();
  if (noteAfter !== NOTE) {
    fail(`#f-outcome after reload was ${JSON.stringify(noteAfter)}, expected ${JSON.stringify(NOTE)}`);
  }

  const chip = page.locator('#last-paste-chip');
  await chip.waitFor({ state: 'visible', timeout: 8000 });
  const chipText = flatten(await chip.textContent());
  if (chipText !== lastPart) {
    fail(
      `#last-paste-chip after reload was ${JSON.stringify(chipText)}, expected ${JSON.stringify(lastPart)}`
    );
  }

  console.log('ok    last-part Copy note and chip survive reload');
} finally {
  await browser.close();
}

process.exit(0);
