/**
 * Browser path: the board pick shows a quiet "noted" mark when that post has
 * an outcome note, distinct from "copied" (lastPaste). After reload, noted
 * is still there — not only copied. Clearing the note returns copied-only
 * (lastPaste stays, noted is gone). No dates, no metrics.
 * Run: npm run test:browser-noted
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const HOOK = 'Board noted mark paste.';
const NOTE = 'quiet, three replies';
const stamp = String(Date.now());
const TITLE_A = `BoardNoted A ${stamp}`;
const TITLE_B = `BoardNoted B ${stamp}`;

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
    has: page.locator('.board-pick', { hasText: new RegExp(`^${title}$`) })
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
  await page.locator('#f-outcome').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForFunction((title) => {
    const pick = [...document.querySelectorAll('.board-pick')].find(
      (b) => b.textContent.trim() === title
    );
    return Boolean(pick && pick.closest('.board-row')?.getAttribute('data-copied') === '1');
  }, TITLE_A, { timeout: 8000 });

  if (await rowA.getAttribute('data-noted')) {
    fail('copied post showed noted before an outcome note was written');
  }
  if (await rowA.locator('.board-noted').count()) {
    fail('copied post showed a noted mark before an outcome note');
  }

  await page.fill('#f-outcome', NOTE);
  await page.locator('#f-outcome').blur();

  await page.waitForFunction((title) => {
    const pick = [...document.querySelectorAll('.board-pick')].find(
      (b) => b.textContent.trim() === title
    );
    return Boolean(pick && pick.closest('.board-row')?.getAttribute('data-noted') === '1');
  }, TITLE_A, { timeout: 8000 });

  const noted = rowA.locator('.board-noted');
  const copied = rowA.locator('.board-copied');
  await noted.waitFor({ state: 'visible', timeout: 5000 });
  await copied.waitFor({ state: 'visible', timeout: 5000 });
  const notedText = String(await noted.textContent() || '').trim();
  const copiedText = String(await copied.textContent() || '').trim();
  if (notedText !== 'noted') {
    fail(`noted mark was ${JSON.stringify(notedText)}, expected "noted"`);
  }
  if (copiedText !== 'copied') {
    fail(`copied mark was ${JSON.stringify(copiedText)}, expected "copied"`);
  }
  if (notedText === copiedText) {
    fail('noted and copied marks were the same text');
  }
  if (/reach|impress|likes|views|followers|\d{4}-\d{2}-\d{2}|calendar/i.test(notedText)) {
    fail(`noted mark invented metrics or a date: ${JSON.stringify(notedText)}`);
  }
  const tip = String(await noted.getAttribute('title') || '');
  if (!tip.includes(NOTE)) {
    fail(`noted mark title was ${JSON.stringify(tip)}, expected the outcome note`);
  }
  if (/\d{4}-\d{2}-\d{2}T/.test(tip)) {
    fail(`noted mark title leaked a timestamp: ${JSON.stringify(tip)}`);
  }

  await page.locator('.board-new').click();
  await waitHook(page, '');
  await page.locator('.stage-card input[type="text"]').first().fill(TITLE_B);

  const rowB = rowForTitle(page, TITLE_B);
  await rowB.waitFor({ state: 'visible', timeout: 8000 });
  if (await rowB.getAttribute('data-noted')) {
    fail('empty post B was marked noted');
  }
  if (await rowB.locator('.board-noted').count()) {
    fail('empty post B showed a noted mark');
  }
  if ((await rowA.getAttribute('data-noted')) !== '1') {
    fail('noted post A lost its board mark after New post');
  }
  if ((await rowA.getAttribute('data-copied')) !== '1') {
    fail('copied mark on A disappeared after New post');
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#f-hook', { timeout: 15000 });
  const rowAfter = rowForTitle(page, TITLE_A);
  await rowAfter.waitFor({ state: 'visible', timeout: 8000 });
  if ((await rowAfter.getAttribute('data-noted')) !== '1') {
    fail('after reload, noted post A was not marked noted');
  }
  if ((await rowAfter.getAttribute('data-copied')) !== '1') {
    fail('after reload, noted post A lost its copied mark');
  }
  const notedAfter = rowAfter.locator('.board-noted');
  const copiedAfter = rowAfter.locator('.board-copied');
  await notedAfter.waitFor({ state: 'visible', timeout: 8000 });
  await copiedAfter.waitFor({ state: 'visible', timeout: 8000 });
  const notedAfterText = String(await notedAfter.textContent() || '').trim();
  const copiedAfterText = String(await copiedAfter.textContent() || '').trim();
  if (notedAfterText !== 'noted') {
    fail(`after reload, noted mark was ${JSON.stringify(notedAfterText)}, expected "noted"`);
  }
  if (copiedAfterText !== 'copied') {
    fail(`after reload, copied mark was ${JSON.stringify(copiedAfterText)}, expected "copied"`);
  }
  if (!(await notedAfter.isVisible()) || !(await copiedAfter.isVisible())) {
    fail('after reload, the board pick was only copied — noted must stay visible too');
  }

  await rowAfter.locator('.board-pick').click();
  await waitHook(page, HOOK);
  const outcome = page.locator('#f-outcome');
  await outcome.waitFor({ state: 'visible', timeout: 8000 });
  await outcome.fill('');
  await outcome.blur();

  await page.waitForFunction((title) => {
    const pick = [...document.querySelectorAll('.board-pick')].find(
      (b) => b.textContent.trim() === title
    );
    const row = pick && pick.closest('.board-row');
    return Boolean(
      row &&
      row.getAttribute('data-copied') === '1' &&
      !row.getAttribute('data-noted') &&
      row.querySelector('.board-copied') &&
      !row.querySelector('.board-noted')
    );
  }, TITLE_A, { timeout: 8000 });

  const rowCleared = rowForTitle(page, TITLE_A);
  if ((await rowCleared.getAttribute('data-copied')) !== '1') {
    fail('after clearing the note, lastPaste copied mark was gone — pick must stay copied-only, not unmarked');
  }
  if (await rowCleared.getAttribute('data-noted')) {
    fail('after clearing the note, the pick stayed noted');
  }
  if (await rowCleared.locator('.board-noted').count()) {
    fail('after clearing the note, a noted mark was still on the pick');
  }
  if (!(await rowCleared.locator('.board-copied').isVisible())) {
    fail('after clearing the note, the copied mark was not visible');
  }

  console.log('ok    board marks noted posts; noted survives reload; clear returns copied-only');
} finally {
  await browser.close();
}

process.exit(0);
