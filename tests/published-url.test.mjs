/**
 * publishedUrl normalize: host + status id only. No fetch, no views.
 * Run: npm run test:published-url
 */

import {
  normalizePublishedUrl,
  W1_PUBLISHED_URL,
  W1_POST_ID
} from '../source/shared/published-url.js';

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('ok    ' + msg);
  else {
    failed += 1;
    console.log('FAIL  ' + msg);
  }
}

const WANT = 'https://x.com/Jayson_X/status/2087952991638716610';

ok(W1_POST_ID === 'slopo-w1-boxxy-x', 'W1 post id');
ok(normalizePublishedUrl(W1_PUBLISHED_URL) === WANT, 'fixture is already canonical');
ok(normalizePublishedUrl('https://twitter.com/Jayson_X/status/2087952991638716610?s=20&t=abc') === WANT, 'twitter.com + query');
ok(normalizePublishedUrl('http://www.x.com/Jayson_X/status/2087952991638716610#x') === WANT, 'www + hash + http');
ok(normalizePublishedUrl('https://mobile.twitter.com/Jayson_X/status/2087952991638716610') === WANT, 'mobile.twitter.com');
ok(normalizePublishedUrl('https://x.com/Jayson_X/status/2087952991638716610/photo/1') === WANT, 'photo suffix dropped');
ok(normalizePublishedUrl('https://x.com/i/status/2087952991638716610') === 'https://x.com/i/status/2087952991638716610', 'i/status kept');
ok(normalizePublishedUrl('') === null, 'empty is null');
ok(normalizePublishedUrl('   ') === null, 'whitespace is null');
ok(normalizePublishedUrl(null) === null, 'null');
ok(normalizePublishedUrl('javascript:alert(1)') === null, 'javascript:');
ok(normalizePublishedUrl('javascript:https://x.com/Jayson_X/status/1') === null, 'javascript with url');
ok(normalizePublishedUrl('/Users/me/status/1') === null, 'Users path');
ok(normalizePublishedUrl('https://evil.com/Jayson_X/status/2087952991638716610') === null, 'wrong host');
ok(normalizePublishedUrl('https://x.com/Jayson_X/statuses/2087952991638716610') === null, 'not /status/');
ok(normalizePublishedUrl('data:text/html,hi') === null, 'data:');
ok(!/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(WANT), 'fixture has no home path');
ok(!/views|likes|impress/i.test(WANT), 'fixture is not a count');

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('ok    publishedUrl normalize');
process.exit(0);
