/**
 * Headless app screenshot — targets the PostStage URL only (not the desktop).
 * Usage: node capture-shot.mjs <url> <latest.png> [timestamped.png]
 */
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const [url, latestPath, stampedPath] = process.argv.slice(2);
if (!url || !latestPath) process.exit(1);

mkdirSync(dirname(latestPath), { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
    ignoreHTTPSErrors: true
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: latestPath, fullPage: false });
  if (stampedPath) copyFileSync(latestPath, stampedPath);
} finally {
  await browser.close();
}
