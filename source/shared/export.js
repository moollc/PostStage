import { getPlatform } from './platforms.js';

function trim(s) {
  return String(s || '').trim();
}

function tagLine(hashtags) {
  const tags = (hashtags || [])
    .map((t) => String(t).replace(/^#/, '').trim())
    .filter(Boolean)
    .map((t) => '#' + t);
  return tags.join(' ');
}

function joinSections(parts, sep = '\n\n') {
  return parts.map((s) => trim(s)).filter(Boolean).join(sep);
}

function withTagsIfFits(core, tags, maxChars) {
  if (!tags) return core;
  const sep = core ? '\n\n' : '';
  const candidate = core + sep + tags;
  return candidate.length <= maxChars ? candidate : core;
}

/** X / LinkedIn: hook, body, cta with blank lines; tags only when they fit maxChars. */
function formatParagraphPost(post, maxChars) {
  const core = joinSections([post.hook, post.body, post.cta]);
  return withTagsIfFits(core, tagLine(post.hashtags), maxChars);
}

/** IG / TikTok / Facebook: hook + body + cta, then tags on the last line. */
function formatTaggedCaption(post) {
  const core = joinSections([post.hook, post.body, post.cta]);
  const tags = tagLine(post.hashtags);
  if (!tags) return core;
  return core ? `${core}\n${tags}` : tags;
}

/** YouTube: title first line, then body and cta; no tags. */
function formatYoutube(post) {
  const title = trim(post.title);
  const rest = joinSections([post.body, post.cta]);
  if (title && rest) return `${title}\n${rest}`;
  return title || rest;
}

/**
 * Paste-ready copy for the active platform.
 * @param {object} post
 * @param {object} [platform] — platform record from `getPlatform`
 */
export function formatPost(post, platform) {
  const p = platform || getPlatform(post.platform);
  const maxChars = p.maxChars || 280;

  switch (p.id) {
    case 'x':
      return formatParagraphPost(post, maxChars);
    case 'linkedin':
      return formatParagraphPost(post, maxChars);
    case 'instagram':
    case 'tiktok':
    case 'facebook':
      return formatTaggedCaption(post);
    case 'youtube':
      return formatYoutube(post);
    default:
      return formatParagraphPost(post, maxChars);
  }
}

const THREAD_MARK_RESERVE = 8;

function lastBreak(slice) {
  return Math.max(
    slice.lastIndexOf('\n\n'),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf(' ')
  );
}

function splitText(text, budget) {
  const out = [];
  let rest = String(text || '').trim();
  if (!rest) return [];
  if (budget < 1) return [rest];
  while (rest.length > budget) {
    const slice = rest.slice(0, budget);
    let cut = lastBreak(slice);
    if (cut < Math.floor(budget * 0.4)) cut = budget;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

function withMark(chunk, i, n, maxChars) {
  const mark = `${i}/${n}`;
  const body = String(chunk || '').trimEnd();
  const glued = body ? `${body} ${mark}` : mark;
  if (glued.length <= maxChars) return glued;
  const keep = maxChars - mark.length - 1;
  if (keep <= 0) return mark.slice(0, maxChars);
  return `${body.slice(0, keep).trimEnd()} ${mark}`;
}

/**
 * Paste parts for the live post. X over 280 becomes numbered 1/n tweets,
 * each ≤ maxChars. Every other platform is a single part (the formatPost string).
 */
export function formatThread(post, platform) {
  const p = platform || getPlatform(post.platform);
  const full = formatPost(post, p);
  if (p.id !== 'x') return full ? [full] : [];
  const maxChars = p.maxChars || 280;
  if (full.length <= maxChars) return full ? [full] : [];

  const core = joinSections([post.hook, post.body, post.cta]);
  const tags = tagLine(post.hashtags);
  const budget = Math.max(1, maxChars - THREAD_MARK_RESERVE);
  const chunks = splitText(core, budget);
  const n = Math.max(1, chunks.length);
  const parts = chunks.map((c, i) => withMark(c, i + 1, n, maxChars));
  if (tags && parts.length) {
    const last = parts[parts.length - 1];
    const tagged = `${last}\n\n${tags}`;
    if (tagged.length <= maxChars) parts[parts.length - 1] = tagged;
  }
  return parts;
}

/**
 * Whether copying the part at `index` should open What happened?.
 * Thread: only the last numbered part. One-part paste: yes.
 * Nothing to copy (partCount 0) is never a completion.
 */
export function isFinalThreadPart(index, partCount) {
  const n = Number.isFinite(partCount) ? Math.floor(partCount) : 0;
  if (n <= 0) return false;
  const i = Number.isFinite(index) ? Math.floor(index) : 0;
  return i >= n - 1;
}

