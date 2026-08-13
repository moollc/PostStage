/**
 * Browser path: the board is a vertical left-rail list, not a top strip.
 * N long titles; overflow-x is not how you reach post N; click the last row
 * sets activeId; New post still appends. Run: npm run test:browser-board-list
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const N = 8;
const stamp = String(Date.now());
const LONG = 'long title word '.repeat(8).trim();

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

async function waitHook(page, value) {
  await page.waitForFunction((hook) => {
    const el = document.getElementById('f-hook');
    return Boolean(el && el.value === hook);
  }, value, { timeout: 10000 });
}

function titleAt(i) {
  return `BoardList ${stamp} ${i + 1} ${LONG}`;
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

  await page.waitForSelector('#post-board', { timeout: 15000 });
  await page.waitForSelector('#idea-lane', { timeout: 8000 });
  await page.waitForSelector('.board-new', { timeout: 8000 });

  const titles = [];
  for (let i = 0; i < N; i++) {
    await page.locator('.board-new').click();
    await waitHook(page, '');
    const title = titleAt(i);
    titles.push(title);
    await page.locator('.stage-card input[type="text"]').first().fill(title);
    await page.waitForFunction((t) => {
      return [...document.querySelectorAll('.board-pick')].some(
        (b) => b.textContent === t
      );
    }, title, { timeout: 8000 });
  }

  const lastTitle = titles[N - 1];
  const layout = await page.evaluate((want) => {
    const board = document.getElementById('post-board');
    const list = board && board.querySelector('.board-list');
    const lane = document.getElementById('idea-lane');
    const add = board && board.querySelector('.board-new');
    const picks = [...document.querySelectorAll('.board-pick')].filter((b) =>
      want.includes(b.textContent)
    );
    const lastPick = picks.find((b) => b.textContent === want[want.length - 1]);
    const firstPick = picks.find((b) => b.textContent === want[0]);
    const ox = (el) => (el ? getComputedStyle(el).overflowX : '');
    const pickCs = lastPick ? getComputedStyle(lastPick) : null;
    return {
      boardOx: ox(board),
      listOx: ox(list),
      boardScrollW: board ? board.scrollWidth : 0,
      boardClientW: board ? board.clientWidth : 0,
      listScrollW: list ? list.scrollWidth : 0,
      listClientW: list ? list.clientWidth : 0,
      lastBelowFirst: Boolean(
        lastPick &&
        firstPick &&
        lastPick.getBoundingClientRect().top > firstPick.getBoundingClientRect().top + 8
      ),
      lastText: lastPick ? lastPick.textContent : '',
      pickMaxWidth: pickCs ? pickCs.maxWidth : '',
      pickWhiteSpace: pickCs ? pickCs.whiteSpace : '',
      pickEllipsis: pickCs ? pickCs.textOverflow : '',
      newIsLast: Boolean(add && board.lastElementChild === add),
      laneBelowBoard: Boolean(
        lane &&
        board &&
        lane.getBoundingClientRect().top >= board.getBoundingClientRect().bottom - 4
      ),
      laneLeft: lane ? Math.round(lane.getBoundingClientRect().left) : -1,
      boardLeft: board ? Math.round(board.getBoundingClientRect().left) : -2
    };
  }, titles);

  const scrollX =
    layout.boardOx === 'auto' ||
    layout.boardOx === 'scroll' ||
    layout.listOx === 'auto' ||
    layout.listOx === 'scroll';
  if (scrollX) {
    fail(
      `overflow-x is how the board scrolls (board=${layout.boardOx}, list=${layout.listOx})`
    );
  }
  if (layout.boardScrollW > layout.boardClientW + 2) {
    fail(
      `board scrollWidth ${layout.boardScrollW} > clientWidth ${layout.boardClientW} — sideways reach`
    );
  }
  if (layout.listScrollW > layout.listClientW + 2) {
    fail(
      `board-list scrollWidth ${layout.listScrollW} > clientWidth ${layout.listClientW} — sideways reach`
    );
  }
  if (!layout.lastBelowFirst) {
    fail('last of the N titles is not below the first — board is not a vertical list');
  }
  if (layout.lastText !== lastTitle) {
    fail(`last pick text was ${JSON.stringify(layout.lastText)}, expected the full title`);
  }
  if (layout.pickWhiteSpace === 'nowrap' && layout.pickEllipsis === 'ellipsis') {
    fail('board-pick still truncates with nowrap ellipsis (9.5rem strip)');
  }
  if (layout.pickMaxWidth && /rem|px/.test(layout.pickMaxWidth) && parseFloat(layout.pickMaxWidth) <= 9.5) {
    fail(`board-pick max-width is still ${layout.pickMaxWidth}`);
  }
  if (!layout.newIsLast) {
    fail('New post is not the last child of #post-board');
  }
  if (!layout.laneBelowBoard) {
    fail('idea-lane is not below #post-board — top strip layout is still in play');
  }
  if (Math.abs(layout.laneLeft - layout.boardLeft) > 4) {
    fail('idea-lane is not in the same left column as the board');
  }

  const lastPick = page.locator('.board-pick', { hasText: lastTitle });
  await lastPick.scrollIntoViewIfNeeded();
  await lastPick.click();
  await page.waitForFunction((title) => {
    const pick = [...document.querySelectorAll('.board-pick')].find(
      (b) => b.textContent === title
    );
    const row = pick && pick.closest('.board-row');
    if (!row || !row.classList.contains('active') || !row.dataset.id) return false;
    try {
      const raw = localStorage.getItem('poststage.v2');
      const data = raw ? JSON.parse(raw) : {};
      return data.activeId === row.dataset.id;
    } catch {
      return false;
    }
  }, lastTitle, { timeout: 8000 });

  const before = await page.locator('#post-board .board-row').count();
  await page.locator('.board-new').click();
  await waitHook(page, '');
  const after = await page.locator('#post-board .board-row').count();
  if (after !== before + 1) {
    fail(`New post did not append a row (had ${before}, then ${after})`);
  }
  const stillLast = await page.evaluate(() => {
    const board = document.getElementById('post-board');
    const add = board && board.querySelector('.board-new');
    return Boolean(add && board.lastElementChild === add);
  });
  if (!stillLast) {
    fail('after append, New post is not still at the end of #post-board');
  }

  console.log('ok    board is a vertical list; last row activates; New post appends');
} finally {
  await browser.close();
}

process.exit(0);
