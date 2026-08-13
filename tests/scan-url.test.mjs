/**
 * scan-url.js — the pre-fetch SSRF gate for a guest scan. Run: node tests/scan-url.test.mjs
 *
 * `source/shared/guest-scan.js` already owns what happens to a page once it
 * has been fetched (see tests/guest-scan.test.mjs, fully covered). This is
 * the other half: whether the launcher is allowed to fetch a URL at all.
 * Written from scratch — no fetch or URL-safety code existed anywhere in
 * this app before this task; the launcher had never made an outbound
 * network call. That makes this the actual SSRF boundary for the feature,
 * and it did not exist to test until now.
 */

import { isScanSafeUrl, SCAN_METHOD } from '../source/shared/scan-url.js';
import { W1_PUBLISHED_URL } from '../source/shared/published-url.js';

let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log('ok    ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + name + '\n        ' + err.message);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy');
}

// --- accepted ---------------------------------------------------------

t('a clean, already-normalized x.com status link is scan-safe', () => {
  ok(isScanSafeUrl('https://x.com/jayson_x/status/42'), 'accepted');
});

t('the real W1 fixture from published-url.js is scan-safe', () => {
  ok(isScanSafeUrl(W1_PUBLISHED_URL), 'the actual live post URL passes');
});

// --- must already be normalized, not just "would normalize to something" -

t('a raw twitter.com link is not scan-safe — it normalizes to x.com, so it is not "already normalized"', () => {
  ok(!isScanSafeUrl('https://twitter.com/jayson_x/status/42'), 'not already-canonical, so refused');
});

t('a URL that needs rewriting is not scan-safe, even if the rewrite would be fine', () => {
  ok(!isScanSafeUrl('https://www.x.com/jayson_x/status/42'), 'www. would be rewritten');
  ok(!isScanSafeUrl('https://x.com/jayson_x/status/42/'), 'trailing slash would be rewritten');
  ok(!isScanSafeUrl('https://x.com/jayson_x/status/42?s=20'), 'query would be stripped');
  ok(!isScanSafeUrl('http://x.com/jayson_x/status/42'), 'http would be upgraded to https');
});

// --- scheme -------------------------------------------------------------

t('only https is scan-safe for an actual fetch, even though storage accepts http', () => {
  ok(!isScanSafeUrl('http://x.com/jayson_x/status/42'), 'plaintext http rejected for a real outbound GET');
});

t('non-http(s) schemes are rejected', () => {
  ok(!isScanSafeUrl('javascript:alert(1)'), 'javascript:');
  ok(!isScanSafeUrl('data:text/html,hi'), 'data:');
  ok(!isScanSafeUrl('file:///etc/passwd'), 'file:');
  ok(!isScanSafeUrl('ftp://x.com/jayson_x/status/42'), 'ftp:');
});

// --- host allowlist, including SSRF-shaped tricks ------------------------

t('a different host entirely is rejected', () => {
  ok(!isScanSafeUrl('https://evil.com/jayson_x/status/42'), 'wrong host');
  ok(!isScanSafeUrl('https://x.com.evil.com/jayson_x/status/42'), 'subdomain trick');
  ok(!isScanSafeUrl('https://x.com@evil.com/jayson_x/status/42'), 'userinfo smuggling — evil.com is the real host');
});

t('SSRF to localhost is rejected, including on the launcher\'s own port', () => {
  ok(!isScanSafeUrl('https://localhost/jayson_x/status/42'), 'localhost by name');
  ok(!isScanSafeUrl('https://127.0.0.1/jayson_x/status/42'), 'IPv4 loopback');
  ok(!isScanSafeUrl('https://127.0.0.1:7744/jayson_x/status/42'), 'loopback with the launcher\'s own port — "except self" is not carved out');
  ok(!isScanSafeUrl('https://0.0.0.0/jayson_x/status/42'), '0.0.0.0');
  ok(!isScanSafeUrl('https://[::1]/jayson_x/status/42'), 'IPv6 loopback');
});

t('SSRF to private network ranges is rejected', () => {
  ok(!isScanSafeUrl('https://10.0.0.5/jayson_x/status/42'), '10.0.0.0/8');
  ok(!isScanSafeUrl('https://192.168.1.1/jayson_x/status/42'), '192.168.0.0/16');
  ok(!isScanSafeUrl('https://172.16.0.1/jayson_x/status/42'), '172.16.0.0/12 (low end)');
  ok(!isScanSafeUrl('https://172.31.255.255/jayson_x/status/42'), '172.16.0.0/12 (high end)');
  ok(!isScanSafeUrl('https://169.254.169.254/jayson_x/status/42'), 'link-local / cloud metadata address');
});

t('numeric-shorthand IP tricks are rejected rather than half-parsed', () => {
  ok(!isScanSafeUrl('https://2130706433/jayson_x/status/42'), 'decimal shorthand for 127.0.0.1');
  ok(!isScanSafeUrl('https://0x7f000001/jayson_x/status/42'), 'hex shorthand for 127.0.0.1');
});

t('a home path anywhere in the candidate string is rejected outright', () => {
  ok(!isScanSafeUrl('/Users/someone/status/42'), 'bare home path');
  ok(!isScanSafeUrl('https://x.com/jayson_x/status/42?x=/Users/someone'), 'home path in a query param');
});

t('a non-status path is rejected', () => {
  ok(!isScanSafeUrl('https://x.com/jayson_x'), 'profile link, not a post');
  ok(!isScanSafeUrl('https://x.com/jayson_x/status/abc'), 'non-digit id');
});

t('SCAN_METHOD is GET and nothing else', () => {
  eq(SCAN_METHOD, 'GET');
});

t('junk input never throws', () => {
  ok(!isScanSafeUrl(null), 'null');
  ok(!isScanSafeUrl(undefined), 'undefined');
  ok(!isScanSafeUrl(''), 'empty');
  ok(!isScanSafeUrl('   '), 'whitespace');
  ok(!isScanSafeUrl(42), 'number');
  ok(!isScanSafeUrl({}), 'object');
  ok(!isScanSafeUrl('not a url'), 'plain text');
});

console.log(failed ? `\n${failed} FAILED` : '\nall scan-url tests pass');
process.exit(failed ? 1 : 0);
