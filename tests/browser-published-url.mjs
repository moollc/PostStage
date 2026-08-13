/**
 * Browser path: drop W1 live URL (host + status id). Ledger shows the href.
 * Reload keeps it. No fourth board mark. No fetch of x.com from the canvas.
 * Attaches to http://127.0.0.1:7744 only — does not spawn or kill the launcher.
 * Run: npm run test:browser-published-url
 */

import http from 'http';
import { chromium } from 'playwright';
import { W1_POST_ID, W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const ORIGIN = 'http://127.0.0.1:7744';
const PASTE = 'https://twitter.com/Jayson_X/status/2087952991638716610?s=20';
const WANT = W1_PUBLISHED_URL;

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
  const leaked = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|fxtwitter\.com)\b/i.test(u)) {
      leaked.push(u);
    }
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
    await page.waitForFunction(
      (id) => {
        const row = document.querySelector(`#post-board .board-row[data-id="${id}"]`);
        return Boolean(row && row.classList.contains('active'));
      },
      W1_POST_ID,
      { timeout: 8000 }
    );
  }

  await page.fill('#f-published-url', PASTE);
  await page.locator('#f-published-url').blur();
  await page.waitForFunction(
    (want) => {
      const el = document.getElementById('f-published-url');
      return el && String(el.value || '') === want;
    },
    WANT,
    { timeout: 8000 }
  );

  const link = page.locator('#outcome-ledger a.ledger-href');
  await link.waitFor({ state: 'visible', timeout: 8000 });
  const href = String(await link.getAttribute('href') || '');
  if (href !== WANT) fail(`ledger href was ${JSON.stringify(href)}, expected ${JSON.stringify(WANT)}`);
  const target = String(await link.getAttribute('target') || '');
  if (target !== '_blank') fail(`ledger link target was ${JSON.stringify(target)}, expected _blank`);

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : null;
    const active = board && board.posts && (board.posts.find((p) => p.id === board.activeId) || board.posts[0]);
    return active ? active.publishedUrl : null;
  });
  if (stored !== WANT) fail(`stored publishedUrl was ${JSON.stringify(stored)}`);

  if (await page.locator('.board-live, .board-url, .board-href').count()) {
    fail('a fourth board mark appeared for the live URL');
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#f-published-url', { timeout: 15000 });
  if (await w1.count()) {
    await w1.locator('.board-pick').first().click();
  }
  const afterVal = String(await page.locator('#f-published-url').inputValue());
  if (afterVal !== WANT) {
    fail(`after reload, field was ${JSON.stringify(afterVal)}`);
  }
  const afterHref = String(await page.locator('#outcome-ledger a.ledger-href').getAttribute('href') || '');
  if (afterHref !== WANT) fail(`after reload, ledger href was ${JSON.stringify(afterHref)}`);

  if (leaked.length) {
    fail(`canvas fetched a live host: ${JSON.stringify(leaked)}`);
  }

  console.log('ok    publishedUrl persists host+status id; ledger shows href; no fourth mark; no fetch');
} finally {
  await browser.close();
}

process.exit(0);
