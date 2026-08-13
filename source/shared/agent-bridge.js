/**
 * Browser side of the launcher agent API.
 *
 * The launcher normalises herdr output, so every agent here is
 * `{ pane_id, name, kind, status, cwd, focused, workspace_id, tab_id }`.
 * When herdr is not installed the launcher answers 200 with `herdr: false`
 * and an empty list — a missing herdr is a normal state, not an error.
 */

export async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { ok: false, herdr: false };
    const data = await res.json();
    return { ok: Boolean(data.ok), herdr: Boolean(data.herdr) };
  } catch {
    return { ok: false, herdr: false };
  }
}

/** Resolves to `{ herdr, agents }`. Throws only when the launcher itself fails. */
export async function listAgents() {
  const res = await fetch('/api/agents');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'herdr_unavailable');
  }
  const data = await res.json();
  const agents = Array.isArray(data.agents) ? data.agents : (data.result?.agents || []);
  return { herdr: data.herdr !== false, agents };
}

export async function sendAgent(target, text) {
  const res = await fetch('/api/agents/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, text })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'send_failed');
  }
  return res.json();
}

/** Read recent unwrapped output from a Herdr pane. Requires `GET /api/agents/read`. */
export async function readAgent(target) {
  const id = String(target || '').trim();
  if (!id) throw new Error('target_required');
  const res = await fetch(`/api/agents/read?target=${encodeURIComponent(id)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'read_failed');
  }
  const data = await res.json();
  return { text: String(data.text || '') };
}

const SHOP_SKIP = /^[\s│─┌┐└┘├┤┬┴┼╭╮╯╰═─\-+|]+$/;

/**
 * Lines a shop read must never hand back.
 *
 * `lastShopLine` reads a Herdr pane, and a pane is full of things that are not
 * post copy: a `cd`, an ENOENT, an export of a key. Keep puts whatever comes
 * back onto the idea lane, where it persists and can reach the stage — so a
 * leak here is a leak into saved work and, via Ask shop, back out again.
 *
 * The rule is **skip the line, do not sanitize it**. Redacting would hand the
 * operator a mangled half-line that reads like an idea; skipping falls through
 * to the next usable line, which is what they meant to keep. `brief.js` scrubs
 * because it must still send the surrounding sentence; here there is nothing
 * to preserve.
 */
const SHOP_UNSAFE = [
  // Home directories and cloud-synced roots, POSIX and Windows.
  /\/Users\//i,
  /(^|\/)home\/[^/\s]+/i,
  /[A-Za-z]:\\Users\\/i,
  /GoogleDrive|OneDrive|Dropbox|iCloud/i,
  // A home-relative or dot-relative path. A lone `/` in copy is not a path
  // (`make the hook /snappier` must Keep). `/Users/` and `/home/` are above.
  /(^|\s)(~\/|\.\/|\.\.\/)/,
  /file:\/\//i,
  // An address is someone's identity even when it is the operator's own.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  // Assignment-shaped secrets (`secret=` `password:` `API_KEY=…`). A bare
  // English word (`secret sauce`, `password prompt`) must Keep.
  /\b(api[_-]?key|secret|token|password|passwd|bearer|authorization)\s*[=:]\s*\S/i,
  // Vendor key prefixes. The tail may itself contain `-`/`_` separators
  // (`sk-live-abc…`, `xoxb-123-abc…`), so match the whole run, not one segment.
  /\b(sk|pk|ghp|gho|ghu|ghs|xox[abps])[-_][A-Za-z0-9][A-Za-z0-9_-]{7,}/
];

/** True when a pane line carries something that must not be kept. */
export function isUnsafeShopLine(line) {
  const s = String(line || '');
  return SHOP_UNSAFE.some((re) => re.test(s));
}

/**
 * Last usable line from a shop read — skips prompts, box art, noise, and
 * anything carrying a path, an address, or a secret.
 */
export function lastShopLine(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.length < 12) continue;
    if (line.startsWith('❯')) continue;
    if (SHOP_SKIP.test(line)) continue;
    if (isUnsafeShopLine(line)) continue;
    return line;
  }
  return '';
}

/** Short label for a cwd — the tail two segments are what tells panes apart. */
export function shortCwd(cwd) {
  const parts = String(cwd || '').split('/').filter(Boolean);
  if (!parts.length) return '';
  return parts.slice(-2).join('/');
}
