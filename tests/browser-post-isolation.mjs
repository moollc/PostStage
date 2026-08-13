/**
 * Browser path: lastPaste and What happened? stay on the post that was copied.
 * Copy A, new empty B must not show A's chip/outcome; Copy B, switch back, A's
 * snapshot is still A's. Run: npm run test:browser-posts
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const HOOK_A = 'Alpha isolation paste.';
const HOOK_B = 'Beta isolation paste.';

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

async function waitHook(page, value) {
  await page.waitForFunction((hook) => {
    const el = document.getElementById('f-hook');
    return Boolean(el && el.value === hook);
  }, value, { timeout: 10000 });
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
  await page.locator('.stage-card input[type="text"]').first().fill('Post A');
  await page.fill('#f-hook', HOOK_A);
  await clickCopy(page);

  const outcome = page.locator('#f-outcome');
  const chip = page.locator('#last-paste-chip');
  await outcome.waitFor({ state: 'visible', timeout: 8000 });
  await chip.waitFor({ state: 'visible', timeout: 8000 });
  if (!flatten(await chip.textContent()).includes(HOOK_A)) {
    fail(`post A chip was ${JSON.stringify(await chip.textContent())}, expected ${HOOK_A}`);
  }

  await page.locator('.board-new').click();
  await waitHook(page, '');

  if (await outcome.isVisible()) {
    fail("What happened? showed on empty post B after Copy on A");
  }
  const chipOnB = flatten(await chip.textContent());
  if (chipOnB.includes(HOOK_A)) {
    fail(`post B chip still showed A's paste: ${JSON.stringify(chipOnB)}`);
  }
  if (await chip.isVisible()) {
    fail('post B showed a lastPaste chip with nothing copied on B');
  }

  await page.fill('#f-hook', HOOK_B);
  await clickCopy(page);
  await outcome.waitFor({ state: 'visible', timeout: 8000 });
  await chip.waitFor({ state: 'visible', timeout: 8000 });
  if (!flatten(await chip.textContent()).includes(HOOK_B)) {
    fail(`post B chip was ${JSON.stringify(await chip.textContent())}, expected ${HOOK_B}`);
  }

  await page.locator('.board-pick', { hasText: 'Post A' }).click();
  await waitHook(page, HOOK_A);
  await outcome.waitFor({ state: 'visible', timeout: 8000 });
  await chip.waitFor({ state: 'visible', timeout: 8000 });
  const chipBack = flatten(await chip.textContent());
  if (!chipBack.includes(HOOK_A)) {
    fail(`switched back to A, chip was ${JSON.stringify(chipBack)}, expected A's paste`);
  }
  if (chipBack.includes(HOOK_B)) {
    fail("switched back to A, chip showed B's paste");
  }

  console.log('ok    lastPaste and What happened? stay on the post that was copied');
} finally {
  await browser.close();
}

process.exit(0);
