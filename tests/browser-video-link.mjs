/**
 * Browser path: slot video is a link, not ingested bytes.
 * src is not data:video and not a copy under media/. Blob + leave overlay
 * only when the launcher has no project-relative path. Attach 7744 only.
 * Run: npm run test:browser-video-link
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';

const TINY_WEBM = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJGEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggIw7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiEBpAAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYi+FIqPjmdCJZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAJiWgDgkLCBELqBEJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAyc3PWY8CLY8WIvhSKj45nQiVnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjIwMDAwMDAwMAAfQ7Z1QITngQCjo4EAAIAQAgCdASoQABAAAEcIhYWIhYSIAgIADA1gAP7/q1CAo5WBACgAsQEAARAQABgAGFgv9AAIAACjlYEAUACxAQABEBAAGAAYWC/0AAgAAKOVgQB4ALEBAAEQEAAYABhYL/QACAAAo5WBAKAAsQEAARAQABgAGFgv9AAIAAAcU7trkbuPs4EAt4r3gQHxggGm8IED',
  'base64'
);

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

  await page.waitForSelector('.preview .media-slot input[type="file"]', {
    timeout: 15000,
    state: 'attached'
  });
  await page.locator('.preview .media-slot input[type="file"]').setInputFiles({
    name: 'tiny-link.webm',
    mimeType: 'video/webm',
    buffer: TINY_WEBM
  });

  const vid = page.locator('.stage-card .preview video.media-vid');
  await vid.waitFor({ state: 'attached', timeout: 8000 });
  const src = String(await vid.getAttribute('src') || '');
  if (/^data:video/i.test(src)) {
    fail('slot ingested the clip as data:video');
  }
  if (/\/media\//i.test(src)) {
    fail(`src copied into media/: ${JSON.stringify(src)}`);
  }
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(src)) {
    fail(`src leaked a home path: ${JSON.stringify(src)}`);
  }

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : {};
    const p = (board.posts || []).find((x) => x.id === board.activeId) || (board.posts || [])[0] || {};
    const m = (p.media || [])[0] || {};
    return { path: String(m.path || ''), url: String(m.url || ''), href: String(m.href || ''), session: Boolean(m.session) };
  });
  if (/^data:video/i.test(stored.url) || /^data:video/i.test(stored.href)) {
    fail('localStorage held data:video');
  }
  if (/\/media\//i.test(stored.path) && stored.path.startsWith('media/')) {
    fail('stored path is a media/ ingest copy');
  }
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(stored.path) || /Users|GoogleDrive|(^|\/)home(\/|$)/i.test(stored.url) || /Users|GoogleDrive|(^|\/)home(\/|$)/i.test(stored.href)) {
    fail('stored media leaked a home path');
  }

  const persisted = stored.path || /^\/image\?path=/i.test(stored.href) || /^\/image\?path=/i.test(stored.url);
  if (/^\/image\?path=/i.test(src)) {
    const range = await page.evaluate(async (href) => {
      const r = await fetch(href, { headers: { Range: 'bytes=0-99' } });
      return {
        status: r.status,
        accept: r.headers.get('accept-ranges') || '',
        content: r.headers.get('content-range') || ''
      };
    }, src);
    if (range.status !== 206) {
      fail(`linked clip Range GET was ${range.status}, expected 206`);
    }
    if (!/bytes/i.test(range.accept) || !range.content) {
      fail(`Range headers missing: accept=${JSON.stringify(range.accept)} content=${JSON.stringify(range.content)}`);
    }
  } else if (/^blob:/i.test(src)) {
    if (persisted) {
      const linked = page.locator('.stage-card .preview .media-linked');
      if (!(await linked.count())) {
        fail('persistable link played from a sitting blob but had no Linked clip mark');
      }
    } else {
      const overlay = page.locator('.stage-card .preview .media-leaves');
      if (!(await overlay.count())) {
        fail('unlinked blob clip had no leave-on-refresh overlay');
      }
    }
  } else {
    fail(`unexpected video src ${JSON.stringify(src)}`);
  }

  if (!persisted) {
    fail(`attach did not persist a saveable link: ${JSON.stringify(stored)}`);
  }

  console.log('ok    slot video is a persistable /image?path= link (sitting blob ok); not data:video');
} finally {
  await browser.close();
}

process.exit(0);
