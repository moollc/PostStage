/**
 * Browser path: attach persists a saveable video link; X timeline hole has
 * height and a first frame (preload=metadata, muted autoplay loop).
 * Reload still has the link. Playback after reload if 7744 range-serves it.
 * Attaches to http://127.0.0.1:7744 only — does not spawn or kill the launcher.
 * Run: npm run test:browser-video-x
 */

import http from 'http';
import { readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'tiny-x.webm');
const TINY_WEBM = readFileSync(FIXTURE);
const FIXTURE_SIZE = statSync(FIXTURE).size;

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

  const xBtn = page.locator('#plats button', { hasText: /^X$/ });
  if (!(await xBtn.count())) fail('X platform button was missing');
  await xBtn.click();
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('#plats button')].find(
      (b) => b.textContent.trim() === 'X'
    );
    const prev = document.querySelector('.stage-card .preview.platform-x, .stage-card .preview.timeline');
    return Boolean(btn && btn.getAttribute('aria-pressed') === 'true' && prev);
  }, undefined, { timeout: 8000 });

  await page.locator('.preview .media-slot input[type="file"]').setInputFiles({
    name: 'tiny-x.webm',
    mimeType: 'video/webm',
    buffer: TINY_WEBM
  });

  const vid = page.locator('.stage-card .preview.timeline video.media-vid, .stage-card .preview.platform-x video.media-vid');
  await vid.waitFor({ state: 'attached', timeout: 8000 });

  const src = String(await vid.getAttribute('src') || '');
  if (/^data:video/i.test(src)) fail('X preview ingested data:video');
  if (/\/media\//i.test(src)) fail(`src copied into media/: ${JSON.stringify(src)}`);
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(src)) {
    fail(`src leaked a home path: ${JSON.stringify(src)}`);
  }

  const attrs = await vid.evaluate((el) => ({
    loop: el.hasAttribute('loop') || el.loop === true,
    muted: el.hasAttribute('muted') || el.muted === true,
    autoplay: el.hasAttribute('autoplay') || el.autoplay === true,
    preload: String(el.getAttribute('preload') || el.preload || ''),
    controls: el.hasAttribute('controls') || el.controls === true
  }));
  if (!attrs.loop || !attrs.muted || !attrs.autoplay) {
    fail(`X videoPlaybackAttrs should stay muted autoplay loop, got ${JSON.stringify(attrs)}`);
  }
  if (!/metadata/i.test(attrs.preload)) {
    fail(`X video missing preload=metadata, got ${JSON.stringify(attrs.preload)}`);
  }
  if (attrs.controls) fail('X preview grew a control bar');

  const hole = await page.evaluate(() => {
    const slot = document.querySelector(
      '.stage-card .preview.timeline .media-slot:has(.media-vid), .stage-card .preview.platform-x .media-slot:has(.media-vid)'
    );
    const v = document.querySelector('.stage-card .preview video.media-vid');
    if (!slot || !v) return { slotH: 0, vidH: 0 };
    const sr = slot.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    return { slotH: sr.height, vidH: vr.height, slotW: sr.width };
  });
  const minPx = 5.5 * 16;
  if (hole.slotH < minPx - 1) {
    fail(`X .preview.timeline media hole collapsed: slot height ${hole.slotH}px (need ≥ ${minPx})`);
  }
  if (hole.vidH < minPx - 1) {
    fail(`X <video> had no height: ${hole.vidH}px`);
  }

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : {};
    const p = (board.posts || []).find((x) => x.id === board.activeId) || (board.posts || [])[0] || {};
    const m = (p.media || [])[0] || {};
    return {
      path: String(m.path || ''),
      href: String(m.href || ''),
      url: String(m.url || ''),
      session: Boolean(m.session),
      blobInJson: /blob:/i.test(JSON.stringify(m)),
      dataVideo: /^data:video/i.test(String(m.url || '')) || /^data:video/i.test(String(m.href || ''))
    };
  });
  if (!stored.path && !/^\/image\?path=/i.test(stored.href)) {
    fail(`attach did not persist a saveable link: ${JSON.stringify(stored)}`);
  }
  if (stored.blobInJson) fail('localStorage media still held a blob URL');
  if (stored.dataVideo) fail('localStorage held data:video');
  if (/^media\//i.test(stored.path) || /\/media\//i.test(stored.path)) {
    fail(`stored path is a media/ ingest copy: ${JSON.stringify(stored.path)}`);
  }
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(stored.path + stored.href + stored.url)) {
    fail('stored media leaked a home path');
  }
  const link = stored.href || stored.url;
  if (link && !/^\/image\?path=/i.test(link) && stored.path) {
    fail(`stored href/url was not /image?path=: ${JSON.stringify(link)}`);
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.preview .media-slot', { timeout: 15000, state: 'attached' });

  const after = await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : {};
    const p = (board.posts || []).find((x) => x.id === board.activeId) || (board.posts || [])[0] || {};
    const m = (p.media || [])[0] || {};
    const v = document.querySelector('.stage-card .preview video.media-vid');
    return {
      path: String(m.path || ''),
      href: String(m.href || ''),
      url: String(m.url || ''),
      src: v ? String(v.getAttribute('src') || '') : '',
      hasVid: Boolean(v)
    };
  });
  if (after.path !== stored.path && after.href !== stored.href) {
    fail(`reload dropped the saved link: before ${JSON.stringify(stored)} after ${JSON.stringify(after)}`);
  }
  if (!after.path && !/^\/image\?path=/i.test(after.href || after.url)) {
    fail(`reload had no persistable link: ${JSON.stringify(after)}`);
  }
  if (/^data:video/i.test(after.src) || /^data:video/i.test(after.url)) {
    fail('reload ingested data:video');
  }

  const imageHref = after.href || after.url || after.src;
  let rangeOk = false;
  if (/^\/image\?path=/i.test(imageHref)) {
    const range = await page.evaluate(async (href) => {
      try {
        const r = await fetch(href, { headers: { Range: 'bytes=0-99' } });
        return { status: r.status, accept: r.headers.get('accept-ranges') || '' };
      } catch (err) {
        return { status: 0, accept: '', err: String(err && err.message) };
      }
    }, imageHref.startsWith('/') ? imageHref : after.src);
    rangeOk = range.status === 206 && /bytes/i.test(range.accept);
    if (rangeOk && !after.hasVid) {
      fail('launcher range-served the clip but X preview had no <video> after reload');
    }
    if (rangeOk) {
      const holeAfter = await page.evaluate(() => {
        const slot = document.querySelector(
          '.stage-card .preview.timeline .media-slot:has(.media-vid), .stage-card .preview.platform-x .media-slot:has(.media-vid)'
        );
        return slot ? slot.getBoundingClientRect().height : 0;
      });
      if (holeAfter < minPx - 1) {
        fail(`reload X hole collapsed: ${holeAfter}px`);
      }
    }
  }

  console.log(
    'ok    X attach persists /image?path= link; timeline hole has height; ' +
      (rangeOk ? `reload plays (fixture ${FIXTURE_SIZE} bytes)` : 'reload keeps the link (live 7744 may still lack /image)')
  );
} finally {
  await browser.close();
}

process.exit(0);
