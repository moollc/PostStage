#!/usr/bin/env node
/**
 * Workspace structure gate — copy into each project's scripts/verify-workspace.mjs
 *
 * Run from the **repo folder** (e.g. myapp/). Parent workspace is ROOT/..
 *
 *   node scripts/verify-workspace.mjs
 *   node scripts/verify-workspace.mjs --fork=vite
 *   node scripts/verify-workspace.mjs --root=./my-app
 *   node scripts/verify-workspace.mjs --level=process|layout|app|multi-cli|all
 *   node scripts/verify-workspace.mjs --smoke
 *   node scripts/verify-workspace.mjs --smoke-console
 *
 * Levels match WORKSPACE_SETUP level extract: verify extracted disk artifacts,
 * not the mother setup markdown.
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';

const args = process.argv.slice(2);
const fork = args.find((a) => a.startsWith('--fork='))?.split('=')[1] || 'vanilla';
const rootArg = args.find((a) => a.startsWith('--root='))?.split('=')[1];
const levelRaw = args.find((a) => a.startsWith('--level='))?.split('=')[1] || 'app';
const ROOT = resolve(rootArg || process.cwd());
const PARENT = resolve(ROOT, '..');
const smoke = args.includes('--smoke') || args.includes('--smoke-console');
const smokeConsole = args.includes('--smoke-console');

const VALID_LEVELS = new Set(['process', 'layout', 'app', 'multi-cli', 'all']);
const level = VALID_LEVELS.has(levelRaw) ? levelRaw : null;

const errors = [];
const warnings = [];

function mustExist(rel, label = rel, base = ROOT) {
  if (!existsSync(join(base, rel))) errors.push(`Missing: ${label} (${rel})`);
}

function mustNotExist(rel, label = rel, base = ROOT) {
  if (existsSync(join(base, rel))) errors.push(`Should not be in repo: ${label} (${rel})`);
}

function nonEmptyFile(abs, label) {
  if (!existsSync(abs)) {
    errors.push(`Missing: ${label}`);
    return;
  }
  try {
    if (statSync(abs).size < 20) errors.push(`Too empty: ${label}`);
  } catch {
    errors.push(`Unreadable: ${label}`);
  }
}

function checkScaffoldNotInsideRepo() {
  if (existsSync(join(ROOT, 'scaffold'))) {
    errors.push('scaffold/ must be a sibling OUTSIDE the repo, not inside it');
  }
  if (existsSync(join(ROOT, 'scaffolds'))) {
    warnings.push('scaffolds/ inside repo — kit default keeps scaffold* on the workspace parent only');
  }
}

function checkGitBoundary() {
  const parentGit = join(PARENT, '.git');
  const repoGit = join(ROOT, '.git');
  if (existsSync(parentGit) && !existsSync(repoGit)) {
    errors.push(
      'git init is at workspace parent — run git init inside the repo folder only (e.g. myapp/)',
    );
  }
}

function checkHooksPath() {
  const r = spawnSync('git', ['config', 'core.hooksPath'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0 || !r.stdout?.trim()) return;
  const configured = r.stdout.trim();
  const candidates = [
    configured,
    resolve(ROOT, configured),
    configured.replace(/\//g, '\\'),
  ];
  if (!candidates.some((p) => existsSync(p))) {
    warnings.push(
      `core.hooksPath points to missing folder (${configured}) — re-run hooks/minimal/install.ps1`,
    );
  }
}

/** L1 — process files on workspace parent (extracted AGENTS + comms) */
function checkProcess() {
  nonEmptyFile(join(PARENT, 'AGENTS.md'), 'workspace parent AGENTS.md');
  const commsCandidates = [
    join(PARENT, 'scaffold', 'comms.md'),
    join(PARENT, 'scaffolds', 'comms.md'),
    join(PARENT, 'work', 'comms.md'),
  ];
  const comms = commsCandidates.find((p) => existsSync(p));
  if (!comms) {
    errors.push(
      'Missing comms on workspace parent (scaffold/comms.md, scaffolds/comms.md, or work/comms.md)',
    );
  } else {
    nonEmptyFile(comms, comms.replace(PARENT + '\\', '').replace(PARENT + '/', ''));
  }
}

