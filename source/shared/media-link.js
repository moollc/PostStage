/**
 * Persistable media references. Project-relative paths only — never a home
 * directory, never `data:video`. The launcher serves these at `/image?path=`.
 */

export function isSafeRelPath(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim().replace(/\\/g, '/');
  if (!s || s.length > 512) return false;
  if (s.includes('\0') || s.includes('://')) return false;
  if (s.startsWith('/') || s.startsWith('~') || /^[a-zA-Z]:/.test(s)) return false;
  const parts = s.split('/').filter((p) => p !== '.');
  if (!parts.length || parts.some((p) => !p || p === '..')) return false;
  const joined = parts.join('/');
  if (/(^|\/)Users(\/|$)/i.test(joined)) return false;
  if (/(^|\/)home(\/|$)/i.test(joined)) return false;
  if (/GoogleDrive/i.test(joined)) return false;
  return true;
}

export function mediaSrcForPath(path) {
  if (!isSafeRelPath(path)) return '';
  return '/image?path=' + encodeURIComponent(path.replace(/\\/g, '/'));
}

export function parseByteRange(header, size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return { kind: 'unsat' };
  if (!header) return { kind: 'all' };
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!m) return { kind: 'unsat' };
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return { kind: 'unsat' };
  if (!hasStart && hasEnd) {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsat' };
    const start = Math.max(0, n - suffix);
    return { kind: 'partial', start, end: n - 1 };
  }
  const start = Number(m[1]);
  let end = hasEnd ? Number(m[2]) : n - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= n) {
    return { kind: 'unsat' };
  }
  end = Math.min(end, n - 1);
  return { kind: 'partial', start, end };
}
