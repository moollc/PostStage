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

/** Last usable line from a shop read — skips prompts, box art, and noise. */
export function lastShopLine(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.length < 12) continue;
    if (line.startsWith('❯')) continue;
    if (SHOP_SKIP.test(line)) continue;
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
