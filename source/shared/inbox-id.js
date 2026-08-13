/**
 * Stable inbox ids. Seeds often omit `id`; POST mints one. GET/pull must
 * still land the row, and the same text must not fork a new post every refresh.
 * Generated ids are never home paths or emails.
 */

export function isSafeInboxId(raw) {
  const id = String(raw || '').trim();
  if (!id || id.length > 80) return false;
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(id)) return false;
  if (/@/.test(id) || /:\/\//.test(id) || /[/\\]/.test(id)) return false;
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

/** FNV-1a of title/hook/body/cta/platform/source — same text, same id. */
export function stableInboxId(item) {
  const s = [
    String((item && item.title) || ''),
    String((item && item.hook) || ''),
    String((item && item.body) || ''),
    String((item && item.cta) || ''),
    String((item && item.platform) || ''),
    String((item && item.source) || '')
  ].join('\0');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'inbox-' + (h >>> 0).toString(16).padStart(8, '0');
}

/** Keep a safe existing id; otherwise stamp a stable one from the copy. */
export function inboxIdFromItem(item) {
  const given = String((item && item.id) || '').trim();
  if (isSafeInboxId(given)) return given;
  return stableInboxId(item);
}
