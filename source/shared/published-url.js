/**
 * Persistable live post URL. Host + status id only — no query, no fetch.
 * x.com / twitter.com + /status/ + digits. Reject javascript:, home paths,
 * and anything that is not http(s) on those hosts.
 */

export const W1_POST_ID = 'slopo-w1-boxxy-x';
export const W1_PUBLISHED_URL = 'https://x.com/Jayson_X/status/2087952991638716610';

const HOSTS = new Set(['x.com', 'twitter.com']);

export function normalizePublishedUrl(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/javascript:/i.test(s)) return null;
  if (/data:/i.test(s)) return null;
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let host = String(u.hostname || '').replace(/^www\./i, '').toLowerCase();
  if (host.startsWith('mobile.')) host = host.slice('mobile.'.length);
  if (!HOSTS.has(host)) return null;
  const path = String(u.pathname || '').replace(/\/+$/, '');
  const idMatch = path.match(/\/status\/(\d{1,20})(?:\/|$)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const segs = path.split('/').filter(Boolean);
  const statusAt = segs.findIndex((p) => p.toLowerCase() === 'status');
  let handle = 'i';
  if (statusAt === 1) handle = segs[0];
  if (handle.toLowerCase() === 'i' || handle.toLowerCase() === 'web') handle = 'i';
  if (handle !== 'i' && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  if (/Users|home|GoogleDrive/i.test(handle)) return null;
  return `https://x.com/${handle}/status/${id}`;
}
