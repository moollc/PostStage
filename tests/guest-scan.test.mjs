/**
 * Guest scan parser + persist shape: title/text/at only.
 * Fixtures that include views/likes must not land as stored fields.
 * Run: npm run test:guest-scan
 *
 * Does not spawn a launcher. Launcher route is asserted from source.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { parseGuestHtml, normalizeGuestScan } from '../source/shared/guest-scan.js';
import { W1_PUBLISHED_URL } from '../source/shared/published-url.js';

const here = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = resolve(here, '../build/scripts/launcher.js');
const launcherSrc = readFileSync(LAUNCHER, 'utf8');

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('ok    ' + msg);
  else {
    failed += 1;
    console.log('FAIL  ' + msg);
  }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A === B) console.log('ok    ' + msg);
  else {
    failed += 1;
    console.log('FAIL  ' + msg + `: ${A} !== ${B}`);
  }
}

const HTML = `
<html><head>
<meta property="og:title" content="You wouldn't post a video you haven't watched, right?">
<meta property="og:description" content="Slop Makers: BoxxyVid">
<meta name="twitter:title" content="ignored if og present">
<meta itemprop="userInteractionCount" content="26">
<meta property="og:image" content="https://pbs.twimg.com/x.jpg">
<script type="application/ld+json">{"interactionStatistic":{"userInteractionCount":26},"likes":9}</script>
</head><body>26 views · 9 likes · 2 replies · 1 quote</body></html>
`;

const parsed = parseGuestHtml(HTML);
ok(parsed && parsed.title.includes("wouldn't post a video"), 'og:title');
eq(parsed.text, 'Slop Makers: BoxxyVid', 'og:description');
ok(!('views' in parsed), 'parse has no views key');
ok(!('likes' in parsed), 'parse has no likes key');
ok(!('replies' in parsed), 'parse has no replies key');
ok(!JSON.stringify(parsed).includes('26'), 'does not copy interaction count');
ok(!JSON.stringify(parsed).includes('fxtwitter'), 'no fxtwitter');

const snap = normalizeGuestScan({
  ...parsed,
  at: '2026-08-13T20:00:00.000Z',
  views: 26,
  likes: 9,
  replies: 2,
  quotes: 1,
  html: HTML
});
eq(Object.keys(snap).sort(), ['at', 'text', 'title'], 'persist keys');
eq(snap.at, '2026-08-13T20:00:00.000Z', 'at kept');
ok(!('views' in snap) && !('likes' in snap) && !('html' in snap), 'counts and html dropped');

eq(normalizeGuestScan({ views: 26 }), null, 'counts-only is not a snapshot');
eq(parseGuestHtml(''), null, 'empty html');
eq(parseGuestHtml('<html><title>no og</title></html>'), null, 'no og tags');

ok(launcherSrc.includes("url.pathname === '/api/guest-scan'"), 'launcher has guest-scan route');
ok(/normalizePublishedUrl/.test(launcherSrc) && /parseGuestHtml/.test(launcherSrc), 'allowlist + parser');
ok(!/fxtwitter/i.test(launcherSrc), 'launcher does not mention fxtwitter');
ok(/return json\(res, 200, \{ ok: true, at: snap\.at, title: snap\.title, text: snap\.text \}\)/.test(launcherSrc), '200 body is identity only');
ok(launcherSrc.includes('isLoopbackRequest'), 'loopback gate');
ok(!launcherSrc.includes(W1_PUBLISHED_URL), 'launcher does not hardcode the fixture fetch');

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('ok    guest scan identity only');
process.exit(0);
