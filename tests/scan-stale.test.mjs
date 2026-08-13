/**
 * Dead guest-scan route is not a snapshot. Probe dummy, not the live href.
 * 200 HTML is dead. Run: npm run test:scan-stale
 *
 * Does not spawn a launcher.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  GUEST_SCAN_PROBE,
  STALE_SCAN_HINT,
  guestScanRouteFromHealth,
  guestScanRouteFromProbe
} from '../source/shared/scan-stale.js';
import { W1_PUBLISHED_URL } from '../source/shared/published-url.js';
import { parseGuestHtml, normalizeGuestScan } from '../source/shared/guest-scan.js';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_SRC = readFileSync(resolve(here, '../source/app/index.js'), 'utf8');
const LAUNCHER = readFileSync(resolve(here, '../build/scripts/launcher.js'), 'utf8');
const NOT_FOUND_HTML = readFileSync(resolve(here, '../404.html'), 'utf8');

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('ok    ' + msg);
  else {
    failed += 1;
    console.log('FAIL  ' + msg);
  }
}

ok(GUEST_SCAN_PROBE === '__poststage_scan_probe__', 'probe token is the dummy');
ok(!/Users|home|GoogleDrive/i.test(GUEST_SCAN_PROBE), 'probe dummy has no home path');
ok(!GUEST_SCAN_PROBE.includes('/') && !GUEST_SCAN_PROBE.includes('\\'), 'probe dummy is not a path');
ok(GUEST_SCAN_PROBE !== W1_PUBLISHED_URL, 'probe is not the operator href');
ok(!/^https?:/i.test(GUEST_SCAN_PROBE), 'probe is not a URL');

ok(guestScanRouteFromHealth({ guestScanRoute: true }), 'health guestScanRoute true is live');
ok(
  !guestScanRouteFromHealth({ ok: true, herdr: false, rust: false }),
  'old health without guestScanRoute is not live'
);
ok(
  guestScanRouteFromProbe(400, { 'content-type': 'application/json' }),
  '400 JSON is live (handler ran)'
);
ok(
  guestScanRouteFromProbe(200, { 'content-type': 'application/json; charset=utf-8' }),
  '200 JSON is live'
);
ok(
  !guestScanRouteFromProbe(200, { 'content-type': 'text/html; charset=utf-8' }),
  '200 HTML is dead static fallback'
);
ok(!guestScanRouteFromProbe(404, { 'content-type': 'text/html' }), '404 is dead');

ok(
  STALE_SCAN_HINT === 'scan will not run until the launcher is restarted',
  'hint is the restart sentence'
);
ok(!/Users|home|GoogleDrive/i.test(STALE_SCAN_HINT), 'hint has no home path');

const parsed404 = parseGuestHtml(NOT_FOUND_HTML);
ok(!parsed404, '404.html has no og tags, so the parser yields nothing');
const stuffed = normalizeGuestScan({
  title: 'Not found · PostStage',
  text: 'That path is not on this stage.',
  at: '2026-08-13T20:00:00.000Z'
});
ok(stuffed && stuffed.title.includes('Not found'), 'stuffing 404 copy would look like a snapshot — the client must not');

// Title-only WOULD normalize. The contract is the client never feeds 404 HTML
// into setGuestScan. Assert the handler refuses HTML before setGuestScan.
ok(
  /if \(\/html\/i\.test\(type\) && !\/json\/i\.test\(type\)\)/.test(INDEX_SRC),
  'HTML response is classified dead before any snapshot write'
);

function probeSrc() {
  const start = INDEX_SRC.indexOf('async function probeGuestScanRoute(');
  if (start < 0) throw new Error('probeGuestScanRoute not found');
  return INDEX_SRC.slice(start, INDEX_SRC.indexOf('\n}\n', start) + 3);
}

function runSrc() {
  const start = INDEX_SRC.indexOf('async function runGuestScan(');
  if (start < 0) throw new Error('runGuestScan not found');
  return INDEX_SRC.slice(start, INDEX_SRC.indexOf('\n}\n', start) + 3);
}

const probe = probeSrc();
ok(/GUEST_SCAN_PROBE/.test(probe), 'probe posts the dummy');
ok(!/publishedUrl/.test(probe), 'probe does not use the operator href');
ok(!/W1_PUBLISHED_URL/.test(probe), 'probe does not use the W1 fixture');

const run = runSrc();
ok(/guestScanRouteLive === false/.test(run), 'dead route skips the scan');
ok(/setGuestScan/.test(run), 'live JSON may persist');
const htmlGuard = run.slice(run.indexOf('/html/'), run.indexOf('let data'));
ok(!/setGuestScan/.test(htmlGuard), 'HTML branch does not call setGuestScan');
ok(!/parseGuestHtml/.test(INDEX_SRC), 'canvas does not parse HTML');
ok(!/res\.text\(/.test(run), 'scan handler does not read HTML body');

ok(/guestScanRoute:\s*true/.test(LAUNCHER), 'disk launcher advertises guestScanRoute');
ok(INDEX_SRC.includes('STALE_SCAN_HINT'), 'canvas paints the restart hint');
ok(INDEX_SRC.includes('guest-scan-stale'), 'stale class is on the hint');

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('ok    scan-stale: dummy probe, 200 HTML is dead, no fake snapshot');
process.exit(0);
