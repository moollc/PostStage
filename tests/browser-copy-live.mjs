/**
 * Browser path: Copy link puts publishedUrl on the clipboard, not lastPaste.
 * Disabled without a URL. Flash saved. No views. No fourth mark.
 * Attaches to http://127.0.0.1:7744 only — does not spawn or kill the launcher.
 * Run: npm run test:browser-copy-live
 */

import http from 'http';
import { chromium } from 'playwright';
import { W1_POST_ID, W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const ORIGIN = 'http://127.0.0.1:7744';
const WANT = W1_PUBLISHED_URL;
const PASTE_DECOY = 'this is lastPaste, not the live href';

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

  await page.waitForSelector('#btn-copy-link', { timeout: 15000 });

  await page.evaluate(({ id, url, decoy }) => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : { posts: [], activeId: '' };
    if (!Array.isArray(board.posts)) board.posts = [];
    let post = board.posts.find((p) => p.id === id)
      || board.posts.find((p) => p.id === board.activeId)
      || board.posts[0];
    if (!post) {
      post = {
        id,
        title: 'W1',
        publishedUrl: url,
        lastPaste: { text: decoy, platformId: 'x', partIndex: 0, at: null },
        ideas: [],
        media: [],
        platform: 'x',
        status: 'draft'
      };
      board.posts = [post];
      board.activeId = id;
    } else {
      post.publishedUrl = url;
      post.lastPaste = { text: decoy, platformId: 'x', partIndex: 0, at: null };
      board.activeId = post.id;
    }
    localStorage.setItem('poststage.v2', JSON.stringify(board));
  }, { id: W1_POST_ID, url: WANT, decoy: PASTE_DECOY });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#btn-copy-link', { timeout: 15000 });

  const w1 = page.locator('#post-board .board-row', {
    has: page.locator('.board-pick', { hasText: /Slop Makers: BoxxyVid/ })
  });
  if (await w1.count()) await w1.locator('.board-pick').first().click();

  const btn = page.locator('#btn-copy-link');
  await btn.waitFor({ state: 'visible', timeout: 8000 });
  if (await btn.isDisabled()) fail('#btn-copy-link was disabled with a live URL');

  await page.evaluate(() => {
    window.__copyLiveArg = null;
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (t) => {
      window.__copyLiveArg = t;
      return orig(t);
    };
  });

  await btn.click();
  await page.waitForFunction(() => {
    const el = document.getElementById('btn-copy-link');
    return Boolean(el && (el.classList.contains('saved') || /Copied link/i.test(el.textContent || '')));
  }, undefined, { timeout: 8000 });

  const written = await page.evaluate(() => window.__copyLiveArg);
  if (written !== WANT) {
    fail(`writeText got ${JSON.stringify(written)}, expected publishedUrl ${JSON.stringify(WANT)}`);
  }
  if (written === PASTE_DECOY || /lastPaste|this is lastPaste/i.test(String(written || ''))) {
    fail('clipboard got lastPaste instead of the live href');
  }
  if (/views=|likes=/i.test(String(written || ''))) {
    fail(`clipboard carried counts: ${JSON.stringify(written)}`);
  }
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(String(written || ''))) {
    fail(`clipboard leaked a home path: ${JSON.stringify(written)}`);
  }

  let clip = '';
  try {
    clip = await page.evaluate(() => navigator.clipboard.readText());
  } catch {
    clip = written;
  }
  if (clip !== WANT) {
    fail(`clipboard was ${JSON.stringify(clip)}, expected publishedUrl ${JSON.stringify(WANT)}`);
  }

  if (await page.locator('.board-live').count()) fail('a fourth board mark appeared');

  await page.locator('.board-new').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('btn-copy-link');
    return Boolean(el && el.disabled);
  }, undefined, { timeout: 8000 });
  if (!(await page.locator('#btn-copy-link').isDisabled())) {
    fail('#btn-copy-link was enabled with no URL');
  }

  console.log('ok    Copy link copies publishedUrl, not lastPaste; disabled without URL; flash saved');
} finally {
  await browser.close();
}

process.exit(0);
