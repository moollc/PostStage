/**
 * Browser path: Copy out downloads lastPaste.text as a .txt (frozen paste,
 * not the live rail). Filename is synthetic (platform + part), no home paths.
 * Disabled when there is no lastPaste. Run: npm run test:browser-copyout
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 */

import http from 'http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const HOOK = 'Copy-out frozen paste.';
const LIVE = 'Live rail after copy — not the paste.';
const NAME = /^x-part-0\.txt$/;

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
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true
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

  await page.waitForSelector('#btn-copy-out', { timeout: 15000 });
  await page.locator('.board-new').click();
  await waitHook(page, '');

  const out = page.locator('#btn-copy-out');
  if (!(await out.isDisabled())) {
    fail('Copy out was enabled on a new post with no lastPaste');
  }

  const xBtn = page.locator('#plats button', { hasText: /^X$/ });
  if (await xBtn.count()) await xBtn.click();
  await page.waitForSelector('#f-hook', { timeout: 15000 });
  await page.fill('#f-hook', HOOK);
  await clickCopy(page);
  await page.locator('#last-paste-chip').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForFunction(() => {
    const btn = document.getElementById('btn-copy-out');
    return Boolean(btn && !btn.disabled);
  }, { timeout: 8000 });

  await page.fill('#f-hook', LIVE);
  const liBtn = page.locator('#plats button', { hasText: /^LinkedIn$/ });
  if (await liBtn.count()) await liBtn.click();
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('#plats button')].find(
      (b) => b.textContent.trim() === 'LinkedIn'
    );
    return btn && btn.getAttribute('aria-pressed') === 'true';
  }, { timeout: 8000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    out.click()
  ]);
  const filename = download.suggestedFilename();
  if (!NAME.test(filename)) {
    fail(`download name was ${JSON.stringify(filename)}, expected x-part-0.txt`);
  }
  if (/[/\\]|Users|home|GoogleDrive/i.test(filename)) {
    fail(`download name leaked a path: ${JSON.stringify(filename)}`);
  }
  const tmp = await download.path();
  if (!tmp) fail('download had no path to read');
  const body = await readFile(tmp, 'utf8');
  if (body !== HOOK) {
    fail(
      `Copy out body was ${JSON.stringify(body)}, expected the frozen paste ${JSON.stringify(HOOK)}`
    );
  }
  if (body.includes(LIVE)) {
    fail('Copy out wrote the live rail instead of lastPaste.text');
  }

  console.log('ok    Copy out downloads the frozen paste as a synthetic .txt; disabled without lastPaste');
} finally {
  await browser.close();
}

process.exit(0);
