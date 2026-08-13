import { csp } from '../../config/csp.config.js';
import { writeFileSync, readFileSync, mkdirSync, cpSync, readdirSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = resolve(__dir, '../..');
const DEPLOY = resolve(ROOT, 'pipeline/deploy');

// Ensure clean deploy target directory
mkdirSync(DEPLOY, { recursive: true });

// Write CSP header rules for Cloudflare Pages (_headers)
const lines = ['/*'];
Object.entries(csp.production).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
writeFileSync(resolve(DEPLOY, '_headers'), lines.join('\n'));

// Copy all root level assets (images, static files, configs)
const rootFiles = readdirSync(ROOT);
const allowedExtensions = ['.html', '.css', '.js', '.json', '.png', '.svg', '.ico', '.ttf'];
const excludedFiles = ['package.json', 'package-lock.json', 'sw.js', 'service-worker.js', 'fix_styles.py', 'verify.js'];

rootFiles.forEach(file => {
  const ext = extname(file).toLowerCase();
  if (allowedExtensions.includes(ext) && !excludedFiles.includes(file)) {
    cpSync(resolve(ROOT, file), resolve(DEPLOY, file));
  }
});

// Recursively copy source/ folder to deploy folder
const sourceDir = resolve(ROOT, 'source');
try {
  cpSync(sourceDir, resolve(DEPLOY, 'source'), { recursive: true });
} catch (err) {
  console.log('Skipping source folder copy (it might not have contents yet or is empty):', err.message);
}

// Ingest, hash, and copy service-worker.js
const swSrc = readFileSync(resolve(ROOT, 'service-worker.js'), 'utf8');
const hash = Date.now().toString(36);
writeFileSync(resolve(DEPLOY, 'service-worker.js'), swSrc.replace('__CACHE_VERSION__', hash));

console.log('✅ Web build deployed successfully with all assets copied.');
