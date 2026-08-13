import { getPlatform } from './platforms.js';
import { PARTS } from './playbook.js';

/**
 * JS fallback scorer. A Rust/WASM crate may replace this later
 * by exporting the same `scorePost(post)` shape.
 */
export function scorePost(post) {
  const platform = getPlatform(post.platform);
  const hook = (post.hook || '').trim();
  const body = (post.body || '').trim();
  const cta = (post.cta || '').trim();
  const tags = post.hashtags || [];
  const media = post.media || [];
  const full = [hook, body, cta].join(' ');

  const checks = [];
  push(checks, 'hook', hook.length >= 8 && hook.length <= 90, 'Hook is short enough to read in a glance');
  push(checks, 'body', body.length >= 40, 'Body has enough meat to keep a stranger');
  push(checks, 'cta', Boolean(cta) && !/click here|link in bio/i.test(cta), 'Call is specific, not a generic wave');
  push(checks, 'hook-cta-echo', !hookRepeatsCta(hook, cta), 'Hook does not just repeat the call word-for-word');
  push(checks, 'length', full.length <= (platform.maxChars || 280), `Fits ${platform.label} length (${platform.maxChars} chars)`);
  push(checks, 'media', media.length > 0 || platform.id === 'x' || platform.id === 'linkedin', 'Media present, or platform can live on text');
  push(checks, 'tags', tags.length <= 6, 'Tags are sparse enough to look human');
  push(checks, 'form', Boolean(platform.bestForm), `Best form on ${platform.label}: ${platform.bestForm}`);

  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  return {
    score,
    band: score >= 80 ? 'ready' : score >= 55 ? 'draft' : 'thin',
    platform: platform.id,
    bestForm: platform.bestForm,
    parts: PARTS.length,
    checks
  };
}

function push(list, id, ok, note) {
  list.push({ id, ok: Boolean(ok), note });
}

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'and', 'or', 'of', 'for', 'in', 'on', 'is', 'it', 'your', 'you']);

function hookRepeatsCta(hook, cta) {
  const ctaWords = words(cta);
  if (!hook || !ctaWords.length) return false;
  const hookWords = new Set(words(hook));
  return ctaWords.every((w) => hookWords.has(w));
}

function words(s) {
  return String(s || '')
    .toLowerCase()
    .match(/[a-z0-9']+/g)
    ?.filter((w) => !STOPWORDS.has(w)) || [];
}

export async function scorePostMaybeWasm(post) {
  try {
    if (globalThis.__poststageScore) return globalThis.__poststageScore(post);
  } catch {
    /* fallback */
  }
  return scorePostLive(post);
}

/** Ask the local Rust scorer. Falls back to JS if the binary is not running. */
export async function scorePostLive(post) {
  const platform = getPlatform(post.platform);
  const payload = {
    hook: post.hook || '',
    body: post.body || '',
    cta: post.cta || '',
    tag_count: (post.hashtags || []).length,
    media_count: (post.media || []).length,
    platform: platform.id,
    platform_label: platform.label,
    max_chars: platform.maxChars || 280,
    has_best_form: Boolean(platform.bestForm),
    best_form: platform.bestForm || ''
  };
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.score === 'number' && Array.isArray(data.checks)) {
        data.engine = data.engine || 'rust';
        data.parts = PARTS.length;
        return data;
      }
    }
  } catch {
    /* js fallback */
  }
  const local = scorePost(post);
  local.engine = 'js';
  return local;
}
