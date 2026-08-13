/**
 * Browser path: a still over the 900KB persist budget is compressed on attach
 * so refresh still shows a data:image picture — or stays honest session-only.
 * Video is not this slice. Run: npm run test:browser-compress
 *
 * Attaches to http://127.0.0.1:7744 only. Does not spawn or kill the launcher.
 */

import http from 'http';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:7744';
const BUDGET = 900000;

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

  const fat = await page.evaluate(async (budget) => {
    const c = document.createElement('canvas');
    c.width = 2000;
    c.height = 2000;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(2000, 2000);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 13) & 255;
      img.data[i + 1] = (i * 7) & 255;
      img.data[i + 2] = (i * 3) & 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob || blob.size <= budget) {
      return { size: blob ? blob.size : 0, b64: '' };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return { size: bytes.length, b64: btoa(s) };
  }, BUDGET);

  if (!fat.b64 || fat.size <= BUDGET) {
    fail(`fixture jpeg was ${fat.size} bytes, need > ${BUDGET}`);
  }

  await page.locator('.preview .media-slot input[type="file"]').setInputFiles({
    name: 'fat-still.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(fat.b64, 'base64')
  });

  const img = page.locator('.stage-card .preview img.media-img');
  await img.waitFor({ state: 'visible', timeout: 15000 });
  const srcBefore = String(await img.getAttribute('src') || '');
  const leaves = page.locator('.stage-card .preview .media-leaves');
  const leaveCount = await leaves.count();

  if (/^data:video/i.test(srcBefore)) fail('still attach ingested data:video');
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(srcBefore)) {
    fail(`src leaked a home path: ${JSON.stringify(srcBefore.slice(0, 80))}`);
  }

  if (/^blob:/i.test(srcBefore)) {
    if (!leaveCount) fail('unpersisted fat still had no session overlay');
    const overlay = String(await leaves.textContent() || '');
    if (!/leaves when you refresh/i.test(overlay)) {
      fail(`session overlay was ${JSON.stringify(overlay)}`);
    }
  } else if (/^data:image\//i.test(srcBefore) || /^\/image\?path=/i.test(srcBefore)) {
    if (leaveCount) fail('persisted compressed still still showed a leave overlay');
  } else {
    fail(`unexpected still src ${JSON.stringify(srcBefore.slice(0, 80))}`);
  }

  const storedBefore = await page.evaluate(() => {
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : {};
    const p = (board.posts || []).find((x) => x.id === board.activeId) || (board.posts || [])[0] || {};
    const m = (p.media || [])[0] || {};
    return {
      url: String(m.url || ''),
      href: String(m.href || ''),
      path: String(m.path || ''),
      json: JSON.stringify(m)
    };
  });
  if (/blob:/i.test(storedBefore.json)) fail('localStorage held a blob URL');
  if (/data:video/i.test(storedBefore.json)) fail('localStorage held data:video');
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(storedBefore.json)) {
    fail('localStorage leaked a home path');
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.stage-card .preview', { timeout: 15000 });

  const after = await page.evaluate(() => {
    const imgEl = document.querySelector('.stage-card .preview img.media-img');
    const overlay = document.querySelector('.stage-card .preview .media-leaves');
    const raw = localStorage.getItem('poststage.v2');
    const board = raw ? JSON.parse(raw) : {};
    const p = (board.posts || []).find((x) => x.id === board.activeId) || (board.posts || [])[0] || {};
    const m = (p.media || [])[0] || {};
    return {
      src: imgEl ? String(imgEl.getAttribute('src') || '') : '',
      painted: Boolean(imgEl && imgEl.complete && imgEl.naturalWidth > 0),
      overlay: overlay ? String(overlay.textContent || '') : '',
      url: String(m.url || ''),
      json: JSON.stringify(m)
    };
  });

  if (/blob:/i.test(after.json) || /^blob:/i.test(after.src) || /^blob:/i.test(after.url)) {
    fail('reload stored or rendered a blob');
  }
  if (/data:video/i.test(after.json) || /^data:video/i.test(after.src)) {
    fail('reload held data:video');
  }
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(after.json + after.src + after.url)) {
    fail('reload leaked a home path');
  }

  const persisted = /^data:image\//i.test(after.src) || /^\/image\?path=/i.test(after.src);
  if (persisted) {
    if (!after.painted) fail('compressed still did not paint after reload');
    if (/leaves when you refresh/i.test(after.overlay)) {
      fail('persisted still showed session overlay after reload');
    }
  } else if (!after.src) {
    if (!/leaves when you refresh|Session ended/i.test(after.overlay) && !after.overlay) {
      const slot = await page.locator('.stage-card .preview .media-slot').innerText();
      if (!/leaves when you refresh|Session ended|click or drop/i.test(slot)) {
        fail('reload emptied the slot with no honest overlay');
      }
    }
  } else {
    fail(`reload src was ${JSON.stringify(after.src.slice(0, 80))}`);
  }

  console.log(
    persisted
      ? 'ok    fat still compressed to data:image and survived reload'
      : 'ok    fat still stayed honest session-only after reload (no silent empty slot)'
  );
} finally {
  await browser.close();
}

process.exit(0);
