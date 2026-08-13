import { execSync, spawnSync, exec, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, createReadStream, statSync } from 'fs';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { extname, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import net from 'net';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '../..');
const WORKSPACE = resolve(ROOT, '..');
const SHOTS_DIR = resolve(WORKSPACE, 'scaffold/shots');
const SHOT_SCRIPT = resolve(__dir, 'capture-shot.mjs');
const INBOX_DIR = resolve(WORKSPACE, 'scaffold/inbox');
const INBOX_FILE = resolve(INBOX_DIR, 'posts.json');
const INBOX_SEED = resolve(INBOX_DIR, 'seed-banter.json');
const CERTS = resolve(ROOT, 'build/certs');
const CERT  = resolve(CERTS, 'localhost.pem');
const KEY   = resolve(CERTS, 'localhost-key.pem');
const MIN_NODE = 18;

function checkToolchain(cmd, name, installCmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    console.error(`❌ ${name} missing. Required for this project.\nInstall: ${installCmd[process.platform] || 'Manual install'}`);
    return false;
  }
}

const nodeMajor = parseInt(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE) {
  console.error(`Node ${MIN_NODE}+ required. Running ${process.versions.node}.`);
  process.exit(1);
}

function mkcertInstalled() {
  try {
    execSync(process.platform === 'win32' ? 'where mkcert' : 'which mkcert', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function certsExist() {
  return existsSync(CERT) && existsSync(KEY);
}

function certValid() {
  if (!certsExist()) return false;
  
  const result = spawnSync('openssl', ['x509', '-noout', '-enddate', '-in', CERT], { encoding: 'utf8' });
  
  if (result.status === 0) {
    const expiry = new Date(result.stdout.replace('notAfter=', '').trim());
    return (expiry - Date.now()) / 86400000 > 30; // regenerate if under 30 days
  }

  const stats = statSync(CERT);
  return (Date.now() - stats.mtimeMs) / 86400000 < 365;
}

function generateCerts() {
  mkdirSync(CERTS, { recursive: true });
  execSync(`mkcert -cert-file "${CERT}" -key-file "${KEY}" localhost 127.0.0.1`, { stdio: 'inherit', cwd: ROOT });
}

function mkcertInstallHint() {
  return {
    win32:  'winget install FiloSottile.mkcert',
    darwin: 'brew install mkcert',
    linux:  'https://github.com/FiloSottile/mkcert/releases'
  }[process.platform] || 'https://github.com/FiloSottile/mkcert/releases';
}

/**
 * True when HTTPS is usable. Never throws: a missing mkcert, an unwritable
 * trust store, a broken CA, or a full disk all degrade to `false` so the
 * launcher can serve HTTP instead of dying on first run.
 */
function setupHttpsCerts() {
  if (!mkcertInstalled()) return false;
  if (certValid()) return true;
  console.log('Setting up local HTTPS certs...');
  try {
    execSync('mkcert -install', { stdio: 'inherit' });
    generateCerts();
  } catch (err) {
    // Message only — never the command or paths, which carry the home directory.
    console.warn(`Could not create local certs: ${certFailureReason(err)}`);
    return false;
  }
  console.log('Certs ready.\n');
  return certValid();
}

/**
 * Short, path-free reason for a cert failure.
 *
 * The fallback used to try to redact paths out of `err.message` with a
 * regex, but a path containing a space (e.g. this workspace's own "My
 * Drive" folder) breaks the non-whitespace match into two runs and leaves
 * the bare word between them — "Drive" — sitting in the output unredacted.
 * Selective stripping can't be made safe against every quoting/spacing
 * shape a spawned command might produce, so the fallback omits the raw
 * message rather than trying to sanitize it.
 */
function certFailureReason(err) {
  const code = err && err.code;
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  if (code === 'ENOSPC') return 'no space left on device';
  if (code === 'ENOENT') return 'mkcert could not be run';
  return 'mkcert or cert generation failed';
}

const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const certsOnly = args.includes('--certs-only');

if (certsOnly) {
  if (!mkcertInstalled()) {
    console.error(`\nmkcert not found. Install it:\n  ${mkcertInstallHint()}\n`);
    process.exit(1);
  }
  // Generating certs is the whole job of this flag, so a failure is fatal here
  // even though the normal start path degrades to HTTP.
  if (!certValid() && !setupHttpsCerts()) {
    console.error('Could not create local certs.');
    process.exit(1);
  }
  console.log('certs ready');
  process.exit(0);
}

const useHttps = setupHttpsCerts();
if (!useHttps) {
  console.log('No mkcert / certs cannot be created — serving HTTP on 127.0.0.1\n');
}

/** Loopback only. The launcher is local-first; nothing here is for the network. */
const LISTEN_HOST = '127.0.0.1';

// Probe on the same host the real server binds. Omitting it makes Node listen
// on `::` (all interfaces), which briefly exposes the probe and, worse, tests
// whether the port is free on the wrong interface.
function findFreePort(start = 3000, host = LISTEN_HOST) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(start, host, () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', () => resolve(findFreePort(start + 1, host)));
  });
}

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css',   '.json': 'application/json',
  '.png': 'image/png',  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2',  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm'
};

