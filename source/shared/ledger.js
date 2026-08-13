/**
 * Read-only outcome ledger.
 *
 * Shows, for posts that have a paste, a note, or a live href: the frozen
 * paste line, the operator's own note, the href, and the heuristic band
 * **if one was already computed**.
 *
 * Three things this module deliberately does not do, and they are the design,
 * not omissions:
 *
 * 1. **It never imports the scorer.** Band arrives as data via `scoreById` or
 *    it is absent. A ledger that scores rows would make the scorer a function
 *    of a list that exists to audit the scorer.
 * 2. **It computes no rates, counts or aggregates.** Every value in a row is
 *    something a human typed or something already recorded. The moment this
 *    renders "ready posts do better", it has invented a metric from a handful
 *    of free-text notes.
 * 3. **It writes nothing.** Callers pass posts in; rows come out. No store
 *    call, no mutation of the objects handed to it.
 */

/** One line of the paste, collapsed. Empty stays empty. */
function pasteLine(post) {
  const text = post && post.lastPaste && post.lastPaste.text;
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** The operator's own words. Empty stays empty. */
function noteLine(post) {
  const note = post && post.outcome && post.outcome.note;
  return String(note || '').replace(/\s+/g, ' ').trim();
}

/** Already-normalized live href. Empty or junk stays empty — no fetch. */
function hrefLine(post) {
  const href = post && post.publishedUrl;
  const s = String(href || '').trim();
  if (!/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d{1,20}$/.test(s)) return '';
  return s;
}

/** Only the bands the heuristic actually produces. Anything else is dropped. */
const BANDS = ['ready', 'draft', 'thin'];

/**
 * Band for a post, from already-computed scores only.
 * `scoreById` may be a Map or a plain object keyed by post id.
 */
function bandFor(id, scoreById) {
  if (!scoreById) return '';
  const entry = typeof scoreById.get === 'function' ? scoreById.get(id) : scoreById[id];
  if (!entry) return '';
  const band = typeof entry === 'string' ? entry : entry.band;
  return BANDS.includes(band) ? band : '';
}

/**
 * Rows for the ledger, in board order.
 *
 * A post is listed when it has a paste, a note, **or** a live href —
 * "shipped it, dropped the URL" is itself a finding. An empty field is
 * omitted from the row rather than rendered blank.
 *
 * @param {object[]} posts
 * @param {Map|object} [scoreById] — already-computed scores, keyed by post id
 * @returns {{id:string,title:string,paste?:string,note?:string,href?:string,band?:string}[]}
 */
export function formatLedger(posts, scoreById) {
  if (!Array.isArray(posts)) return [];
  const rows = [];
  for (const post of posts) {
    if (!post || typeof post !== 'object') continue;
    const paste = pasteLine(post);
    const note = noteLine(post);
    const href = hrefLine(post);
    if (!paste && !note && !href) continue;

    const row = {
      id: String(post.id || ''),
      title: String(post.title || '').trim() || 'Untitled post'
    };
    if (paste) row.paste = paste;
    if (note) row.note = note;
    if (href) row.href = href;
    const band = bandFor(row.id, scoreById);
    if (band) row.band = band;
    rows.push(row);
  }
  return rows;
}

/** True when there is anything worth showing. */
export function hasLedgerRows(posts, scoreById) {
  return formatLedger(posts, scoreById).length > 0;
}
