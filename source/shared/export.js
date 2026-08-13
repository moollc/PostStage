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