const { csp } = await import(pathToFileURL(resolve(ROOT, 'config/csp.config.js')).href);
const headers = isDev ? csp.local : csp.production;

console.log(isDev ? "⚠️  Development Mode: Relaxed CSP" : "🔒 Production Mode: Strict CSP");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// herdr may be absent on this machine. Never let that throw out of the handler:
// a missing binary makes spawnSync return status null with r.error set, and the
// dock has to degrade to "offline", not take the launcher down.
function runHerdr(argv) {
  let r;
  try {
    r = spawnSync('herdr', argv, { encoding: 'utf8', timeout: 15000 });
  } catch (err) {
    return { ok: false, missing: true, status: null, stdout: '', stderr: String(err.message || err) };
  }
  if (r.error) {
    const missing = r.error.code === 'ENOENT';
    return { ok: false, missing, status: null, stdout: '', stderr: String(r.error.message || r.error) };
  }
  return { ok: r.status === 0, missing: false, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

let herdrPresence = null;
function herdrAvailable() {
  if (herdrPresence !== null) return herdrPresence;
  try {
    execSync(process.platform === 'win32' ? 'where herdr' : 'which herdr', { stdio: 'ignore' });
    herdrPresence = true;
  } catch {
    herdrPresence = false;
  }
  return herdrPresence;
}

// herdr agent list answers {id, result:{agents:[...]}}; older builds answered
// with a bare {agents:[...]}. Normalise to the fields the dock renders so the
// browser never has to know which shape it got.
function scoreBin() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const release = resolve(ROOT, `build/score/target/release/poststage-score${ext}`);
  const debug = resolve(ROOT, `build/score/target/debug/poststage-score${ext}`);
  if (existsSync(release)) return release;
  if (existsSync(debug)) return debug;
  return '';
}

function normalizeAgents(parsed) {
  const raw = parsed?.result?.agents || parsed?.agents || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => ({
    pane_id: a.pane_id || '',
    name: a.name || a.agent || a.pane_id || 'agent',
    kind: a.agent || 'unknown',
    status: a.agent_status || 'unknown',
    cwd: a.foreground_cwd || a.cwd || '',
    focused: Boolean(a.focused),
    workspace_id: a.workspace_id || '',
    tab_id: a.tab_id || ''
  })).filter((a) => a.pane_id);
}

function inboxId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readInboxPosts() {
  mkdirSync(INBOX_DIR, { recursive: true });
  let posts = [];
  if (existsSync(INBOX_FILE)) {
    try {
      const data = JSON.parse(readFileSync(INBOX_FILE, 'utf8'));
      if (Array.isArray(data.posts)) posts = data.posts;
    } catch {
      posts = [];
    }
  }
  if (!posts.length && existsSync(INBOX_SEED)) {
    try {
      const seed = JSON.parse(readFileSync(INBOX_SEED, 'utf8'));
      if (Array.isArray(seed.posts) && seed.posts.length) {
        posts = seed.posts;
        writeFileSync(INBOX_FILE, JSON.stringify({ posts }, null, 2));
      }
    } catch {
      /* empty inbox */
    }
  }
  return posts;
}

function writeInboxPosts(posts) {
  mkdirSync(INBOX_DIR, { recursive: true });
  writeFileSync(INBOX_FILE, JSON.stringify({ posts }, null, 2));
}

const portArgIdx = args.indexOf('--port');
const port = portArgIdx !== -1 ? parseInt(args[portArgIdx + 1]) : await findFreePort(7744);
const swVersion = Date.now();
const baseOrigin = useHttps ? 'https://localhost' : 'http://127.0.0.1';

