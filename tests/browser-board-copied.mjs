/**
 * Browser path: the board list marks posts that already have lastPaste.
 * Copied post gets a quiet "copied" mark; a new empty post stays unmarked.
 * Run: npm run test:browser-board
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const HOOK = 'Board copied mark paste.';
const TITLE_A = 'BoardCopied A';
const TITLE_B = 'BoardCopied B';

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

function rowForTitle(page, title) {
  return page.locator('.board-row', {
    has: page.locator('.board-pick', { hasText: new RegExp(`^${title}$`) }
    )
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
  await page.locator('.board-new').click();
  await waitHook(page, '');
  await page.locator('.stage-card input[type="text"]').first().fill(TITLE_A);
  await page.fill('#f-hook', HOOK);
  await clickCopy(page);

  const rowA = rowForTitle(page, TITLE_A);
  await rowA.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForFunction((title) => {
    const pick = [...document.querySelectorAll('.board-pick')].find(
      (b) => b.textContent.trim() === title
    );
    return Boolean(pick && pick.closest('.board-row')?.getAttribute('data-copied') === '1');
  }, TITLE_A, { timeout: 8000 });

  const markA = rowA.locator('.board-copied');
  await markA.waitFor({ state: 'visible', timeout: 5000 });
  const markText = String(await markA.textContent() || '').trim();
  if (markText !== 'copied') {
    fail(`copied mark was ${JSON.stringify(markText)}, expected "copied"`);
  }
  if (/reach|impress|likes|views|followers|\d{4}-\d{2}-\d{2}|calendar/i.test(markText)) {
    fail(`copied mark invented metrics or a date: ${JSON.stringify(markText)}`);
  }
  const tip = String(await markA.getAttribute('title') || '');
  if (!tip.includes(HOOK)) {
    fail(`copied mark title was ${JSON.stringify(tip)}, expected the paste`);
  }

  await page.locator('.board-new').click();
  await waitHook(page, '');
  await page.locator('.stage-card input[type="text"]').first().fill(TITLE_B);

  const rowB = rowForTitle(page, TITLE_B);
  await rowB.waitFor({ state: 'visible', timeout: 8000 });
  const copiedB = await rowB.getAttribute('data-copied');
  if (copiedB) {
    fail(`empty post B was marked copied (data-copied=${JSON.stringify(copiedB)})`);
  }
  if (await rowB.locator('.board-copied').count()) {
    fail('empty post B showed a copied mark');
  }

  if ((await rowA.getAttribute('data-copied')) !== '1') {
    fail('copied post A lost its board mark after New post');
  }

  console.log('ok    board marks copied posts; empty posts stay unmarked');
} finally {
  await browser.close();
}

process.exit(0);
