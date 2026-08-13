/**
 * Browser path: Ask shop's brief includes the normalized live href, not views.
 * Does not click Ask (would send to a live Herdr pane). Proves the packet
 * formatStageBrief builds on the canvas origin.
 * Attaches to http://127.0.0.1:7744 only — does not spawn or kill the launcher.
 * Run: npm run test:browser-ask-live
 */

import http from 'http';
import { chromium } from 'playwright';
import { W1_POST_ID, W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const ORIGIN = 'http://127.0.0.1:7744';
const PASTE_DECOY = 'this is lastPaste, not the live href';
const LEAK = /Users|GoogleDrive|(^|\/)home(\/|$)/i;

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

  await page.waitForSelector('#agent-ask', { timeout: 15000 });

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
        guestScan: { at: '2026-08-13T20:00:00.000Z', title: 'T', text: '26 views · 9 likes' },
        ideas: [],
        media: [],
        platform: 'x',
        status: 'draft',
        hook: 'Most posts fail before the second line.'
      };
      board.posts = [post];
      board.activeId = id;
    } else {
      post.publishedUrl = url;
      post.lastPaste = { text: decoy, platformId: 'x', partIndex: 0, at: null };
      post.guestScan = { at: '2026-08-13T20:00:00.000Z', title: 'T', text: '26 views · 9 likes' };
      board.activeId = post.id;
    }
    localStorage.setItem('poststage.v2', JSON.stringify(board));
  }, { id: W1_POST_ID, url: W1_PUBLISHED_URL, decoy: PASTE_DECOY });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#agent-ask', { timeout: 15000 });

  const packet = await page.evaluate(async () => {
    const { formatStageBrief } = await import('/source/shared/brief.js');
    const { loadState, getActive } = await import('/source/shared/store.js');
    const { getPlatform } = await import('/source/shared/platforms.js');
    const { structureFor } = await import('/source/shared/playbook.js');
    const state = loadState();
    const post = getActive(state);
    const platform = getPlatform(post.platform);
    return formatStageBrief(post, platform, { band: 'draft', checks: [] }, structureFor(post));
  });

  if (!packet.includes(`Live URL: ${W1_PUBLISHED_URL}`)) {
    fail(`brief missing Live URL href:\n${packet}`);
  }
  if (packet.includes('?s=') || /views=|likes=/i.test(packet)) {
    fail(`brief carried counts or a query: ${JSON.stringify(packet)}`);
  }
  const live = packet.split('\n').find((l) => l.startsWith('Live URL:'));
  if (live !== `Live URL: ${W1_PUBLISHED_URL}`) {
    fail(`Live URL line was ${JSON.stringify(live)}`);
  }
  if (/\b26 views\b|\b9 likes\b/i.test(packet)) {
    fail('brief included guestScan counts');
  }
  if (LEAK.test(packet)) fail(`brief leaked a home path:\n${packet}`);
  if (await page.locator('.board-live').count()) fail('a fourth board mark appeared');
  if (await page.locator('#agent-ask').count() !== 1) fail('Ask shop control missing');

  console.log('ok    Ask shop brief includes Live href, not views; no fourth mark');
} finally {
  await browser.close();
}

process.exit(0);
