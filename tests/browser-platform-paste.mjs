/**
 * Browser path: lastPaste chip and What happened? stay the copied X string
 * after the operator switches the preview bar to LinkedIn.
 * Run: npm run test:browser-platform
 *
 * Uses an X thread (300 chars → 2/2) so LinkedIn's live reformat is a
 * different string (no part mark). Attaches to http://127.0.0.1:7744 if that
 * origin answers. Does not start a launcher and does not touch whatever is
 * already bound to 7744.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const OVER = 'H'.repeat(300);

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
  const xBtn = page.locator('#plats button', { hasText: /^X$/ });
  if (await xBtn.count()) await xBtn.click();
  await page.waitForSelector('#f-hook', { timeout: 15000 });
  await page.fill('#f-hook', OVER);

  await page.waitForFunction(() => {
    const bar = document.getElementById('thread-bar');
    const pos = document.getElementById('thread-pos');
    return Boolean(bar && !bar.hidden && pos && /^1\/2\s*$/.test(pos.textContent.trim()));
  }, { timeout: 8000 });

  await clickCopy(page);
  await page.locator('#thread-next').click();
  await page.waitForFunction(() => {
    const pos = document.getElementById('thread-pos');
    return pos && /^2\/2\s*$/.test(pos.textContent.trim());
  }, { timeout: 5000 });

  const xPaste = flatten(await page.locator('#paste-view').innerText());
  if (!xPaste.endsWith('2/2')) {
    fail(`X last part was ${JSON.stringify(xPaste)}, expected a 2/2 mark`);
  }

  await clickCopy(page);

  const chip = page.locator('#last-paste-chip');
  const outcome = page.locator('#f-outcome');
  await chip.waitFor({ state: 'visible', timeout: 8000 });
  await outcome.waitFor({ state: 'visible', timeout: 8000 });
  const chipOnX = flatten(await chip.textContent());
  if (chipOnX !== xPaste) {
    fail(`#last-paste-chip on X was ${JSON.stringify(chipOnX)}, expected ${JSON.stringify(xPaste)}`);
  }
  const platOnX = await chip.getAttribute('data-platform');
  if (platOnX !== 'x') {
    fail(`#last-paste-chip data-platform was ${JSON.stringify(platOnX)}, expected "x"`);
  }

  const liBtn = page.locator('#plats button', { hasText: /^LinkedIn$/ });
  if (!(await liBtn.count())) fail('LinkedIn was not on the preview bar');
  await liBtn.click();

  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('#plats button')].find(
      (b) => b.textContent.trim() === 'LinkedIn'
    );
    return btn && btn.getAttribute('aria-pressed') === 'true';
  }, { timeout: 8000 });

  await page.waitForFunction(() => {
    const el = document.getElementById('paste-view');
    const text = (el && el.innerText || '').replace(/\s+/g, ' ').trim();
    return text.length >= 300 && !text.endsWith('2/2');
  }, { timeout: 10000 });

  await chip.waitFor({ state: 'visible', timeout: 8000 });
  await outcome.waitFor({ state: 'visible', timeout: 8000 });

  const chipAfter = flatten(await chip.textContent());
  const liveAfter = flatten(await page.locator('#paste-view').innerText());
  const platAfter = await chip.getAttribute('data-platform');

  if (chipAfter !== xPaste) {
    fail(
      `after LinkedIn switch, #last-paste-chip was ${JSON.stringify(chipAfter)}, expected the X paste ${JSON.stringify(xPaste)}`
    );
  }
  if (platAfter !== 'x') {
    fail(
      `after LinkedIn switch, data-platform was ${JSON.stringify(platAfter)}, expected "x"`
    );
  }
  if (liveAfter === xPaste) {
    fail('LinkedIn paste-view still showed the X 2/2 string — live preview did not reformat');
  }
  if (chipAfter === liveAfter) {
    fail(
      `#last-paste-chip matched the LinkedIn reformat ${JSON.stringify(liveAfter)} — it re-derived from the live platform`
    );
  }
  if (!liveAfter.includes('H'.repeat(40)) || liveAfter.endsWith('2/2')) {
    fail(`LinkedIn paste-view was ${JSON.stringify(liveAfter.slice(0, 80))}, expected the unsplit hook`);
  }
  if (!(await outcome.isVisible())) {
    fail('What happened? hid after the LinkedIn switch');
  }

  console.log('ok    Copy on X, switch to LinkedIn — chip stays the X paste, not a LinkedIn reformat');
} finally {
  await browser.close();
}

process.exit(0);
