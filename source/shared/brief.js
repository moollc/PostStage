import { getPlatform } from './platforms.js';

const HOW_LABELS = {
  unknown: 'Unknown',
  inferred: 'Inferred',
  stated: 'Stated'
};

function field(name, value) {
  const v = String(value ?? '').trim();
  if (!v) return `${name}: (empty)`;
  if (!v.includes('\n')) return `${name}: ${v}`;
  return `${name}:\n${v}`;
}

function tagText(hashtags) {
  const tags = (hashtags || [])
    .map((t) => String(t).replace(/^#/, '').trim())
    .filter(Boolean)
    .map((t) => '#' + t);
  return tags.length ? tags.join(' ') : '(empty)';
}

/**
 * Short plain-text brief for agent / shop prompts. No generative coaching.
 */
export function formatStageBrief(post, platform, scored, parts) {
  const p = platform || getPlatform(post?.platform);
  const how = HOW_LABELS[post?.audienceHow] || post?.audienceHow || 'Unknown';

  const unclaimed = (parts || [])
    .filter((part) => !part.filled)
    .map((part) => part.id || part.label);

  const failing = (scored?.checks || [])
    .filter((c) => !c.ok)
    .map((c) => c.id);

  const band = scored?.band || 'unknown';
  const heuristic = failing.length
    ? `Heuristic: ${band} — failing: ${failing.join(', ')}`
    : `Heuristic: ${band}`;

  return [
    field('Who', post?.audience),
    `How we know: ${how}`,
    `Platform: ${p.label || p.id}`,
    field('Hook', post?.hook),
    field('Body', post?.body),
    field('Call', post?.cta),
    `Tags: ${tagText(post?.hashtags)}`,
    field('Gen prompt', post?.genPrompt),
    unclaimed.length
      ? `Unclaimed parts: ${unclaimed.join(', ')}`
      : 'Unclaimed parts: none',
    heuristic,
    'Which part is not doing its job? One line.'
  ].join('\n');
}
