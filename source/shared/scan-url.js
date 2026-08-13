/**
 * Pre-fetch gate for a guest scan. `guest-scan.js` (parseGuestHtml /
 * normalizeGuestScan) owns what happens to a page once it has been
 * fetched; this module owns whether the launcher is allowed to fetch it
 * at all. That split matters because a guest scan is the first outbound
 * network call this app makes — the SSRF boundary lives here, before any
 * HTML parsing, not inside the parser.
 *
 * `isScanSafeUrl` is the one gate. Deliberately stricter than
 * `normalizePublishedUrl`: the host allowlist is re-checked here rather
 * than trusted from the caller, plus a pass a storage-normalizer never
 * needs — reject anything that could resolve to this machine or a private
 * network, because `x.com`/`twitter.com` never legitimately do. No
 * exception is carved out for the launcher's own `127.0.0.1:<port>` — a
 * guest scan has no legitimate reason to target it, so every loopback and
 * private-network host is rejected unconditionally rather than special-
 * cased around one port.
 */

import { normalizePublishedUrl } from './published-url.js';

const SCAN_HOSTS = new Set(['x.com', 'twitter.com']);

/** RFC1918 + loopback + link-local + IPv6 equivalents. No exceptions. */
function isPrivateOrLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0.0.0.0' || h === '0') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(h) || /^fd[0-9a-f]{2}:/i.test(h)) return true;
  if (/^fe80:/i.test(h)) return true;
  if (/^0x[0-9a-f]+$/i.test(h) || /^\d+$/.test(h)) return true;
  return false;
}

/**
 * True only if `url` is a GET-safe, already-normalized `x.com`/`twitter.com`
 * status link. Re-derives the normalized form itself rather than trusting a
 * caller's claim that a URL is already clean.
 */
export function isScanSafeUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return false;
  if (/\/Users\/|\/home\/|GoogleDrive/i.test(raw)) return false;

  const normalized = normalizePublishedUrl(raw);
  if (!normalized) return false;
  if (normalized !== raw) return false;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (!SCAN_HOSTS.has(host)) return false;
  if (isPrivateOrLoopbackHost(host)) return false; // unreachable given the allowlist above, kept as a hard second gate

  return true;
}

/** GET is the only method a guest scan may ever issue. */
export const SCAN_METHOD = 'GET';
