/**
 * Video link: project-relative paths only, Range parse, no home strings.
 * Run: npm run test:video-link
 */

import { isSafeRelPath, mediaSrcForPath, parseByteRange } from '../source/shared/media-link.js';

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

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('ok    video link paths and Range parse');
process.exit(0);
