/**
 * Guest scan of a public X status page. Identity only: title, text, and
 * a scan timestamp. Never views, likes, replies, quotes, or fxtwitter.
 */

const TITLE_MAX = 500;
const TEXT_MAX = 4000;

function decodeEntities(raw) {
  return String(raw || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function metaContent(html, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    `<meta\\b[^>]*\\b(?:property|name)=["']${esc}["'][^>]*\\bcontent="([^"]*)"`,
    `<meta\\b[^>]*\\b(?:property|name)=["']${esc}["'][^>]*\\bcontent='([^']*)'`,
    `<meta\\b[^>]*\\bcontent="([^"]*)"[^>]*\\b(?:property|name)=["']${esc}["']`,
    `<meta\\b[^>]*\\bcontent='([^']*)'[^>]*\\b(?:property|name)=["']${esc}["']`
  ];
  for (const p of patterns) {
    const m = html.match(new RegExp(p, 'i'));
    if (m) return decodeEntities(m[1]);
  }
  return '';
}

function collapse(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Pull og/twitter title + description from public HTML.
 * Ignores interaction counts and json-ld statistics on purpose.
 */
export function parseGuestHtml(html) {
  if (typeof html !== 'string' || !html) return null;
  const title = collapse(metaContent(html, 'og:title') || metaContent(html, 'twitter:title'));
  const text = collapse(
    metaContent(html, 'og:description') || metaContent(html, 'twitter:description')
  );
  if (!title && !text) return null;
  return {
    title: title.slice(0, TITLE_MAX),
    text: text.slice(0, TEXT_MAX)
  };
}

/**
 * Persist shape: `{ at, title, text }` only. Extra keys (views, likes, html)
 * are dropped. Empty title and text together is not a snapshot.
 */
export function normalizeGuestScan(value) {
  if (!value || typeof value !== 'object') return null;
  const title = collapse(value.title).slice(0, TITLE_MAX);
  const text = collapse(value.text).slice(0, TEXT_MAX);
  if (!title && !text) return null;
  const rawAt = typeof value.at === 'string' ? value.at.trim() : '';
  const at = rawAt && !Number.isNaN(Date.parse(rawAt)) ? rawAt : null;
  return { at, title, text };
}
