import { getPlatform } from './platforms.js';

const HOW_LABELS = {
  unknown: 'Unknown',
  inferred: 'Inferred',
  stated: 'Stated'
};

/**
 * Absolute filesystem paths, replaced with `<path>`.
 *
 * The brief is built only from post fields, but those fields are free text and
 * one of them arrives from a terminal: Keep shop line takes the last usable line
 * out of a Herdr pane, which is routinely a cwd, a stack trace, or an ENOENT
 * message. Applied to the stage that becomes the hook, and the next Ask shop
 * sends it straight back out. So the packet is scrubbed on its way out, at the
 * one point every field passes through.
 *
 * Matches POSIX (`/Users/...`, `/home/...`), Windows (`C:\...`), UNC (`\\host\`),
 * `file://` URLs, and `~/...`. `CORE` finds the path's start and its first
 * space-joined segment (e.g. "My Drive"); `extendMatch` then walks forward
 * through further bare words to pick up any *additional* multi-word segments
 * ("A Folder With Spaces/deep/file.txt"), committing an extension only once a
 * path separator is actually found — so a folder name with several words in a
 * row still collapses to one `<path>` marker rather than leaking the tail.
 *
 * The word walk is capped at `MAX_EXTRA_WORDS` per segment and stops at "and"/
 * "or": without a bound, greedily hunting for "the next separator, however far"
 * would walk straight through unrelated prose and merge two separate paths in
 * the same string into one match (`/a/b and /c/d` must stay two `<path>`s, not
 * one) — those two words are the shortest, most common way two paths end up
 * back-to-back in a sentence.
 */
const CORE = /(?:file:\/\/)?(?:~|\.{1,2})?(?:\/|\\\\|[A-Za-z]:[\\/])[^\s'"`,;:]*(?:[ \t][^\s'"`,;:/\\]+[\\/][^\s'"`,;:]*)*/g;
const MAX_EXTRA_WORDS = 8;
const JOIN_STOPWORDS = new Set(['and', 'or']);

/** How far `text.slice(end)` continues into further multi-word path segments. */
function extendMatch(text, end) {
  let pos = end;
  let bestEnd = end;
  let words = 0;
  while (words < MAX_EXTRA_WORDS) {
    const word = text.slice(pos).match(/^[ \t]([^\s'"`,;:/\\]+)/);
    if (!word || JOIN_STOPWORDS.has(word[1].toLowerCase())) break;
    const wordEnd = pos + word[0].length;
    const sep = text.slice(wordEnd).match(/^[\\/][^\s'"`,;:]*/);
    words++;
    if (sep) {
      bestEnd = wordEnd + sep[0].length;
      pos = bestEnd;
      words = 0; // a real segment closed the run — a further one gets a fresh budget
    } else {
      pos = wordEnd;
    }
  }
  return bestEnd;
}

/** Strip absolute paths from any free-text value before it leaves the machine. */
export function scrubPaths(text) {
  const s = String(text ?? '');
  let out = '';
  let last = 0;
  CORE.lastIndex = 0;
  let m;
  while ((m = CORE.exec(s))) {
    const start = m.index;
    const end = extendMatch(s, start + m[0].length);
    const matched = s.slice(start, end);
    out += s.slice(last, start) + (matched.length > 3 && /[\\/]/.test(matched) ? '<path>' : matched);
    last = end;
    CORE.lastIndex = end;
  }
  return (out + s.slice(last))
    .replace(/(?:<path>[ \t]*){2,}/g, '<path> ')
    .replace(/[ \t]{2,}/g, ' ');
}

function field(name, value) {
  const v = scrubPaths(value).trim();
  if (!v) return `${name}: (empty)`;
  if (!v.includes('\n')) return `${name}: ${v}`;
  return `${name}:\n${v}`;
}

function tagText(hashtags) {
  const tags = (hashtags || [])
    .map((t) => scrubPaths(t).replace(/^#/, '').trim())
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
    ...copiedPasteLines(post),
    unclaimed.length
      ? `Unclaimed parts: ${unclaimed.join(', ')}`
      : 'Unclaimed parts: none',
    heuristic,
    'Which part is not doing its job? One line.'
  ].join('\n');
}

/**
 * Frozen clipboard snapshot for Ask shop. Omitted when there is no lastPaste.
 * Text, platformId, and partIndex only — no reach, likes, or timestamps.
 */
function copiedPasteLines(post) {
  const snap = post?.lastPaste;
  if (!snap || !String(snap.text ?? '').trim()) return [];
  const platformId = typeof snap.platformId === 'string' ? snap.platformId : '';
  const rawIndex = snap.partIndex;
  const partIndex = Number.isFinite(Number(rawIndex))
    ? Math.max(0, Math.floor(Number(rawIndex)))
    : 0;
  return [
    field('Copied paste', snap.text),
    `Copied platform: ${scrubPaths(platformId).trim() || '(empty)'}`,
    `Copied part: ${partIndex}`
  ];
}
