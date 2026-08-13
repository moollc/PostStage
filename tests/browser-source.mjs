/**
 * Browser path: marketing source is visible on the board, quietly, next to
 * shop (banter). Studio stays unmarked. Reload keeps it. Not a fourth mark.
 * Run: npm run test:browser-source
 *
 * Attaches to http://127.0.0.1:7744 only. Does not spawn or kill the launcher.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const SHOP_TITLE = 'Wrong pane';
const MKT_TITLE = /SloPo W1 rag|01 proof before paste|Slop Makers|SlopBox/i;

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

  await page.waitForSelector('#post-board .board-row', { timeout: 15000 });

  const shopRow = page.locator('#post-board .board-row', {
    has: page.locator('.board-pick', { hasText: SHOP_TITLE })
  });
  await shopRow.first().waitFor({ state: 'visible', timeout: 20000 });
  const shopMark = String(await shopRow.locator('.board-src').first().textContent() || '').trim();
  if (shopMark !== 'shop') {
    fail(`banter row mark was ${JSON.stringify(shopMark)}, expected shop`);
  }

  const mktPick = page.locator('#post-board .board-pick', { hasText: MKT_TITLE });
  await mktPick.first().waitFor({ state: 'visible', timeout: 20000 });
  const mkt = await mktPick.first().evaluate((el) => {
    const row = el.closest('.board-row');
    const src = row && row.querySelector('.board-src');
    return {
      title: (el.textContent || '').trim(),
      mark: src ? String(src.textContent || '').trim() : '',
      source: row ? String(row.dataset.source || '') : '',
      className: src ? src.className : ''
    };
  });
  if (mkt.mark !== 'marketing') {
    fail(`marketing row mark was ${JSON.stringify(mkt.mark)} on ${JSON.stringify(mkt.title)}`);
  }
  if (mkt.source !== 'marketing') {
    fail(`marketing row dataset.source was ${JSON.stringify(mkt.source)}`);
  }
  if (!/\bboard-src\b/.test(mkt.className)) {
    fail('marketing used a new mark class instead of board-src');
  }
  if (mkt.mark === shopMark) {
    fail('marketing and shop were indistinguishable');
  }

  await page.locator('.board-new').click();
  const studioTitle = 'SourceMark studio ' + Date.now();
  await page.waitForSelector('.stage-card input[type="text"]', { timeout: 8000 });
  await page.locator('.stage-card input[type="text"]').fill(studioTitle);
  await page.waitForFunction((title) => {
    const pick = [...document.querySelectorAll('#post-board .board-pick')].find(
      (el) => el.textContent.trim() === title
    );
    return Boolean(pick);
  }, studioTitle, { timeout: 8000 });
  const studioSrc = await page.locator('#post-board .board-row', {
    has: page.locator('.board-pick', { hasText: studioTitle })
  }).locator('.board-src').count();
  if (studioSrc) fail('studio New post grew a source mark');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await mktPick.first().waitFor({ state: 'visible', timeout: 20000 });
  const after = await mktPick.first().evaluate((el) => {
    const row = el.closest('.board-row');
    const src = row && row.querySelector('.board-src');
    return src ? String(src.textContent || '').trim() : '';
  });
  if (after !== 'marketing') {
    fail(`after reload, marketing mark was ${JSON.stringify(after)}`);
  }

  console.log('ok    marketing is visible on the board and distinct from shop; studio stays quiet');
} finally {
  await browser.close();
}

process.exit(0);
