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
 * A page that is serving "this post is gone" rather than the post.
 *
 * X answers a deleted or suspended status with **HTTP 200 and an error page**,
 * so `res.ok` is true and the og: tags parse cleanly. Without this check the
 * scan would happily record "Post not found" as the post's title and overwrite
 * a good snapshot of what the operator actually published — replacing a real
 * record with a screenshot of a door.
 *
 * Matched on the parsed title/description only, never on body scraping, and
 * anchored so a real post *about* a deleted post is not caught by accident.
 */
// `['’]?` throughout: X renders a curly apostrophe in "doesn’t", and a straight
// one appears in cached or proxied copies. Matching only one shape would let
// the other through, which is exactly the case this guard exists for.
const DEAD_PAGE = [
  /^(this )?post (is )?(not available|unavailable|not found)/i,
  /^(this )?(tweet|page) (is )?(not available|unavailable|not found)/i,
  /^(sorry, ?)?(that page|this page|this account) ?(doesn['’]?t exist|does not exist|is gone)/i,
  /^account suspended/i,
  /^(hmm[.…]*\s*)?this page (doesn['’]?t exist|does not exist)/i,
  /^(log in|sign up) (to |on )?x/i,
  /^something went wrong/i,
  /^(page )?not found$/i
];

/** True when a parsed title or description reads as a dead-post page. */
export function isDeadGuestPage(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const title = collapse(parsed.title);
  const text = collapse(parsed.text);
  // A dead page has no post text to show; a live post whose *title* happens to
  // start this way still has a description, so require both to be unhelpful.
  const titleDead = DEAD_PAGE.some((re) => re.test(title));
  if (!titleDead) return false;
  return !text || DEAD_PAGE.some((re) => re.test(text));
}

/**
 * Pull og/twitter title + description from public HTML.
 * Ignores interaction counts and json-ld statistics on purpose.
 *
 * Returns `null` for a dead-post page, so a caller keeps its last snapshot
 * rather than storing the error page as the post.
 */
export function parseGuestHtml(html) {
  if (typeof html !== 'string' || !html) return null;
  const title = collapse(metaContent(html, 'og:title') || metaContent(html, 'twitter:title'));
  const text = collapse(
    metaContent(html, 'og:description') || metaContent(html, 'twitter:description')
  );
  if (!title && !text) return null;
  const parsed = {
    title: title.slice(0, TITLE_MAX),
    text: text.slice(0, TEXT_MAX)
  };
  return isDeadGuestPage(parsed) ? null : parsed;
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