/** L2 — layout / git boundary (no full app tree required) */
function checkLayout() {
  checkScaffoldNotInsideRepo();
  checkGitBoundary();
  const parentScaffold =
    existsSync(join(PARENT, 'scaffold')) || existsSync(join(PARENT, 'scaffolds'));
  if (!parentScaffold) {
    errors.push('Missing scaffold/ (or scaffolds/) on workspace parent — sibling of repo folder');
  }
}

/** L3 — app skeleton (Fork A or B) */
function checkVanilla() {
  mustExist('package.json');
  mustExist('index.html');
  mustExist('manifest.json');
  mustExist('service-worker.js');
  mustExist('build/scripts/launcher.js');
  mustExist('build/scripts/build-web.js');
  mustExist('config/csp.config.js');
  mustExist('start.bat');
  mustExist('source/shared/permissions.js');
  mustExist('source/shared/file-bridge.js');
  mustNotExist('build/certs');
  mustNotExist('node_modules');
  checkScaffoldNotInsideRepo();
  checkGitBoundary();
  checkHooksPath();
}

function checkVite() {
  mustExist('package.json');
  mustExist('vite.config.js');
  mustExist('index.html');
  const srcMain = ['src/main.jsx', 'src/main.js', 'src/main.tsx'].find((p) =>
    existsSync(join(ROOT, p)),
  );
  if (!srcMain) errors.push('Missing: src/main.jsx (or main.js / main.tsx)');
  mustNotExist('node_modules');
  checkScaffoldNotInsideRepo();
  checkGitBoundary();

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (!pkg.scripts?.build) errors.push('package.json must have a "build" script');

  if (errors.length) return;

  console.log('Running npm run build...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, shell: true, stdio: 'inherit' });
  if (build.status !== 0) errors.push('npm run build failed');
}

/** L5 — multi-CLI playbook on parent */
function checkMultiCli() {
  const multi = [
    join(PARENT, 'scaffold', 'MULTI-CLI.md'),
    join(PARENT, 'scaffolds', 'MULTI-CLI.md'),
  ].find((p) => existsSync(p));
  if (!multi) {
    errors.push('Missing MULTI-CLI.md under scaffold/ or scaffolds/ on workspace parent');
    return;
  }
  nonEmptyFile(multi, 'MULTI-CLI.md');
  const skillClaude = join(PARENT, '.claude', 'skills', 'multi-cli-agents', 'SKILL.md');
  const skillGrok = join(PARENT, '.grok', 'skills', 'multi-cli-agents', 'SKILL.md');
  if (!existsSync(skillClaude) && !existsSync(skillGrok)) {
    warnings.push(
      'multi-cli-agents skill not found under .claude/skills or .grok/skills (optional but recommended)',
    );
  }
}

function checkApp() {
  if (fork === 'vite') checkVite();
  else checkVanilla();
}

function runLevel(name) {
  console.log(`— level: ${name}`);
  if (name === 'process') checkProcess();
  else if (name === 'layout') checkLayout();
  else if (name === 'app') checkApp();
  else if (name === 'multi-cli') checkMultiCli();
}

function ensureCerts() {
  const cert = join(ROOT, 'build/certs/localhost.pem');
  if (existsSync(cert)) return true;

  console.log('smoke: generating certs via launcher --certs-only...');
  const gen = spawnSync(process.execPath, ['build/scripts/launcher.js', '--certs-only'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (gen.status !== 0) {
    errors.push('smoke: launcher --certs-only failed (install mkcert first)');
    return false;
  }
  return existsSync(cert);
}

function waitForLauncherUrl(proc, timeoutMs = 45000) {
  return new Promise((resolvePromise, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      killProcessTree(proc);
      reject(new Error('smoke: launcher did not print https://localhost URL in time'));
    }, timeoutMs);

    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        resolvePromise(`https://localhost:${m[1]}`);
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', (code) => {
      if (!buf.match(/https:\/\/localhost:\d+/)) {
        clearTimeout(timer);
        reject(new Error(`smoke: launcher exited (${code}) before URL was printed`));
      }
    });
  });
}

