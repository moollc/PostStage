/**
 * Browser path: the preview slot accepts video (not only #f-file). A synthetic
 * tiny webm plays in platform chrome; TikTok's <video> has loop.
 * Run: npm run test:browser-video-slot
 *
 * Attaches to http://127.0.0.1:7744 if that origin answers. Does not start a
 * launcher and does not touch whatever is already bound to 7744.
 * Buffer is generated here — no fixture file on disk.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';

/** 16×16 VP8 WebM, generated here so the test does not read a clip off disk. */
const TINY_WEBM = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJGEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggIw7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiEBpAAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYi+FIqPjmdCJZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAJiWgDgkLCBELqBEJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAyc3PWY8CLY8WIvhSKj45nQiVnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjI4LjEwMiBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjIwMDAwMDAwMAAfQ7Z1QITngQCjo4EAAIAQAgCdASoQABAAAEcIhYWIhYSIAgIADA1gAP7/q1CAo5WBACgAsQEAARAQABgAGFgv9AAIAACjlYEAUACxAQABEBAAGAAYWC/0AAgAAKOVgQB4ALEBAAEQEAAYABhYL/QACAAAo5WBAKAAsQEAARAQABgAGFgv9AAIAAAcU7trkbuPs4EAt4r3gQHxggGm8IED',
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
  const slotInput = page.locator('.preview .media-slot input[type="file"]');
  const accept = String(await slotInput.getAttribute('accept') || '');
  if (!/video/i.test(accept)) {
    fail(`slot accept was ${JSON.stringify(accept)}, expected image and video`);
  }

  await slotInput.setInputFiles({
    name: 'tiny.webm',
    mimeType: 'video/webm',
    buffer: TINY_WEBM
  });

  const vid = page.locator('.stage-card .preview video.media-vid');
  await vid.waitFor({ state: 'attached', timeout: 8000 });

  const ttBtn = page.locator('#plats button', { hasText: /^TikTok$/ });
  if (!(await ttBtn.count())) fail('TikTok platform button was missing');
  await ttBtn.click();
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('#plats button')].find(
      (b) => b.textContent.trim() === 'TikTok'
    );
    const v = document.querySelector('.stage-card .preview.platform-tiktok video.media-vid');
    return Boolean(btn && btn.getAttribute('aria-pressed') === 'true' && v);
  }, undefined, { timeout: 8000 });

  const ttVid = page.locator('.stage-card .preview.platform-tiktok video.media-vid');
  const src = String(await ttVid.getAttribute('src') || '');
  if (/^data:video/i.test(src)) {
    fail('TikTok preview ingested data:video');
  }

  const looped = await ttVid.evaluate((el) => ({
    loop: el.hasAttribute('loop') || el.loop === true,
    muted: el.hasAttribute('muted') || el.muted === true,
    autoplay: el.hasAttribute('autoplay') || el.autoplay === true,
    tag: el.tagName
  }));
  if (looped.tag !== 'VIDEO') {
    fail('TikTok preview did not keep a <video>');
  }
  if (!looped.loop) {
    fail('TikTok video missing loop');
  }
  if (!looped.muted || !looped.autoplay) {
    fail('TikTok video should be muted autoplay+loop');
  }

  console.log('ok    slot accepts video; TikTok preview loops the attached clip');
} finally {
  await browser.close();
}

process.exit(0);
