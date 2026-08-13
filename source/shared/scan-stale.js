/**
 * Whether this process handles POST /api/guest-scan, or serves 404 HTML.
 * Same honesty as `/image`: a 200 HTML page is a dead launcher, not a scan.
 *
 * The probe body is a dummy token — never the operator’s publishedUrl, never
 * a home path, never a clip path. A live handler rejects it as JSON 400
 * (`invalid_url`). A stale process answers 200 HTML from 404.html.
 */

/** Dummy POST body. Not a URL, not a file path. */
export const GUEST_SCAN_PROBE = '__poststage_scan_probe__';

export const STALE_SCAN_HINT = 'scan will not run until the launcher is restarted';

export function guestScanRouteFromHealth(data) {
  return Boolean(data && data.guestScanRoute === true);
}

/**
 * Classify POST /api/guest-scan of GUEST_SCAN_PROBE.
 * Alive: JSON (handler ran — even 400 invalid_url).
 * Dead: 200 HTML (old static fallback) or 404.
 */
export function guestScanRouteFromProbe(status, headers = {}) {
  const type = String(headers['content-type'] || headers.contentType || '').toLowerCase();
  const code = Number(status);
  if (/json/.test(type)) return true;
  if (code === 200 && /html/.test(type)) return false;
  if (code === 404) return false;
  return false;
}