function killProcessTree(proc) {
  if (!proc?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  }
}

const SMOKE_RUNNER = `import { chromium } from 'playwright';
const url = process.argv[2];
const checkConsole = process.argv[3] === '1';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errs = [];
  if (checkConsole) {
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(e.message));
  }
  const res = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
    ignoreHTTPSErrors: true,
  });
  if (!res || !res.ok()) throw new Error('HTTP ' + (res ? res.status() : 'fail'));
  if (checkConsole && errs.length) throw new Error('console: ' + errs.join('; '));
  console.log('OK ' + url);
} finally {
  await browser.close();
}
`;

function runPlaywrightSmoke(url) {
  const smokeDir = mkdtempSync(join(tmpdir(), 'ws-smoke-'));
  const runner = join(smokeDir, 'run.mjs');
  writeFileSync(runner, SMOKE_RUNNER);

  const attempt = () =>
    spawnSync(
      'npx',
      ['-y', '-p', 'playwright', 'node', runner, url, smokeConsole ? '1' : '0'],
      { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 120000 },
    );

  let run = attempt();
  if (run.status !== 0 && /Executable doesn't exist|browserType\.launch/i.test(run.stderr || '')) {
    console.log('smoke: installing Playwright Chromium...');
    const install = spawnSync('npx', ['-y', 'playwright', 'install', 'chromium'], {
      cwd: ROOT,
      shell: true,
      stdio: 'inherit',
      timeout: 300000,
    });
    if (install.status === 0) run = attempt();
  }
  return run;
}

async function runSmoke() {
  if (fork !== 'vanilla') {
    console.log('smoke: skipped (Fork B — use npm run dev / preview manually)');
    return;
  }

  if (!ensureCerts()) return;

  console.log('smoke: starting launcher...');
  const launcherPath = join(ROOT, 'build/scripts/launcher.js');
  const proc = spawn(process.execPath, [launcherPath], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let url;
  try {
    url = await waitForLauncherUrl(proc);
  } catch (e) {
    errors.push(e.message);
    killProcessTree(proc);
    return;
  }

  const run = runPlaywrightSmoke(url);
  killProcessTree(proc);

  if (run.status !== 0) {
    const hint = (run.stderr || '').includes('Executable')
      ? ' — try: npx playwright install chromium'
      : '';
    errors.push(`smoke: browser check failed${hint}${run.stderr ? ` — ${run.stderr.trim()}` : ''}`);
    if (run.stdout?.trim()) console.log(run.stdout.trim());
    return;
  }
  if (run.stdout?.trim()) console.log(run.stdout.trim());
}

if (!level) {
  console.error(`FAIL\n  ✗ Unknown --level=${levelRaw} (use process|layout|app|multi-cli|all)`);
  process.exit(1);
}

console.log(
  `verify-workspace: fork=${fork} root=${ROOT} level=${level}${smoke ? ' (smoke)' : ''}\n`,
);

if (level === 'all') {
  for (const name of ['process', 'layout', 'app']) runLevel(name);
  const hasMulti =
    existsSync(join(PARENT, 'scaffold', 'MULTI-CLI.md')) ||
    existsSync(join(PARENT, 'scaffolds', 'MULTI-CLI.md'));
  if (hasMulti) runLevel('multi-cli');
  else warnings.push('level=all: skipped multi-cli (no MULTI-CLI.md on parent)');
} else {
  runLevel(level);
}

warnings.forEach((w) => console.warn(`  ⚠ ${w}`));

if (!errors.length && smoke && (level === 'app' || level === 'all')) {
  await runSmoke();
} else if (smoke && level !== 'app' && level !== 'all') {
  warnings.push('--smoke ignored unless --level=app or --level=all');
}

if (errors.length) {
  console.error('FAIL');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

const passMsg =
  smoke && (level === 'app' || level === 'all')
    ? `PASS — level ${level} OK + smoke`
    : `PASS — level ${level} OK`;
console.log(passMsg);
process.exit(0);