/**
 * Video link: project-relative paths only, Range parse, no home strings.
 * Run: npm run test:video-link
 */

import { isSafeRelPath, mediaSrcForPath, parseByteRange, IMAGE_ROUTE_PROBE, imageRouteFromHealth, imageRouteFromProbe } from '../source/shared/media-link.js';

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('ok    ' + msg);
  else {
    failed += 1;
    console.log('FAIL  ' + msg);
  }
}

ok(isSafeRelPath('tests/tiny-link.webm'), 'relative test path is safe');
ok(!isSafeRelPath('/Users/me/clip.webm'), 'absolute Users path is rejected');
ok(!isSafeRelPath('../../../etc/passwd'), 'dot-dot is rejected');
ok(!isSafeRelPath('C:\\\\Users\\\\me\\\\clip.webm'), 'drive path is rejected');
ok(!isSafeRelPath('home/me/clip.webm'), 'home segment is rejected');
ok(!isSafeRelPath('foo/GoogleDrive/clip.webm'), 'GoogleDrive is rejected');
ok(isSafeRelPath('source/assets/clip.webm'), 'source assets path is safe');
ok(mediaSrcForPath('tests/tiny-link.webm') === '/image?path=tests%2Ftiny-link.webm', 'src is /image?path= encoded');
ok(!/Users|home|GoogleDrive/i.test(mediaSrcForPath('tests/tiny-link.webm')), 'src has no home path');
ok(!mediaSrcForPath('/Users/me/a.webm'), 'unsafe path has no src');

const all = parseByteRange(undefined, 1000);
ok(all.kind === 'all', 'missing Range is whole file');
const part = parseByteRange('bytes=0-99', 1000);
ok(part.kind === 'partial' && part.start === 0 && part.end === 99, 'bytes=0-99');
const unsat = parseByteRange('bytes=500-10', 100);
ok(unsat.kind === 'unsat', 'inverted range is unsatisfiable');
const open = parseByteRange('bytes=50-', 100);
ok(open.kind === 'partial' && open.start === 50 && open.end === 99, 'open end');

ok(isSafeRelPath(IMAGE_ROUTE_PROBE), 'probe dummy is a safe rel path');
ok(!/Users|home|GoogleDrive/i.test(IMAGE_ROUTE_PROBE), 'probe dummy has no home path');
ok(
  mediaSrcForPath(IMAGE_ROUTE_PROBE) === '/image?path=' + encodeURIComponent(IMAGE_ROUTE_PROBE),
  'probe src is /image?path= dummy'
);
ok(imageRouteFromHealth({ imageRoute: true }), 'health imageRoute true is live');
ok(!imageRouteFromHealth({ ok: true, herdr: false, rust: false }), 'old health without imageRoute is not live');
ok(imageRouteFromProbe(206, { 'accept-ranges': 'bytes' }), '206 is live');
ok(imageRouteFromProbe(404, {}), '404 dummy is live (handler ran)');
ok(!imageRouteFromProbe(200, { 'content-type': 'text/html; charset=utf-8' }), '200 HTML is dead static fallback');

// --- the /image probe never reads the response body -----------------------
// probeImageRoute has two branches: an /api/health check (reads clean JSON,
// already covered by tests/health.test.mjs and browser-health-safety.mjs —
// fine to read) and the actual /image?path=__poststage_probe__ fetch, which
// classifies liveness from status + headers only via imageRouteFromProbe.
// A 404 there IS real HTML (build/404.html), but nothing has ever called
// .text()/.json() on THAT response to get that far. Source-inspect just the
// second branch so a later "let's also grab the error body for debugging"
// change cannot silently reintroduce a path where that HTML gets read, let
// alone stored — without also flagging the unrelated, already-safe
// /api/health read in the first branch as a false positive.
{
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { dirname, resolve } = await import('path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../source/app/index.js'), 'utf8');
  const fnStart = src.indexOf('async function probeImageRoute(');
  ok(fnStart >= 0, 'probeImageRoute exists in index.js');
  if (fnStart >= 0) {
    let depth = 0;
    let fnEnd = fnStart;
    for (let i = src.indexOf('{', fnStart); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (!depth) { fnEnd = i + 1; break; }
      }
    }
    const fnBody = src.slice(fnStart, fnEnd);
    // The second branch is the block starting at IMAGE_ROUTE_PROBE's use —
    // isolate it from the /api/health branch above it.
    const probeStart = fnBody.indexOf('IMAGE_ROUTE_PROBE');
    ok(probeStart >= 0, 'the /image probe branch uses IMAGE_ROUTE_PROBE');
    const probeBranch = fnBody.slice(probeStart);
    ok(!/\.text\(\)|\.json\(\)|\.blob\(\)|\.arrayBuffer\(\)/.test(probeBranch), 'the /image probe branch does not read the response body — status and headers only');
    ok(!/guestScan|setGuestScan/i.test(fnBody), 'the image-route probe has nothing to do with guest-scan storage — different feature, different code path');
  }
}

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('ok    video link paths and Range parse');
process.exit(0);
