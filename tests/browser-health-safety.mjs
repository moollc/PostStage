/**
 * Live path: GET /api/health leaks nothing — no home path, no email, no pid
 * used as a stand-in for a secret. Plain HTTP, no browser needed for this one.
 * 7744 only — do not spawn/kill. Run: npm run test:browser-health
 */

import http from 'http';

const ORIGIN = 'http://127.0.0.1:7744';

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

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body), raw: body });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
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

const LEAK_PATTERNS = [
  { name: 'a POSIX home path', re: /\/Users\/[a-zA-Z0-9_.-]+|\/home\/[a-zA-Z0-9_.-]+/ },
  { name: 'a Windows home path', re: /C:\\Users\\/i },
  { name: 'GoogleDrive folder name', re: /GoogleDrive/i },
  { name: 'an email address', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  // A bare, unlabeled numeric field with no other context reads as "pid used
  // as a secret" if it ever shows up here — health has no legitimate reason
  // to expose a process id at all, labeled or not.
  { name: 'a pid-shaped field', re: /"pid"\s*:\s*\d+/i }
];

try {
  const { status, json, raw } = await getJson(`${ORIGIN}/api/health`);
  if (status !== 200) fail(`GET /api/health → HTTP ${status}, expected 200`);

  for (const { name, re } of LEAK_PATTERNS) {
    if (re.test(raw)) fail(`/api/health response contains ${name}: ${JSON.stringify(raw)}`);
  }

  if (typeof json.ok !== 'boolean') fail(`"ok" is not a boolean: ${JSON.stringify(json.ok)}`);
  if ('herdr' in json && typeof json.herdr !== 'boolean') {
    fail(`"herdr" is present but not a boolean: ${JSON.stringify(json.herdr)}`);
  }
  if ('rust' in json && typeof json.rust !== 'boolean') {
    fail(`"rust" is present but not a boolean: ${JSON.stringify(json.rust)}`);
  }

  if ('imageRoute' in json && typeof json.imageRoute !== 'boolean') {
    fail(`"imageRoute" is present but not a boolean: ${JSON.stringify(json.imageRoute)}`);
  }
  if ('guestScanRoute' in json && typeof json.guestScanRoute !== 'boolean') {
    fail(`"guestScanRoute" is present but not a boolean: ${JSON.stringify(json.guestScanRoute)}`);
  }
  if ('started' in json) {
    if (typeof json.started !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(json.started)) {
      fail(`"started" is not an ISO timestamp: ${JSON.stringify(json.started)}`);
    }
  }

  // String fields other than boot `started` are the shape a path/pid leak
  // would take. `started` is an ISO stamp, already checked above.
  const stringFields = Object.entries(json).filter(([k, v]) => typeof v === 'string' && k !== 'started');
  if (stringFields.length) {
    fail(
      `/api/health has string field(s) ${JSON.stringify(stringFields.map(([k]) => k))} — ` +
        're-check each one is not a path, version string, or other leak once this exists'
    );
  }

  console.log('ok    /api/health leaks no home path, email, or pid; fields are booleans plus optional boot ISO');
} catch (err) {
  fail(`GET /api/health failed: ${err.message}`);
}

process.exit(0);
