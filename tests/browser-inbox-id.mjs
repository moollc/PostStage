/**
 * Browser path: an inbox seed with hook/body and no id appears on the board.
 * Same text does not fork a new post on reload. 7744 only — do not spawn/kill.
 * Run: npm run test:browser-inbox-id
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const TITLE = 'Wrong pane';

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

  const pick = page.locator('#post-board .board-pick', { hasText: TITLE });
  await pick.first().waitFor({ state: 'visible', timeout: 20000 });
  const before = await pick.count();
  if (before < 1) fail('seed row with no id did not appear on the board');

  const id = await pick.first().evaluate((el) => el.closest('.board-row')?.dataset.id || '');
  if (!id) fail('landed row had no dataset id');
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(id) || /@/.test(id)) {
    fail(`landed id leaked a home path or email: ${JSON.stringify(id)}`);
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await pick.first().waitFor({ state: 'visible', timeout: 20000 });
  const after = await pick.count();
  if (after !== before) {
    fail(`reload forked the seed: ${before} row(s) became ${after}`);
  }
  const idAfter = await pick.first().evaluate((el) => el.closest('.board-row')?.dataset.id || '');
  if (idAfter !== id) {
    fail(`reload changed the seed id: ${JSON.stringify(id)} → ${JSON.stringify(idAfter)}`);
  }

  console.log('ok    seed without id landed once and stayed put on reload');
} finally {
  await browser.close();
}

process.exit(0);