async function handleRequest(req, res) {
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  const url = new URL(req.url || '/', baseOrigin);

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, herdr: herdrAvailable(), rust: Boolean(scoreBin()) });
  }

  if (url.pathname === '/api/inbox' && req.method === 'GET') {
    return json(res, 200, { posts: readInboxPosts() });
  }

  if (url.pathname === '/api/inbox' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch {
      return json(res, 400, { error: 'invalid_json' });
    }
    if (!payload || typeof payload !== 'object') {
      return json(res, 400, { error: 'invalid_body' });
    }
    const posts = readInboxPosts();
    const entry = {
      id: String(payload.id || '').trim() || inboxId(),
      title: String(payload.title || ''),
      hook: String(payload.hook || ''),
      body: String(payload.body || ''),
      cta: String(payload.cta || ''),
      platform: String(payload.platform || 'x'),
      audience: String(payload.audience || ''),
      source: String(payload.source || 'banter')
    };
    posts.push(entry);
    writeInboxPosts(posts);
    return json(res, 200, { ok: true, post: entry, posts });
  }

  if (url.pathname === '/api/score' && req.method === 'POST') {
    const bin = scoreBin();
    if (!bin) return json(res, 503, { error: 'rust_scorer_missing', engine: 'js' });
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch {
      return json(res, 400, { error: 'invalid_json' });
    }
    const r = spawnSync(bin, [], {
      input: JSON.stringify(payload || {}),
      encoding: 'utf8',
      timeout: 3000
    });
    if (r.status !== 0) {
      return json(res, 502, { error: 'rust_score_failed', detail: (r.stderr || r.stdout || '').slice(0, 1000) });
    }
    try {
      return json(res, 200, JSON.parse(r.stdout));
    } catch {
      return json(res, 502, { error: 'rust_score_parse', raw: (r.stdout || '').slice(0, 1000) });
    }
  }

  if (url.pathname === '/api/agents' && req.method === 'GET') {
    if (!herdrAvailable()) return json(res, 200, { ok: true, herdr: false, agents: [] });
    const r = runHerdr(['agent', 'list']);
    if (!r.ok) {
      if (r.missing) return json(res, 200, { ok: true, herdr: false, agents: [] });
      return json(res, 502, { error: 'herdr_unavailable', detail: r.stderr || r.stdout });
    }
    let parsed;
    try { parsed = JSON.parse(r.stdout); } catch {
      return json(res, 502, { error: 'herdr_parse', raw: r.stdout.slice(0, 2000) });
    }
    return json(res, 200, { ok: true, herdr: true, agents: normalizeAgents(parsed) });
  }

  if (url.pathname === '/api/agents/read' && req.method === 'GET') {
    const target = (url.searchParams.get('target') || '').trim();
    if (!target) return json(res, 400, { error: 'target_required' });
    if (!herdrAvailable()) return json(res, 503, { error: 'herdr_missing', herdr: false });
    const r = runHerdr(['agent', 'read', target, '--source', 'recent-unwrapped', '--lines', '80']);
    if (!r.ok) {
      if (r.missing) return json(res, 503, { error: 'herdr_missing', herdr: false });
      return json(res, 502, { error: 'read_failed' });
    }
    let parsed;
    try { parsed = JSON.parse(r.stdout); } catch {
      return json(res, 502, { error: 'herdr_parse' });
    }
    const text = String(parsed?.result?.read?.text ?? parsed?.result?.text ?? parsed?.text ?? '').trim().slice(0, 4000);
    return json(res, 200, { ok: true, target, text });
  }

  if (url.pathname === '/api/agents/send' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch {
      return json(res, 400, { error: 'invalid_json' });
    }
    const target = String(payload.target || '').trim();
    const text = String(payload.text || '').trim();
    if (!target || !text) return json(res, 400, { error: 'target_and_text_required' });
    if (!herdrAvailable()) return json(res, 503, { error: 'herdr_missing', herdr: false });
    const sent = runHerdr(['agent', 'send', target, text]);
    if (!sent.ok) {
      if (sent.missing) return json(res, 503, { error: 'herdr_missing', herdr: false });
      return json(res, 502, { error: 'send_failed', detail: sent.stderr || sent.stdout });
    }
    runHerdr(['pane', 'send-keys', target, 'enter']);
    return json(res, 200, { ok: true, target });
  }

  if (url.pathname === '/service-worker.js') {
    const sw = readFileSync(resolve(ROOT, 'service-worker.js'), 'utf8')
      .replace('__CACHE_VERSION__', isDev ? `dev-${swVersion}` : swVersion);
    res.setHeader('Content-Type', 'application/javascript');
    res.end(sw);
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  let filePath = resolve(ROOT, `.${rel}`);
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) filePath = resolve(ROOT, '404.html');
  res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
  createReadStream(filePath).on('error', () => res.end()).pipe(res);
}

function shotStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function scheduleDevShot(appUrl) {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const latest = resolve(SHOTS_DIR, 'latest.png');
  const stamped = resolve(SHOTS_DIR, `${shotStamp()}.png`);
  spawn(process.execPath, [SHOT_SCRIPT, appUrl, latest, stamped], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true
  });
}

function startDevShots(appUrl) {
  setTimeout(() => scheduleDevShot(appUrl), 1500);
  setInterval(() => scheduleDevShot(appUrl), 60000);
}

const server = useHttps
  ? createHttpsServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, handleRequest)
  : createHttpServer(handleRequest);

const listenHost = LISTEN_HOST;
server.listen(port, listenHost, () => {
  const url = useHttps ? `https://localhost:${port}` : `http://127.0.0.1:${port}`;
  console.log(`\n${url}\n`);

  if (!args.includes('--no-open')) {
    const open = { win32: `start ${url}`, darwin: `open ${url}`, linux: `xdg-open ${url}` };
    const cmd = open[process.platform];
    if (cmd) exec(cmd);
  }

  if (isDev) startDevShots(url);
});
