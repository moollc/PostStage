/**
 * Gate for copying `publishedUrl` to the clipboard. "Copy live" must never
 * put junk on the clipboard — not a home path, not a query string carrying
 * a view/like count, not a URL that needed rewriting to become clean. The
 * check is exact: the candidate string has to already equal its own
 * normalized form. If it does not, something upstream (a hand-edited
 * field, a stored value written before normalization existed, a paste that
 * still has a query string) has not been cleaned yet, and copying it as-is
 * would put that mess on the clipboard instead of a plain status link.
 *
 * This module makes no network call and has no opinion about http vs
 * https beyond what `normalizePublishedUrl` already decides — unlike
 * `scan-url.js` (the guest-scan fetch gate), which is stricter because it
 * is about to make an outbound request, not just copy text.
 */

import { normalizePublishedUrl } from './published-url.js';

/**
 * The exact string to put on the clipboard, or `null` if `raw` is not
 * already a clean status href. Never rewrites — either it is already
 * right, or nothing is copied.
 */
export function copyLiveText(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const normalized = normalizePublishedUrl(s);
  if (!normalized) return null;
  if (normalized !== s) return null;
  return s;
}

/** True when `copyLiveText` would actually produce something to copy. */
export function canCopyLive(raw) {
  return copyLiveText(raw) !== null;
}
