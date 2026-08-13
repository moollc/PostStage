import { loadPlatforms, getPlatforms, getPlatform } from '/source/shared/platforms.js';
import { loadState, saveState, uid, getActive, setActive, addPost, setPublished, setOutcome, setLastPaste, setPublishedUrl, setGuestScan, addIdea, rememberStageWrite, undoStageWrite, mediaPersists, setParked, visiblePosts, parkedCount } from '/source/shared/store.js';
import { scorePostMaybeWasm } from '/source/shared/score.js';
import { structureFor, interactionsFor, monetizeFor, effectsFor, PARTS } from '/source/shared/playbook.js';
import { listAgents, sendAgent, readAgent, lastShopLine, shortCwd } from '/source/shared/agent-bridge.js';
import { formatThread, isFinalThreadPart } from '/source/shared/export.js';
import { formatStageBrief } from '/source/shared/brief.js';
import { isSafeRelPath, mediaSrcForPath, IMAGE_ROUTE_PROBE, imageRouteFromHealth, imageRouteFromProbe } from '/source/shared/media-link.js';
import { formatLedger } from '/source/shared/ledger.js';
import { compressStill, IMAGE_PERSIST_BUDGET } from '/source/shared/compress-still.js';
import { inboxIdFromItem } from '/source/shared/inbox-id.js';
import { normalizePublishedUrl, W1_POST_ID, W1_PUBLISHED_URL } from '/source/shared/published-url.js';
import { copyLiveText, canCopyLive } from '/source/shared/copy-live-url.js';
import { GUEST_SCAN_PROBE, STALE_SCAN_HINT, guestScanRouteFromHealth, guestScanRouteFromProbe } from '/source/shared/scan-stale.js';

const canvas = document.getElementById('canvas');
const wrap = canvas.parentElement;
const rail = document.getElementById('rail');
const plats = document.getElementById('plats');

let state = loadState();
if (state.ideaLayout !== 'stack' && state.ideaLayout !== 'free') state.ideaLayout = 'stack';
{
  const w1 = state.posts.find((p) => p.id === W1_POST_ID);
  if (w1 && !w1.publishedUrl) {
    setPublishedUrl(state, w1.id, W1_PUBLISHED_URL);
    saveState(state);
  }
}
let copiedIds = new Set();
const threadCursor = { key: '', index: 0 };
let railSeq = 0;
let selected = 'stage';
let drag = null;
let pan = null;
let spaceDown = false;
const view = { x: 0, y: 0, scale: 1 };
/** This-sitting blob URLs for clips that already have a persistable path/href. */
const sessionClips = new Map();
/** Clip duration (seconds) read from stage preview metadata, keyed by post id. */
const videoDurationByPost = new Map();
/** X For You mixer minimum from x-algorithm MinVideoDurationMs. */
const X_MIN_VIDEO_SEC = 10;
/** Whether the live launcher handles `/image?path=`. null until probed. */
let imageRouteLive = null;
let guestScanRouteLive = null;
/** Post id whose last guest scan failed this sitting — snapshot is not cleared. */
let guestScanFailId = null;
let guestScanBusy = false;
let guestScanFocusAt = 0;
let guestScanSeq = 0;

/**
 * Save, then patch the one honest error line in place — no full render, so a
 * failed save while mid-keystroke does not also drop the caret. Callers do
 * not need to check the return value themselves; the line updates on its own.
 */
function persist() {
  const ok = saveState(state);
  paintSaveError();
  return ok;
}

function paintSaveError() {
  const existing = document.getElementById('save-error');
  if (state.saveError === 'quota') {
    if (existing) return;
    const h2 = rail.querySelector('h2');
    if (!h2) return;
    const p = document.createElement('p');
    p.className = 'hint no-score';
    p.id = 'save-error';
    p.textContent = 'Storage is full — this change is not saved. Remove a picture or clip, then try again.';
    h2.insertAdjacentElement('afterend', p);
  } else if (existing) {
    existing.remove();
  }
}

function ideaLayout() {
  return state.ideaLayout === 'free' ? 'free' : 'stack';
}

function setIdeaLayout(mode) {
  const next = mode === 'free' ? 'free' : 'stack';
  if (next === 'free') {
    getActive(state).ideas.forEach((idea, i) => placeIdeaIfNeeded(idea, i));
  }
  state.ideaLayout = next;
  persist();
  render();
}

/** Default canvas slot for an idea that has never been free-placed. */
function placeIdeaIfNeeded(idea, index) {
  if (typeof idea.x === 'number' && typeof idea.y === 'number') return;
  idea.x = 40 + index * 16;
  idea.y = 240 + index * 20;
}

function nextFreeIdeaPos() {
  const ideas = getActive(state).ideas;
  let last = null;
  for (const idea of ideas) {
    if (typeof idea.x === 'number' && typeof idea.y === 'number') last = idea;
  }
  if (last) return { x: last.x + 24, y: last.y + 28 };
  return { x: 40, y: 240 };
}

function applyView() {
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function toCanvas(clientX, clientY) {
  const r = wrap.getBoundingClientRect();
  return {
    x: (clientX - r.left - view.x) / view.scale,
    y: (clientY - r.top - view.y) / view.scale
  };
}

/**
 * `selected` is the single source of truth for which node is active.
 * Nothing else may assign it — call this instead, so the id and the DOM
 * chrome can never disagree.
 */
function selectCard(id) {
  selected = normalizeSelected(id);
  applySelection();
}

/** A selection is only valid while its node still exists; fall back to stage. */
function normalizeSelected(id) {
  if (id === 'stage') return 'stage';
  return state.ideas.some((i) => i.id === id) ? id : 'stage';
}

/**
 * Re-assert the selected chrome from `selected`. Safe to call after any
 * re-render — platform switch, live score paint, idea edit — because it reads
 * the id rather than trusting whatever markup was just rebuilt.
 */
function applySelection() {
  selected = normalizeSelected(selected);
  for (const node of wrap.querySelectorAll('.card')) {
    node.classList.toggle('selected', node.dataset.id === String(selected));
  }
}

function editingField(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || el.isContentEditable;
}

/** True while this field still has native keystroke undo to offer. */
let keystrokeDirty = false;

function typingField(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (el.type || 'text').toLowerCase();
  return type === 'text' || type === 'search' || type === '';
}

function lastWriteUndoKey(e) {
  if (e.repeat || e.altKey || e.shiftKey || e.isComposing) return false;
  if (!e.metaKey && !e.ctrlKey) return false;
  return e.key === 'z' || e.key === 'Z';
}

function wantsNativeKeystrokeUndo(target) {
  return typingField(target) && keystrokeDirty;
}

function fullText() {
  const p = state.post;
  return [p.hook, p.body, p.cta, (p.hashtags || []).map((t) => '#' + t).join(' ')].filter(Boolean).join('\n\n');
}

function previewText(post, platform) {
  if (platform.id === 'x') return formatLiveCopy(post, platform);
  const parts = [post.hook, post.body, post.cta];
  if (platform.id === 'instagram' || platform.id === 'facebook' || platform.id === 'tiktok') {
    const tags = (post.hashtags || []).map((t) => '#' + t).join(' ');
    if (tags) parts.push(tags);
  }
  return parts.filter(Boolean).join('\n\n');
}

function previewCharUsed(post, platform) {
  if (platform.id === 'x') {
    const parts = liveThread(post, platform);
    if (parts.length > 1) return (parts[threadCursor.index] || '').length;
  }
  return fullText().length;
}

function charLabel(platform, used) {
  const rem = platform.maxChars - used;
  if (rem < 0) return `${-rem} over limit`;
  return `${rem} left`;
}

function isImageMedia(m) {
  if (!m || !m.url) return false;
  if (m.type && m.type.startsWith('image/')) return true;
  const url = String(m.url);
  if (url.startsWith('data:image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(url);
}

function isVideoMedia(m) {
  if (!m) return false;
  if (m.type && m.type.startsWith('video/')) return true;
  const url = String(m.url || '');
  const path = String(m.path || '');
  if (url.startsWith('data:video/')) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || /\.(mp4|webm|mov|m4v)$/i.test(path);
}

function formatClipSec(dur) {
  if (!Number.isFinite(dur)) return '';
  if (dur >= 10) return String(Math.round(dur));
  const one = Math.round(dur * 10) / 10;
  return one % 1 === 0 ? String(Math.floor(one)) : one.toFixed(1);
}

function xVideoUnderMin(post, platform) {
  if (!post || platform.id !== 'x') return false;
  const m = post.media && post.media[0];
  if (!isVideoMedia(m)) return false;
  const dur = videoDurationByPost.get(post.id);
  if (!Number.isFinite(dur) || dur <= 0) return false;
  return dur < X_MIN_VIDEO_SEC;
}

function xVideoGateLabel(dur) {
  const sec = formatClipSec(dur);
  return sec ? `${sec}s — under X’s 10s minimum` : 'Under 10s for X';
}

function paintXVideoGate(el, post, platform) {
  if (!el) return;
  const under = xVideoUnderMin(post, platform);
  el.hidden = !under;
  if (!under) {
    el.textContent = '';
    el.removeAttribute('title');
    return;
  }
  const dur = videoDurationByPost.get(post.id);
  el.textContent = xVideoGateLabel(dur);
  el.title = 'X’s For You mixer expects at least 10s of video';
}

function paintXVideoGates() {
  const post = getActive(state);
  const platform = getPlatform(post.platform);
  for (const id of ['x-video-gate-top', 'x-video-gate-stage', 'x-video-gate-dock']) {
    paintXVideoGate(document.getElementById(id), post, platform);
  }
}

function noteVideoDuration(postId, dur) {
  if (!Number.isFinite(dur) || dur <= 0) return;
  videoDurationByPost.set(postId, dur);
  if (getActive(state).id !== postId) return;
  paintXVideoGates();
}

function isUsableBlob(m) {
  return Boolean(m && m.session && /^blob:/i.test(String(m.url || '')));
}

const MEDIA_LINKED_CLIP = 'Linked clip';
const MEDIA_SESSION_ONLY = 'Session only';
const LEAVES_ON_REFRESH = 'This picture leaves when you refresh';
const SESSION_ONLY_CLIP = 'Session only — leaves on refresh';
const STALE_IMAGE_HINT = 'Linked clip will not play after refresh';

function mediaSessionOverlayText(m) {
  if (isVideoMedia(m)) return SESSION_ONLY_CLIP;
  return LEAVES_ON_REFRESH;
}

function mediaLeavesNote(m) {
  if (!m || !m.url || mediaPersists(m)) return '';
  return `<span class="media-session media-leaves media-unwatched">${escapeHtml(mediaSessionOverlayText(m))}</span>`;
}

function mediaLinkedNote(m) {
  if (!m || !isVideoMedia(m) || !mediaPersists(m)) return '';
  if (imageRouteLive === false) {
    return `<span class="media-session media-stale">${escapeHtml(STALE_IMAGE_HINT)}</span>`;
  }
  return `<span class="media-session media-linked">${MEDIA_LINKED_CLIP}</span>`;
}

async function probeGuestScanRoute() {
  try {
    const h = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
    if (h.ok) {
      const data = await h.json();
      if (guestScanRouteFromHealth(data)) {
        guestScanRouteLive = true;
        return;
      }
    }
  } catch { /* probe the route */ }
  try {
    const r = await fetch('/api/guest-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: GUEST_SCAN_PROBE }),
      signal: AbortSignal.timeout(2000)
    });
    guestScanRouteLive = guestScanRouteFromProbe(r.status, {
      'content-type': r.headers.get('content-type') || ''
    });
  } catch {
    guestScanRouteLive = false;
  }
}

async function probeImageRoute() {
  try {
    const h = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
    if (h.ok) {
      const data = await h.json();
      if (imageRouteFromHealth(data)) {
        imageRouteLive = true;
        return;
      }
    }
  } catch { /* probe the route */ }
  try {
    const href = mediaSrcForPath(IMAGE_ROUTE_PROBE);
    const headers = { Range: 'bytes=0-0' };
    const signal = AbortSignal.timeout(2000);
    let r = await fetch(href, { method: 'HEAD', headers, signal });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(href, { method: 'GET', headers, signal });
    }
    imageRouteLive = imageRouteFromProbe(r.status, {
      'content-type': r.headers.get('content-type') || '',
      'accept-ranges': r.headers.get('accept-ranges') || ''
    });
  } catch {
    imageRouteLive = false;
  }
}

function videoPreviewSrc(m) {
  const post = getActive(state);
  const live = post && sessionClips.get(post.id);
  if (live) return live;
  const path = m && m.path;
  if (path && isSafeRelPath(path)) return mediaSrcForPath(path);
  const href = String((m && m.href) || '');
  if (/^\/image\?path=/i.test(href)) return href;
  const url = String((m && m.url) || '');
  if (/^\/image\?path=/i.test(url)) return url;
  if (/^blob:/i.test(url) && isUsableBlob(m)) return url;
  return '';
}

function emptyMediaPlaceholder() {
  return `<span class="media-placeholder">Click or drop an image or video<span class="media-session">${MEDIA_SESSION_ONLY}</span></span>`;
}

/** Native <video> attrs for this preview. Do not invent a player chrome. */
function videoPlaybackAttrs(platform) {
  const id = platform && platform.id;
  if (id === 'youtube') return 'controls playsinline preload="metadata"';
  return 'muted autoplay loop playsinline preload="metadata"';
}

function mediaSlotHtml(media, platform) {
  const m = media && media[0];
  if (!m) return emptyMediaPlaceholder();
  const linkedSrc = isVideoMedia(m) ? videoPreviewSrc(m) : '';
  if (!m.url && !linkedSrc) return emptyMediaPlaceholder();
  // Blob URLs die on reload. A stored blob must not render as a picture.
  if (/^blob:/i.test(String(m.url || '')) && !isUsableBlob(m) && !linkedSrc) {
    return emptyMediaPlaceholder();
  }
  const leaves = mediaLeavesNote(m);
  const linked = mediaLinkedNote(m);
  if (isImageMedia(m)) {
    return `<img class="media-img" src="${m.url}" alt="${escapeHtml(m.name || 'media')}">${linked}${leaves}`;
  }
  if (isVideoMedia(m)) {
    if (!linkedSrc) return emptyMediaPlaceholder();
    return `<video class="media-vid" src="${linkedSrc}" ${videoPlaybackAttrs(platform)}></video>${linked}${leaves}`;
  }
  return `<span class="media-placeholder">Media attached</span>${linked}${leaves}`;
}

function platformName(platform) {
  return platform.name || platform.handle.replace(/^@/, '') || 'You';
}

function buildPreview(post, platform) {
  const text = previewText(post, platform);
  const media = mediaSlotHtml(post.media, platform);
  const name = escapeHtml(platformName(platform));
  const handle = escapeHtml(platform.handle);
  const label = escapeHtml(platform.label);
  const accent = platform.accent || '#8b8680';

  const head = (extra) => `
    <div class="chrome-head" style="--plat-accent:${accent}">
      <div class="avatar" aria-hidden="true"></div>
      <div class="meta">
        <span class="name">${name}</span>
        <span class="handle">${handle}</span>
      </div>
      ${extra || ''}
    </div>`;

  switch (platform.id) {
    case 'x':
      return `
        ${head(`<span class="plat-mark" aria-label="${label}">𝕏</span>`)}
        <div class="body"></div>
        <div class="media-slot">${media}</div>
        <div class="action-row x-actions"><span>♡</span><span>↻</span><span>↗</span></div>`;
    case 'instagram':
      return `
        ${head(`<span class="plat-mark ig-mark" aria-label="${label}">◎</span>`)}
        <div class="media-slot ig-media">${media}</div>
        <div class="ig-actions"><span>♡</span><span>◎</span><span>↗</span></div>
        <div class="caption"><strong>${handle}</strong> <span class="caption-text"></span></div>`;
    case 'tiktok':
      return `
        <div class="tiktok-frame">
          <div class="media-slot tiktok-media">${media}</div>
          <div class="tiktok-overlay">
            <div class="tiktok-side"><span>♡</span><span>◎</span><span>↗</span></div>
            <div class="tiktok-bottom">
              <span class="name">${handle}</span>
              <div class="caption-scroll"><div class="caption-text"></div></div>
            </div>
          </div>
        </div>`;
    case 'youtube':
      return `
        <div class="media-slot yt-thumb">${media}</div>
        <div class="yt-meta">
          <div class="avatar sm" aria-hidden="true"></div>
          <div class="yt-lines">
            <div class="yt-title"></div>
            <div class="yt-sub">${name} · 12K views</div>
          </div>
        </div>
        <div class="body yt-desc"></div>`;
    case 'linkedin':
      return `
        ${head(`<span class="feed-time">· 1h · 🌐</span>`)}
        <div class="body"></div>
        <div class="media-slot">${media}</div>
        <div class="feed-stats"><span>👍 Like</span><span>💬 Comment</span><span>↻ Repost</span></div>`;
    case 'facebook':
      return `
        ${head(`<span class="feed-time">· Just now · 🌐</span>`)}
        <div class="body"></div>
        <div class="media-slot fb-media">${media}</div>
        <div class="feed-stats fb-stats"><span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span></div>`;
    default:
      return `
        ${head(`<span class="plat-mark">${label}</span>`)}
        <div class="body"></div>
        <div class="media-slot">${media}</div>`;
  }
}

function fillPreviewText(prev, platform, text) {
  const body = prev.querySelector('.body');
  if (body) body.textContent = text;
  const cap = prev.querySelector('.caption-text');
  if (cap) cap.textContent = text;
  const title = prev.querySelector('.yt-title');
  if (title) title.textContent = state.post.title || text.split('\n')[0] || 'Video title';
  const ytDesc = prev.querySelector('.yt-desc');
  if (ytDesc) ytDesc.textContent = text;
}

function renderPlatforms() {
  plats.innerHTML = '';
  for (const p of getPlatforms()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.setAttribute('aria-pressed', String(state.post.platform === p.id));
    b.addEventListener('click', () => {
      state.post.platform = p.id;
      persist();
      render();
    });
    plats.appendChild(b);
  }
}

function ideaPartFilled(part) {
  if (part.filled) return true;
  if (part.id === 'media') return Boolean(String(state.post.genPrompt || '').trim());
  return false;
}

function claimedPartIds() {
  const set = new Set();
  for (const idea of state.ideas) {
    if (idea.part) set.add(idea.part);
  }
  return set;
}

function paintStructure(partsEl) {
  if (!partsEl) return;
  partsEl.innerHTML = '';
  const claimed = claimedPartIds();
  for (const part of structureFor(state.post)) {
    const filled = ideaPartFilled(part);
    const unclaimed = !filled && !claimed.has(part.id);
    const d = document.createElement('div');
    d.className = 'part' + (filled ? '' : ' empty') + (unclaimed ? ' unclaimed' : '');
    const loseLine = filled ? '' : `<span class="lose">If empty: ${escapeHtml(part.lose)}</span>`;
    const claimLine = unclaimed ? '<span class="unclaimed-mark">Unclaimed</span>' : '';
    d.innerHTML = `<strong>${part.label} · ${part.job}</strong><span>${escapeHtml(part.value)}</span>${loseLine}${claimLine}`;
    partsEl.appendChild(d);
  }
}

function applyIdeaToStage(idea) {
  const text = String(idea.text || '').trim();
  if (!text) return false;
  const part = idea.part;
  if (!part) return false;
  const post = state.post;
  if (part === 'hook' || part === 'body' || part === 'cta') {
    if (String(post[part] || '') === text) return true;
    rememberStageWrite(state);
    post[part] = text;
    return true;
  }
  if (part === 'tags') {
    post.hashtags = text.split(/\s+/).filter(Boolean).map((t) => t.replace(/^#/, ''));
    return true;
  }
  if (part === 'media') {
    post.genPrompt = text;
    return true;
  }
  return false;
}

function ideaCard(idea) {
  const el = document.createElement('article');
  const blank = !String(idea.text || '').trim();
  if (idea.part == null) idea.part = '';
  el.className = 'card idea' + (blank ? ' empty' : '') + (!idea.part ? ' needs-part' : '') + (selected === idea.id ? ' selected' : '');
  el.dataset.id = idea.id;
  const head = document.createElement('div');
  head.className = 'idea-head';
  const h3 = document.createElement('h3');
  h3.className = 'drag';
  h3.textContent = 'Idea';
  const sel = document.createElement('select');
  sel.className = 'idea-part';
  sel.setAttribute('aria-label', 'Post part');
  const unset = document.createElement('option');
  unset.value = '';
  unset.textContent = 'Part…';
  sel.appendChild(unset);
  for (const p of PARTS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
  sel.value = idea.part || '';
  sel.addEventListener('change', () => {
    idea.part = sel.value;
    persist();
    paintStructure(rail.querySelector('#parts'));
  });
  const label = document.createElement('div');
  label.className = 'idea-label';
  label.appendChild(h3);
  if (idea.source === 'shop') {
    const mark = document.createElement('span');
    mark.className = 'idea-src';
    mark.textContent = 'SHOP';
    mark.title = 'From the shop pane';
    label.appendChild(mark);
  }
  if (!idea.part) {
    const hint = document.createElement('span');
    hint.className = 'idea-part-hint';
    hint.textContent = 'part';
    hint.title = 'Pick which part of the post this claims';
    label.appendChild(hint);
  }
  head.append(label, sel);
  el.appendChild(head);
  const ta = document.createElement('textarea');
  ta.value = idea.text;
  ta.placeholder = 'Hook, angle, or question…';
  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'use-stage';
  use.textContent = 'Use on stage';
  use.disabled = blank;
  use.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!idea.part) {
      use.textContent = 'Pick a part';
      clearTimeout(use._flash);
      use._flash = setTimeout(() => { use.textContent = 'Use on stage'; }, 2000);
      return;
    }
    if (!applyIdeaToStage(idea)) return;
    persist();
    render();
  });
  ta.addEventListener('input', () => {
    idea.text = ta.value;
    el.classList.toggle('empty', !ta.value.trim());
    use.disabled = !ta.value.trim();
    persist();
  });
  el.appendChild(ta);
  const actions = document.createElement('div');
  actions.className = 'idea-actions';
  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = 'Remove';
  armDelete(del, () => {
    state.ideas = state.ideas.filter((i) => i.id !== idea.id);
    // normalizeSelected drops a selection whose node just went away.
    selectCard(selected);
    persist();
    render();
  });
  actions.append(use, del);
  el.appendChild(actions);
  el.addEventListener('mousedown', () => { selectCard(idea.id); });
  if (ideaLayout() === 'free') {
    placeIdeaIfNeeded(idea, getActive(state).ideas.indexOf(idea));
    el.style.left = idea.x + 'px';
    el.style.top = idea.y + 'px';
    bindDrag(el, idea);
  } else {
    bindReorder(el, idea);
  }
  return el;
}

function liveThread(post, platform) {
  const parts = formatThread(post, platform);
  const key = `${post.id}:${platform.id}:${parts.join('\0')}`;
  if (key !== threadCursor.key) {
    threadCursor.key = key;
    threadCursor.index = 0;
  }
  if (!parts.length) threadCursor.index = 0;
  else if (threadCursor.index >= parts.length) threadCursor.index = parts.length - 1;
  return parts;
}

function threadChromeLabel() {
  const post = getActive(state);
  const platform = getPlatform(post.platform);
  const parts = liveThread(post, platform);
  if (parts.length < 2) return null;
  return `${threadCursor.index + 1}/${parts.length}`;
}

function paintThreadChrome() {
  const label = threadChromeLabel();
  for (const id of ['thread-part-chrome-top', 'thread-part-chrome-stage', 'thread-part-chrome-dock']) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!label) {
      el.hidden = true;
      el.textContent = '';
    } else {
      el.hidden = false;
      el.textContent = label;
    }
  }
  paintXVideoGates();
}

function advanceThreadPart() {
  const post = getActive(state);
  const platform = getPlatform(post.platform);
  const parts = liveThread(post, platform);
  if (parts.length < 2) return;
  threadCursor.index = (threadCursor.index + 1) % parts.length;
  paintPasteView();
}

function prevThreadPart() {
  const post = getActive(state);
  const platform = getPlatform(post.platform);
  const parts = liveThread(post, platform);
  if (parts.length < 2 || threadCursor.index <= 0) return;
  threadCursor.index -= 1;
  paintPasteView();
}

function formatLiveCopy(post, platform) {
  const parts = liveThread(post, platform);
  return parts[threadCursor.index] || '';
}

function paintStagePreview() {
  const card = canvas.querySelector('.stage-card');
  if (!card) return;
  const post = getActive(state);
  const platform = getPlatform(post.platform);
  const prev = card.querySelector('.preview');
  if (prev) fillPreviewText(prev, platform, previewText(post, platform));
  const ch = card.querySelector('.chars');
  if (ch) {
    const used = previewCharUsed(post, platform);
    ch.textContent = charLabel(platform, used);
    ch.classList.toggle('over', used > platform.maxChars);
  }
}

function shouldShowOutcome(post) {
  return copiedIds.has(post.id) || Boolean(post.outcome) || post.status === 'published';
}

function bindOutcomeField(how, post) {
  how.type = 'text';
  how.className = 'outcome-rail';
  how.placeholder = 'What you saw — optional';
  how.setAttribute('aria-label', 'What happened?');
  how.value = (post.outcome && post.outcome.note) || '';
  how.addEventListener('change', () => {
    setOutcome(state, post.id, how.value);
    persist();
    paintBoard();
    // The ledger reads outcome; without this it stays stale until a full render.
    scheduleJudgement();
  });
}

function bindPublishedUrlField(el, post) {
  if (!el) return;
  el.value = post.publishedUrl || '';
  el.addEventListener('change', () => {
    setPublishedUrl(state, post.id, el.value);
    el.value = getActive(state).publishedUrl || '';
    persist();
    scheduleJudgement();
    paintGuestScan();
    paintCopyLink();
    if (getActive(state).publishedUrl) runGuestScan(getActive(state));
  });
}

function paintCopyLink() {
  const btn = document.getElementById('btn-copy-link');
  if (!btn) return;
  btn.disabled = !canCopyLive(getActive(state).publishedUrl);
}

function bindCopyLink(btn) {
  if (!btn || btn.dataset.copyLinkBound) return;
  btn.dataset.copyLinkBound = '1';
  const idle = btn.textContent || 'Copy link';
  btn.addEventListener('click', async () => {
    const flash = (label, kind) => {
      btn.textContent = label;
      btn.classList.remove('copied', 'failed', 'saved');
      if (kind) btn.classList.add(kind);
      clearTimeout(btn._copyLinkT);
      btn._copyLinkT = setTimeout(() => {
        btn.textContent = idle;
        btn.classList.remove('copied', 'failed', 'saved');
      }, 1000);
    };
    const href = copyLiveText(getActive(state).publishedUrl);
    if (!href) {
      flash('No URL');
      return;
    }
    try {
      await navigator.clipboard.writeText(href);
      flash('Copied link', 'saved');
    } catch {
      flash('Copy failed', 'failed');
    }
  });
}

function guestScanWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function paintGuestScan() {
  const hint = document.getElementById('guest-scan-hint');
  const btn = document.getElementById('btn-guest-scan');
  const post = getActive(state);
  const url = post && post.publishedUrl;
  const stale = guestScanRouteLive === false;
  if (btn) {
    btn.hidden = !url;
    btn.disabled = !url || guestScanBusy || stale;
  }
  if (!hint) return;
  hint.classList.toggle('guest-scan-stale', Boolean(url && stale));
  if (!url) {
    hint.hidden = true;
    hint.textContent = '';
    return;
  }
  hint.hidden = false;
  if (stale) {
    hint.textContent = STALE_SCAN_HINT;
    return;
  }
  const snap = post.guestScan;
  const failed = guestScanFailId === post.id;
  if (failed) {
    hint.textContent = snap && (snap.title || snap.text)
      ? 'Scan failed — last snapshot kept'
      : 'Scan failed';
    return;
  }
  if (snap && (snap.title || snap.text)) {
    const when = guestScanWhen(snap.at);
    hint.textContent = [snap.title, when].filter(Boolean).join(' · ');
    return;
  }
  hint.textContent = '';
}

async function runGuestScan(post) {
  if (!post || !post.publishedUrl) return;
  if (guestScanRouteLive === false) {
    paintGuestScan();
    return;
  }
  const seq = ++guestScanSeq;
  guestScanBusy = true;
  paintGuestScan();
  try {
    const res = await fetch('/api/guest-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: post.publishedUrl })
    });
    if (seq !== guestScanSeq) return;
    const type = String(res.headers.get('content-type') || '');
    if (/html/i.test(type) && !/json/i.test(type)) {
      guestScanRouteLive = false;
      paintGuestScan();
      return;
    }
    let data = null;
    if (/json/i.test(type)) {
      try { data = await res.json(); } catch { data = null; }
    }
    if (!res.ok || !/json/i.test(type) || !data || data.ok !== true) {
      guestScanFailId = post.id;
      paintGuestScan();
      return;
    }
    setGuestScan(state, post.id, { at: data.at, title: data.title, text: data.text });
    guestScanFailId = null;
    persist();
    paintGuestScan();
  } catch {
    if (seq !== guestScanSeq) return;
    guestScanFailId = post.id;
    paintGuestScan();
  } finally {
    if (seq === guestScanSeq) {
      guestScanBusy = false;
      paintGuestScan();
    }
  }
}

function bindGuestScan(btn) {
  if (!btn || btn.dataset.guestScanBound) return;
  btn.dataset.guestScanBound = '1';
  btn.addEventListener('click', () => {
    runGuestScan(getActive(state));
  });
}

/** Frozen clipboard string. Never formatLiveCopy or the live preview platform. */
function lastPasteChipText(snap) {
  if (!snap || !snap.text) return '';
  return String(snap.text).replace(/\s+/g, ' ').trim();
}

function paintLastPasteChip(chip, snap, show) {
  if (!chip) return;
  const line = show ? lastPasteChipText(snap) : '';
  chip.hidden = !line;
  chip.textContent = line;
  chip.title = line;
  if (line && snap && snap.platformId) chip.dataset.platform = snap.platformId;
  else delete chip.dataset.platform;
}

function paintOutcomePrompt() {
  const box = document.getElementById('outcome-prompt');
  const input = document.getElementById('f-outcome');
  const chip = document.getElementById('last-paste-chip');
  if (!box || !input) return;
  const post = getActive(state);
  const show = shouldShowOutcome(post);
  box.hidden = !show;
  paintLastPasteChip(chip, post.lastPaste, show);
  paintCopyOut();
  if (!show) return;
  input.value = (post.outcome && post.outcome.note) || '';
}

function stageCard() {
  const post = state.post;
  const platform = getPlatform(post.platform);
  const used = previewCharUsed(post, platform);
  const el = document.createElement('article');
  el.className = 'card stage-card' + (selected === 'stage' ? ' selected' : '');
  el.style.left = post.x + 'px';
  el.style.top = post.y + 'px';
  el.dataset.id = 'stage';
  el.dataset.plat = platform.id;
  el.style.setProperty('--plat-accent', platform.accent || '#e8a54b');
  el.innerHTML = `<h2 class="drag">Stage · ${platform.label}</h2>`;

  const title = document.createElement('input');
  title.type = 'text';
  title.value = post.title;
  title.addEventListener('input', () => { post.title = title.value; persist(); paintPasteView(); paintBoard(); });
  el.appendChild(title);

  const status = document.createElement('button');
  status.type = 'button';
  status.className = 'board-status stage-status';
  bindStatusToggle(status, post);
  el.appendChild(status);

  const prev = document.createElement('div');
  prev.className = 'preview platform-' + platform.id + ' ' + platform.shape;
  prev.innerHTML = buildPreview(post, platform);
  fillPreviewText(prev, platform, previewText(post, platform));
  bindStageMediaSlot(prev);
  el.appendChild(prev);

  const chars = document.createElement('div');
  chars.className = 'chars' + (used > platform.maxChars ? ' over' : '');
  chars.textContent = charLabel(platform, used);
  el.appendChild(chars);

  const actions = document.createElement('div');
  actions.className = 'stage-actions copy-with-chrome';
  const gate = document.createElement('span');
  gate.id = 'x-video-gate-stage';
  gate.className = 'x-video-gate';
  gate.hidden = true;
  const threadChrome = document.createElement('span');
  threadChrome.id = 'thread-part-chrome-stage';
  threadChrome.className = 'thread-part-chrome';
  threadChrome.hidden = true;
  const copyLive = document.createElement('button');
  copyLive.type = 'button';
  copyLive.className = 'stage-copy primary';
  copyLive.textContent = 'Copy';
  copyLive.setAttribute('aria-label', 'Copy live post for paste');
  copyLive.addEventListener('click', (e) => e.stopPropagation());
  actions.append(gate, threadChrome, copyLive);
  el.appendChild(actions);
  paintXVideoGate(gate, post, platform);
  bindLiveCopy(copyLive);

  bindDrag(el, post);
  el.addEventListener('mousedown', () => { selectCard('stage'); });
  return el;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function quotaError(err) {
  return Boolean(err && (err.name === 'QuotaExceededError' || err.code === 22));
}

function fileBasename(name) {
  return String(name || '').replace(/\\/g, '/').split('/').pop();
}

async function linkLocalVideo(file) {
  const name = fileBasename(file && file.name);
  if (!name || /Users|GoogleDrive|(^|\/)home(\/|$)/i.test(name)) return null;
  try {
    const res = await fetch('/api/media/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, size: file.size })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const path = data && data.path;
    if (!isSafeRelPath(path)) return null;
    const url = mediaSrcForPath(path);
    if (!url) return null;
    return {
      name,
      type: file.type || 'video/webm',
      path,
      url,
      session: false
    };
  } catch {
    return null;
  }
}

async function attachLocalFile(file, imageOnly) {
  if (!file) return false;
  if (imageOnly && !file.type.startsWith('image/')) return false;
  if (!imageOnly && !file.type.startsWith('image/') && !file.type.startsWith('video/')) return false;
  const post = getActive(state);
  const prev = post.media && post.media[0];
  if (prev && prev.url && String(prev.url).startsWith('blob:')) URL.revokeObjectURL(prev.url);

  if (file.type.startsWith('video/')) {
    videoDurationByPost.delete(post.id);
    const name = fileBasename(file.name);
    const linked = await linkLocalVideo(file);
    const path = (linked && linked.path) || (isSafeRelPath(name) ? name : '');
    if (!path) {
      const prevLive = sessionClips.get(post.id);
      if (prevLive) {
        URL.revokeObjectURL(prevLive);
        sessionClips.delete(post.id);
      }
      post.media = [{
        name,
        type: file.type,
        url: URL.createObjectURL(file),
        session: true
      }];
      persist();
      render();
      return true;
    }
    const prevLive = sessionClips.get(post.id);
    if (prevLive) URL.revokeObjectURL(prevLive);
    sessionClips.set(post.id, URL.createObjectURL(file));
    const href = mediaSrcForPath(path);
    post.media = [{
      name,
      type: file.type || 'video/webm',
      path,
      href,
      url: href,
      session: false
    }];
    persist();
    render();
    return true;
  }

  const keep = { name: fileBasename(file.name), type: file.type, url: '', session: false };
  if (file.size <= IMAGE_PERSIST_BUDGET) {
    try {
      keep.url = await readFileAsDataUrl(file);
    } catch {
      keep.url = URL.createObjectURL(file);
      keep.session = true;
    }
  } else {
    const compressed = await compressStill(file, IMAGE_PERSIST_BUDGET);
    if (compressed && compressed.url) {
      keep.name = compressed.name || keep.name;
      keep.type = compressed.type || 'image/jpeg';
      keep.url = compressed.url;
      keep.session = false;
    } else {
      keep.url = URL.createObjectURL(file);
      keep.session = true;
    }
  }
  post.media = [keep];
  if (!persist() && String(keep.url).startsWith('data:')) {
    keep.url = URL.createObjectURL(file);
    keep.type = file.type;
    keep.session = true;
    post.media = [keep];
    persist();
  }
  render();
  return true;
}

function clearLocalMedia() {
  const post = getActive(state);
  videoDurationByPost.delete(post.id);
  const live = sessionClips.get(post.id);
  if (live) {
    URL.revokeObjectURL(live);
    sessionClips.delete(post.id);
  }
  const prev = post.media && post.media[0];
  if (prev && prev.url && String(prev.url).startsWith('blob:')) URL.revokeObjectURL(prev.url);
  post.media = [];
  persist();
  render();
}

function bindStageMediaSlot(preview) {
  const slot = preview.querySelector('.media-slot');
  if (!slot) return;
  slot.classList.add('droppable');
  slot.setAttribute('role', 'button');
  slot.tabIndex = 0;
  const attached = getActive(state).media && getActive(state).media[0];
  if (attached && mediaPersists(attached)) {
    const linkedLabel = imageRouteLive === false && isVideoMedia(attached)
      ? STALE_IMAGE_HINT
      : MEDIA_LINKED_CLIP;
    slot.setAttribute('aria-label', `${linkedLabel} — replace image or video`);
    slot.title = `${linkedLabel} — click or drop an image or video`;
  } else if (attached && !mediaPersists(attached)) {
    const sess = mediaSessionOverlayText(attached);
    slot.setAttribute('aria-label', sess);
    slot.title = sess;
  } else {
    slot.setAttribute('aria-label', `Add image or video — ${MEDIA_SESSION_ONLY.toLowerCase()}`);
    slot.title = `Click or drop an image or video (${MEDIA_SESSION_ONLY.toLowerCase()})`;
  }

  const ph = slot.querySelector('.media-placeholder');
  if (ph) {
    const sess = ph.querySelector('.media-session');
    ph.replaceChildren();
    ph.append('Click or drop an image or video');
    if (sess) ph.append(sess);
    else {
      const s = document.createElement('span');
      s.className = 'media-session';
      s.textContent = MEDIA_SESSION_ONLY;
      ph.append(s);
    }
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.hidden = true;
  slot.appendChild(input);

  if (slot.querySelector('.media-img, .media-vid')) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'media-remove';
    del.textContent = 'Remove';
    del.setAttribute('aria-label', 'Remove media');
    del.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearLocalMedia();
    });
    slot.appendChild(del);
  }

  const pick = () => input.click();
  slot.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.media-remove')) return;
    if (e.target.closest('video')) return;
    pick();
  });
  slot.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('change', () => {
    attachLocalFile(input.files && input.files[0], false);
  });

  for (const type of ['dragenter', 'dragover']) {
    slot.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      slot.classList.add('drag-over');
    });
  }
  slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    slot.classList.remove('drag-over');
    const file = [...(e.dataTransfer.files || [])].find(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    attachLocalFile(file, false);
  });

  primeVideoFrame(preview);
}

/** SloPo-style first frame so X's muted autoplay hole is not a dark box. */
function primeVideoFrame(preview) {
  const vid = preview.querySelector('video.media-vid');
  if (!vid) return;
  const postId = getActive(state).id;
  const onMeta = () => {
    const dur = vid.duration;
    if (Number.isFinite(dur) && dur > 0) noteVideoDuration(postId, dur);
    if (!Number.isFinite(dur) || dur <= 0) return;
    if (vid.currentTime >= 0.05) return;
    vid.currentTime = Math.min(0.1, Math.max(0.01, dur * 0.1));
  };
  if (vid.readyState >= 1) onMeta();
  else vid.addEventListener('loadedmetadata', onMeta, { once: true });
}

function bindDrag(el, obj) {
  const handle = el.querySelector('.drag');
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || spaceDown || pan) return;
    e.preventDefault();
    e.stopPropagation();
    selectCard(obj.id && state.ideas.some((i) => i.id === obj.id) ? obj.id : 'stage');
    const p = toCanvas(e.clientX, e.clientY);
    drag = { kind: 'xy', obj, el, ox: p.x - obj.x, oy: p.y - obj.y };
    handle.setPointerCapture(e.pointerId);
  });
}

function bindReorder(el, idea) {
  const handle = el.querySelector('.drag');
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || spaceDown || pan) return;
    e.preventDefault();
    e.stopPropagation();
    selectCard(idea.id);
    drag = { kind: 'reorder', obj: idea, el };
    handle.setPointerCapture(e.pointerId);
  });
}

function reorderLive(clientY) {
  const lane = document.getElementById('idea-lane');
  if (!lane || !drag || drag.kind !== 'reorder') return;
  const moving = drag.el;
  const cards = [...lane.querySelectorAll('.card.idea')];
  let before = null;
  for (const card of cards) {
    if (card === moving) continue;
    const r = card.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) {
      before = card;
      break;
    }
  }
  if (before) {
    if (moving.nextElementSibling !== before) lane.insertBefore(moving, before);
  } else if (cards[cards.length - 1] !== moving) {
    lane.appendChild(moving);
  }
}

function commitReorder() {
  const lane = document.getElementById('idea-lane');
  if (!lane) return;
  const byId = new Map(getActive(state).ideas.map((idea) => [idea.id, idea]));
  const next = [...lane.querySelectorAll('.card.idea')]
    .map((node) => byId.get(node.dataset.id))
    .filter(Boolean);
  if (next.length) getActive(state).ideas = next;
  persist();
}

canvas.addEventListener('pointermove', (e) => {
  if (!drag || pan || drag.kind === 'reorder') return;
  const p = toCanvas(e.clientX, e.clientY);
  drag.obj.x = p.x - drag.ox;
  drag.obj.y = p.y - drag.oy;
  if (drag.el) {
    drag.el.style.left = drag.obj.x + 'px';
    drag.el.style.top = drag.obj.y + 'px';
  }
});

canvas.addEventListener('pointerup', () => {
  if (!drag || drag.kind === 'reorder') return;
  persist();
  drag = null;
});
canvas.addEventListener('pointercancel', () => {
  if (drag && drag.kind === 'reorder') return;
  drag = null;
});

wrap.addEventListener('pointermove', (e) => {
  if (!drag || drag.kind !== 'reorder') return;
  reorderLive(e.clientY);
});
wrap.addEventListener('pointerup', () => {
  if (!drag || drag.kind !== 'reorder') return;
  commitReorder();
  drag = null;
});
wrap.addEventListener('pointercancel', () => {
  if (!drag || drag.kind !== 'reorder') return;
  drag = null;
});

function armDelete(btn, onConfirm) {
  let armed = false;
  let t = 0;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.classList.add('armed');
      btn.textContent = 'Sure?';
      t = setTimeout(() => {
        armed = false;
        btn.classList.remove('armed');
        btn.textContent = 'Remove';
      }, 2500);
      return;
    }
    clearTimeout(t);
    onConfirm();
  });
}

function bindStatusToggle(btn, post) {
  const paint = () => {
    const on = post.status === 'published';
    btn.textContent = on ? 'Published' : 'Draft';
    btn.classList.toggle('published', on);
    btn.classList.remove('armed');
  };
  paint();
  let armed = false;
  let t = 0;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (post.status !== 'published') {
      setPublished(state, post.id, true);
      persist();
      render();
      return;
    }
    if (!armed) {
      armed = true;
      btn.classList.add('armed');
      btn.textContent = 'Unpublish?';
      t = setTimeout(() => { armed = false; paint(); }, 2500);
      return;
    }
    clearTimeout(t);
    setPublished(state, post.id, false);
    persist();
    render();
  });
}

function formatLastCutPreview(stageUndo) {
  if (!stageUndo) return '';
  const parts = [stageUndo.hook, stageUndo.body, stageUndo.cta]
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.join(' · ') || '(empty)';
}

function restoreLastWrite() {
  if (!undoStageWrite(state)) return;
  persist();
  render();
}

function paintUndoButton() {
  const btn = document.getElementById('agent-undo');
  const cut = document.getElementById('stage-cut');
  const snap = getActive(state).stageUndo;
  const can = Boolean(snap);
  if (btn) {
    btn.disabled = !can;
    btn.textContent = can ? 'Undo last write' : 'Undo';
  }
  if (cut) {
    const line = formatLastCutPreview(snap);
    cut.hidden = !can;
    cut.textContent = line;
    cut.title = line;
    cut.disabled = !can;
  }
  const kbdHint = document.getElementById('undo-kbd-hint');
  if (kbdHint) kbdHint.hidden = false;
}

function bindStageUndo() {
  const btn = document.getElementById('agent-undo');
  const cut = document.getElementById('stage-cut');
  if (btn) btn.addEventListener('click', restoreLastWrite);
  if (cut) cut.addEventListener('click', restoreLastWrite);
  paintUndoButton();
}

async function renderRail() {
  const seq = ++railSeq;
  const post = getActive(state);
  paintOutcomePrompt();
  const platform = getPlatform(post.platform);
  const scored = await scorePostMaybeWasm(post);
  if (seq !== railSeq) return;
  const inter = interactionsFor(post.platform);
  const money = monetizeFor(post.platform);
  const effects = effectsFor(post.platform);
  const showOutcome = shouldShowOutcome(post);
  const pasteSnap = post.lastPaste;
  const chipLine = showOutcome ? lastPasteChipText(pasteSnap) : '';
  const chipPlat = chipLine && pasteSnap && pasteSnap.platformId ? pasteSnap.platformId : '';

  rail.innerHTML = `
    <h2>Edit</h2>
    <label class="hint">Hook</label>
    <textarea id="f-hook">${escapeHtml(post.hook)}</textarea>
    <label class="hint">Body</label>
    <textarea id="f-body">${escapeHtml(post.body)}</textarea>
    <label class="hint">Call</label>
    <textarea id="f-cta">${escapeHtml(post.cta)}</textarea>
    <label class="hint">Tags (space separated)</label>
    <input id="f-tags" type="text" value="${escapeHtml((post.hashtags || []).join(' '))}">
    <label class="hint">Image / video prompt</label>
    <input id="f-gen" type="text" value="${escapeHtml(post.genPrompt || '')}" placeholder="Describe the still or clip">
    <p class="hint">Generation is a slot in v1 — paste a local file or run a later WaveSpeed pass.</p>
    <input id="f-file" type="file" accept="image/*,video/*">
    <label class="hint">Who this is for</label>
    <textarea id="f-audience" placeholder="Name the person, not a demographic bucket">${escapeHtml(post.audience || '')}</textarea>
    <label class="hint">How we know</label>
    <select id="f-audience-how">
      ${audienceHowOptions(post.audienceHow)}
    </select>

    <h2>Paste</h2>
    <p class="hint" id="paste-hint">Exact string for ${escapeHtml(platform.label)} — same as Copy post</p>
    <pre id="paste-view" class="paste-view" tabindex="0"></pre>
    <div class="thread-bar" id="thread-bar" hidden>
      <span id="thread-pos"></span>
      <button type="button" id="thread-prev">Prev part</button>
      <button type="button" id="thread-next">Next part</button>
    </div>
    <div class="outcome-block" id="outcome-block">
      <div class="outcome-prompt-head">
        <label class="hint outcome-prompt-label" for="f-outcome">What happened?</label>
        <span id="last-paste-chip" class="last-paste"${chipLine ? '' : ' hidden'}${chipPlat ? ` data-platform="${escapeHtml(chipPlat)}"` : ''}>${escapeHtml(chipLine)}</span>
        <button type="button" id="btn-copy-out" disabled aria-label="Copy out frozen paste to a file">Copy out</button>
      </div>
      <div id="outcome-prompt" class="outcome-prompt"${showOutcome ? '' : ' hidden'}>
        <input id="f-outcome" type="text" class="outcome-rail" value="${escapeHtml((post.outcome && post.outcome.note) || '')}" placeholder="What you saw — optional" aria-label="What happened?">
      </div>
      <label class="hint published-url-label" for="f-published-url">Live URL</label>
      <div class="published-url-row">
        <input id="f-published-url" type="url" class="published-url-rail" value="${escapeHtml(post.publishedUrl || '')}" placeholder="https://x.com/…/status/…" aria-label="Published URL">
        <button type="button" id="btn-copy-link" class="copy-link-btn"${canCopyLive(post.publishedUrl) ? '' : ' disabled'} aria-label="Copy live URL to clipboard">Copy link</button>
        <button type="button" id="btn-guest-scan"${post.publishedUrl ? '' : ' hidden'}${guestScanRouteLive === false ? ' disabled' : ''}>Scan</button>
      </div>
      <p id="guest-scan-hint" class="hint guest-scan-hint${guestScanRouteLive === false && post.publishedUrl ? ' guest-scan-stale' : ''}" hidden></p>
    </div>

    <h2>Structure · what each part does</h2>
    <p class="hint">Best form on ${platform.label}: ${platform.bestForm}</p>
    <div id="parts"></div>

    <h2>Marketability <span class="badge heuristic">heuristic</span></h2>
    <div id="score-block"></div>
    <div id="checks"></div>

    <h2>What went out</h2>
    <div id="outcome-ledger"></div>

    <h2>Interactions to expect</h2>
    <ul class="list">${inter.expect.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    <h2>Good practice</h2>
    <ul class="list">${inter.practices.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>

    <h2>Response effects</h2>
    <ul class="list effects">${effects.map((e) => `<li><strong>${escapeHtml(e.action)}</strong> — ${escapeHtml(e.effect)}</li>`).join('')}</ul>

    <h2>Monetization that fits this form</h2>
    <ul class="list">${money.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>

    <h2>Local agents</h2>
    <div class="agents" id="agents"><p class="hint">Reading Herdr…</p></div>
    <textarea id="agent-msg" placeholder="Message the selected agent"></textarea>
    <div class="agent-actions">
      <button type="button" id="agent-send">Send to first idle</button>
      <button type="button" id="agent-ask">Ask shop</button>
      <button type="button" id="agent-keep">Keep shop line</button>
      <div class="copy-with-chrome agent-copy-wrap">
        <span id="x-video-gate-dock" class="x-video-gate" hidden></span>
        <span id="thread-part-chrome-dock" class="thread-part-chrome" hidden></span>
        <button type="button" id="agent-copy">Copy</button>
      </div>
      <div class="agent-undo-wrap">
        <button type="button" id="agent-undo" disabled>Undo</button>
        <span id="undo-kbd-hint" class="lane-kbd-hint undo-kbd-hint" hidden><kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd></span>
      </div>
      <button type="button" id="stage-cut" class="stage-cut" hidden aria-label="Restore displaced copy"></button>
    </div>
  `;

  if (seq !== railSeq) return;

  const partsEl = rail.querySelector('#parts');
  paintStructure(partsEl);

  bindStagePart('f-hook', 'hook');
  bindStagePart('f-body', 'body');
  bindStagePart('f-cta', 'cta');
  bindField('f-tags', (v) => { post.hashtags = v.split(/\s+/).filter(Boolean).map((t) => t.replace(/^#/, '')); });
  bindField('f-gen', (v) => { post.genPrompt = v; });
  bindField('f-audience', (v) => { post.audience = v; });
  rail.querySelector('#f-audience-how').addEventListener('change', (e) => {
    post.audienceHow = e.target.value;
    persist();
    scheduleJudgement();
  });
  const outcomeInput = rail.querySelector('#f-outcome');
  if (outcomeInput) bindOutcomeField(outcomeInput, post);
  bindPublishedUrlField(rail.querySelector('#f-published-url'), post);
  bindCopyLink(rail.querySelector('#btn-copy-link'));
  bindGuestScan(rail.querySelector('#btn-guest-scan'));
  paintCopyLink();
  paintGuestScan();
  paintOutcomePrompt();
  paintSaveError();
  bindCopyOut(document.getElementById('btn-copy-out'));
  paintJudgement(scored);

  rail.querySelector('#f-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    attachLocalFile(file, false);
  });

  loadAgentDock();
  bindStageUndo();
  const nextPart = rail.querySelector('#thread-next');
  const prevPart = rail.querySelector('#thread-prev');
  if (prevPart) prevPart.addEventListener('click', prevThreadPart);
  if (nextPart) nextPart.addEventListener('click', advanceThreadPart);
  paintThreadChrome();
}

function afterFieldInput() {
  persist();
  paintUndoButton();
  paintPasteView();
  scheduleJudgement();
  paintCanvasHint();
}

function bindField(id, apply) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    apply(el.value);
    afterFieldInput();
  });
}

function snapshotStageParts(post) {
  return {
    hook: String(post.hook || ''),
    body: String(post.body || ''),
    cta: String(post.cta || '')
  };
}

function stagePartsChanged(a, b) {
  return a.hook !== b.hook || a.body !== b.body || a.cta !== b.cta;
}

function bindStagePart(id, field) {
  const el = document.getElementById(id);
  let before = null;
  el.addEventListener('focus', () => {
    before = snapshotStageParts(getActive(state));
  });
  el.addEventListener('input', () => {
    getActive(state)[field] = el.value;
    afterFieldInput();
  });
  el.addEventListener('blur', () => {
    if (!before) return;
    const post = getActive(state);
    if (stagePartsChanged(before, snapshotStageParts(post))) {
      rememberStageWrite(state, before);
      persist();
      paintUndoButton();
    }
    before = null;
  });
}

let judgeSeq = 0;
let judgeTimer = 0;

function scheduleJudgement() {
  clearTimeout(judgeTimer);
  judgeTimer = setTimeout(() => { refreshJudgement(); }, 40);
}

async function refreshJudgement() {
  const seq = ++judgeSeq;
  const scored = await scorePostMaybeWasm(state.post);
  if (seq !== judgeSeq) return;
  paintJudgement(scored);
}

function audienceHowOptions(current) {
  const opts = [
    ['unknown', 'Unknown'],
    ['inferred', 'Inferred'],
    ['stated', 'Stated']
  ];
  return opts.map(([v, label]) =>
    `<option value="${v}"${(current || 'unknown') === v ? ' selected' : ''}>${label}</option>`
  ).join('');
}

function paintJudgement(scored) {
  const post = state.post;
  const platform = getPlatform(post.platform);
  const scoreBlock = rail.querySelector('#score-block');
  const checks = rail.querySelector('#checks');
  const partsEl = rail.querySelector('#parts');
  const hasAudience = Boolean((post.audience || '').trim());

  if (scoreBlock) {
    if (!hasAudience) {
      scoreBlock.innerHTML = `<p class="hint no-score">No score until who is named.</p>`;
    } else {
      const rust = scored.engine === 'rust';
      const engine = rust ? 'rust, live' : 'js fallback, live';
      scoreBlock.innerHTML = `
        <div class="score ${scored.band}"><span class="badge heuristic">heuristic</span> ${scored.score}</div>
        <p class="hint engine-hint">${escapeHtml(scored.band)} for ${escapeHtml(platform.label)} · <span class="engine ${rust ? 'rust' : 'js'}">${engine}</span></p>`;
    }
  }
  if (checks) {
    checks.innerHTML = '';
    for (const c of scored.checks || []) {
      const d = document.createElement('div');
      d.className = 'check ' + (c.ok ? 'ok' : 'no');
      d.textContent = (c.ok ? '✓ ' : '– ') + c.note;
      checks.appendChild(d);
    }
  }
  if (partsEl) paintStructure(partsEl);
  paintPasteView();
  paintLedger(scored);
}

/**
 * Read-only list of what went out: frozen paste, the operator's own note, and
 * the band **only** for the active post, whose score was already computed for
 * the rail above. The ledger never calls the scorer — other posts simply show
 * no band rather than triggering a scoring pass, and no rate is ever derived.
 */
function paintLedger(scored) {
  const box = rail.querySelector('#outcome-ledger');
  if (!box) return;

  const active = getActive(state);
  const scoreById = scored && scored.band ? { [active.id]: { band: scored.band } } : null;
  const rows = formatLedger(state.posts, scoreById);

    if (!rows.length) {
    box.innerHTML = '<p class="hint">Nothing copied, noted, or linked yet. Copy a post, then say what happened — or drop the live URL.</p>';
    return;
  }

  box.innerHTML = rows.map((row) => {
    const band = row.band ? `<span class="ledger-band ${escapeHtml(row.band)}">${escapeHtml(row.band)}</span>` : '';
    const paste = row.paste
      ? `<span class="ledger-paste" title="${escapeHtml(row.paste)}">${escapeHtml(row.paste)}</span>`
      : '<span class="ledger-paste none">not copied yet</span>';
    const note = row.note
      ? `<span class="ledger-note" title="${escapeHtml(row.note)}">${escapeHtml(row.note)}</span>`
      : '<span class="ledger-note none">no note yet</span>';
    const href = row.href
      ? `<a class="ledger-href" href="${escapeHtml(row.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.href)}</a>`
      : '';
    const here = row.id === active.id ? ' here' : '';
    return `<div class="ledger-row${here}" data-id="${escapeHtml(row.id)}">
      <span class="ledger-title">${escapeHtml(row.title)}</span>${band}
      ${paste}
      ${note}
      ${href}
    </div>`;
  }).join('');
}

function paintPasteView() {
  const post = getActive(state);
  const platform = getPlatform(post.platform);
  const parts = liveThread(post, platform);
  const i = threadCursor.index;
  const n = parts.length;
  const text = parts[i] || '';
  const el = rail.querySelector('#paste-view');
  if (el) el.textContent = text;
  const hint = rail.querySelector('#paste-hint');
  const bar = rail.querySelector('#thread-bar');
  const pos = rail.querySelector('#thread-pos');
  const next = rail.querySelector('#thread-next');
  const prev = rail.querySelector('#thread-prev');
  const threaded = platform.id === 'x' && n > 1;
  if (hint) {
    hint.textContent = threaded
      ? `Exact string for ${platform.label} — ${i + 1}/${n} · Copy sends this part`
      : `Exact string for ${platform.label} — same as Copy post`;
  }
  if (bar) bar.hidden = !threaded;
  if (pos) pos.textContent = threaded ? `${i + 1}/${n}` : '';
  if (prev) prev.disabled = !threaded || i <= 0;
  if (next) next.disabled = !threaded;
  if (bar) {
    if (threaded) bar.dataset.final = isFinalThreadPart(i, n) ? '1' : '0';
    else delete bar.dataset.final;
  }
  paintStagePreview();
  paintThreadChrome();
}

/** One-click clipboard of the live paste string (current thread part on X). */
function bindLiveCopy(btn) {
  if (!btn || btn.dataset.copyBound) return;
  btn.dataset.copyBound = '1';
  const idle = btn.textContent || 'Copy post';
  btn.addEventListener('click', async () => {
    const flash = (label, kind) => {
      btn.textContent = label;
      btn.classList.remove('copied', 'failed', 'warn');
      if (kind) btn.classList.add(kind);
      clearTimeout(btn._copyT);
      btn._copyT = setTimeout(() => {
        btn.textContent = idle;
        btn.classList.remove('copied', 'failed', 'warn');
      }, 2000);
    };
    try {
      const post = getActive(state);
      const platform = getPlatform(post.platform);
      const text = formatLiveCopy(post, platform).trim();
      if (!text || text === 'Untitled post') {
        flash('Nothing to copy');
        return;
      }
      const partIndex = threadCursor.index;
      const parts = liveThread(post, platform);
      const snap = {
        text,
        platformId: platform.id,
        partIndex,
        stage: {
          hook: String(post.hook || ''),
          body: String(post.body || ''),
          cta: String(post.cta || ''),
          hashtags: Array.isArray(post.hashtags) ? post.hashtags.map(String) : []
        }
      };
      await navigator.clipboard.writeText(text);
      setLastPaste(state, post.id, snap);
      persist();
      if (isFinalThreadPart(partIndex, parts.length)) {
        copiedIds.add(post.id);
      }
      paintOutcomePrompt();
      paintBoard();
      const partLabel = threadChromeLabel();
      if (partLabel) flash(`Copied · ${partLabel}`, 'copied');
      else if (text.length > (platform.maxChars || 0)) flash('Copied · over limit', 'warn');
      else if (!String(state.post.audience || '').trim()) flash('Copied · no who named', 'copied');
      else flash('Copied · ' + platform.label, 'copied');
    } catch {
      flash('Copy failed', 'failed');
    }
  });
}

async function loadAgentDock() {
  const box = document.getElementById('agents');
  const sendBtn = document.getElementById('agent-send');
  const askBtn = document.getElementById('agent-ask');
  const keepBtn = document.getElementById('agent-keep');
  const copyDock = document.getElementById('agent-copy');
  bindLiveCopy(copyDock);
  paintUndoButton();
  paintThreadChrome();
  if (!box) return;

  const disable = (why) => {
    box.innerHTML = `<p class="hint">${escapeHtml(why)}</p>`;
    if (sendBtn) sendBtn.disabled = true;
    if (askBtn) askBtn.disabled = true;
    if (keepBtn) keepBtn.disabled = true;
  };

  let herdr = true;
  let agents = [];
  try {
    ({ herdr, agents } = await listAgents());
  } catch (err) {
    disable(`Agent dock offline (${err.message}). The canvas still works locally.`);
    return;
  }

  if (!herdr) {
    disable('Herdr is not installed, so there is nothing to talk to. The canvas still works locally.');
    return;
  }
  if (!agents.length) {
    disable('No Herdr agents visible. Start one in a pane, then this dock will list it.');
    return;
  }

  // Selection is by pane_id; first idle agent is the default target.
  let selected = (agents.find((a) => a.status === 'idle') || agents[0]).pane_id;

  const paint = () => {
    box.innerHTML = agents.map((a) => `
      <div class="agent${a.pane_id === selected ? ' sel' : ''}" data-target="${escapeHtml(a.pane_id)}">
        <strong>${escapeHtml(a.name)}</strong>
        <span class="kind">${escapeHtml(a.kind)}</span>
        <span class="st st-${escapeHtml(a.status)}">${escapeHtml(a.status)}</span>
        <span class="cwd" title="${escapeHtml(a.cwd)}">${escapeHtml(shortCwd(a.cwd))}</span>
      </div>`).join('');
    for (const el of box.querySelectorAll('.agent')) {
      el.addEventListener('click', () => { selected = el.dataset.target; paint(); });
    }
  };
  paint();

  const flashAsk = (label) => {
    if (!askBtn) return;
    askBtn.textContent = label;
    clearTimeout(flashAsk.t);
    flashAsk.t = setTimeout(() => { askBtn.textContent = 'Ask shop'; }, 2000);
  };

  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to selected agent';
    sendBtn.onclick = async () => {
      const input = document.getElementById('agent-msg');
      const text = input.value.trim();
      if (!text || !selected) return;
      sendBtn.disabled = true;
      try {
        await sendAgent(selected, text);
        input.value = '';
      } catch (err) {
        box.insertAdjacentHTML('beforeend', `<p class="hint">${escapeHtml(err.message)}</p>`);
      } finally {
        sendBtn.disabled = false;
      }
    };
  }

  if (askBtn) {
    askBtn.disabled = false;
    askBtn.textContent = 'Ask shop';
    askBtn.onclick = async () => {
      if (!selected) {
        flashAsk('No pane selected');
        return;
      }
      askBtn.disabled = true;
      try {
        const post = getActive(state);
        const platform = getPlatform(post.platform);
        const scored = await scorePostMaybeWasm(post);
        const parts = structureFor(post);
        const brief = formatStageBrief(post, platform, scored, parts);
        await sendAgent(selected, brief);
        flashAsk('Sent to shop');
      } catch {
        flashAsk('Ask failed');
      } finally {
        askBtn.disabled = false;
      }
    };
  }

  const flashKeep = (label) => {
    if (!keepBtn) return;
    keepBtn.textContent = label;
    clearTimeout(flashKeep.t);
    flashKeep.t = setTimeout(() => { keepBtn.textContent = 'Keep shop line'; }, 2000);
  };

  if (keepBtn) {
    keepBtn.disabled = false;
    keepBtn.textContent = 'Keep shop line';
    keepBtn.onclick = async () => {
      if (!selected) {
        flashKeep('No pane selected');
        return;
      }
      keepBtn.disabled = true;
      try {
        const data = await readAgent(selected);
        const line = lastShopLine(data && data.text);
        if (!line) {
          flashKeep('No shop line');
          return;
        }
        const idea = addIdea(state, { text: line, source: 'shop' });
        if (!idea) {
          flashKeep('No shop line');
          return;
        }
        persist();
        selectCard(idea.id);
        render();
        const card = wrap.querySelector(`.card.idea[data-id="${idea.id}"]`);
        const partSel = card && card.querySelector('select.idea-part');
        if (partSel) partSel.focus();
      } catch {
        flashKeep('Keep failed');
      } finally {
        keepBtn.disabled = false;
      }
    };
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function applyIdeaLayoutClass() {
  wrap.classList.toggle('ideas-free', ideaLayout() === 'free');
  wrap.classList.toggle('ideas-stack', ideaLayout() === 'stack');
}

function paintIdeaLaneHead(lane) {
  const head = document.createElement('div');
  head.className = 'idea-lane-head';
  const title = document.createElement('div');
  title.className = 'idea-lane-title';
  const h2 = document.createElement('h2');
  h2.textContent = 'Ideas';
  const kbdHint = document.createElement('span');
  kbdHint.className = 'lane-kbd-hint';
  const kbd = document.createElement('kbd');
  kbd.textContent = 'i';
  kbdHint.append(kbd, ' adds');
  title.append(h2, kbdHint);
  const toggle = document.createElement('div');
  toggle.className = 'idea-layout-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Idea layout');
  for (const [mode, label] of [['stack', 'Stack'], ['free', 'Free']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(ideaLayout() === mode));
    b.addEventListener('click', () => {
      if (ideaLayout() === mode) return;
      setIdeaLayout(mode);
    });
    toggle.appendChild(b);
  }
  head.append(title, toggle);
  lane.appendChild(head);
}

function ensureIdeaLane() {
  let lane = document.getElementById('idea-lane');
  if (lane) return lane;
  lane = document.createElement('aside');
  lane.id = 'idea-lane';
  lane.className = 'idea-lane';
  lane.setAttribute('aria-label', 'Ideas');
  wrap.insertBefore(lane, canvas);
  lane.addEventListener('wheel', (e) => e.stopPropagation());
  return lane;
}

function ensureBoard() {
  let board = document.getElementById('post-board');
  if (board) return board;
  board = document.createElement('aside');
  board.id = 'post-board';
  board.className = 'board';
  board.setAttribute('aria-label', 'Posts');
  const lane = document.getElementById('idea-lane');
  wrap.insertBefore(board, lane || canvas);
  board.addEventListener('wheel', (e) => e.stopPropagation());
  return board;
}

function hasLastPaste(post) {
  return Boolean(post && post.lastPaste && String(post.lastPaste.text || '').trim());
}

/** Synthetic download name from the snapshot only. No title, no home path. */
function copyOutFilename(snap, allParts) {
  const plat = String((snap && snap.platformId) || 'paste')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'paste';
  if (allParts) return plat + '-thread.txt';
  const raw = snap && snap.partIndex;
  const part = Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
  return plat + '-part-' + part + '.txt';
}

/** Frozen formatThread parts when the live post is an X thread. Not a live rewrite. */
function copyOutAllParts(post, snap) {
  const livePlat = getPlatform(post.platform);
  if (livePlat.id !== 'x') return false;
  if (formatThread(post, livePlat).length < 2) return false;
  const frozen = copyOutFrozenParts(snap);
  return frozen.length > 1;
}

function copyOutFrozenParts(snap) {
  const stage = snap && snap.stage;
  if (!stage || snap.platformId !== 'x') return [];
  return formatThread({
    hook: String(stage.hook || ''),
    body: String(stage.body || ''),
    cta: String(stage.cta || ''),
    hashtags: Array.isArray(stage.hashtags) ? stage.hashtags.slice() : []
  }, getPlatform('x'));
}

function copyOutText(post, snap) {
  if (copyOutAllParts(post, snap)) return copyOutFrozenParts(snap).join('\n\n');
  return String(snap.text);
}

function paintCopyOut() {
  const btn = document.getElementById('btn-copy-out');
  if (!btn) return;
  btn.disabled = !hasLastPaste(getActive(state));
}

function bindCopyOut(btn) {
  if (!btn || btn.dataset.copyOutBound) return;
  btn.dataset.copyOutBound = '1';
  btn.addEventListener('click', () => {
    const post = getActive(state);
    const snap = post.lastPaste;
    if (!hasLastPaste(post)) return;
    const allParts = copyOutAllParts(post, snap);
    const blob = new Blob([copyOutText(post, snap)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = copyOutFilename(snap, allParts);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    btn.classList.add('saved');
    clearTimeout(btn._copyOutSaved);
    btn._copyOutSaved = setTimeout(() => btn.classList.remove('saved'), 1000);
  });
}

function hasOutcomeNote(post) {
  return Boolean(post && post.outcome && String(post.outcome.note || '').trim());
}

let boardShowParked = false;

function paintBoard() {
  const board = ensureBoard();
  board.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'board-head';
  const heading = document.createElement('h2');
  heading.textContent = 'Board';
  const parkedN = parkedCount(state);
  const showParked = document.createElement('button');
  showParked.type = 'button';
  showParked.id = 'board-show-parked';
  showParked.className = 'board-show-parked';
  showParked.textContent = parkedN ? `Show parked (${parkedN})` : 'Show parked';
  showParked.disabled = parkedN === 0;
  showParked.setAttribute('aria-pressed', String(boardShowParked));
  showParked.title = parkedN === 0
    ? 'No parked posts'
    : boardShowParked ? 'Hide parked posts' : 'Show parked posts';
  if (parkedN > 0) {
    showParked.addEventListener('click', () => {
      boardShowParked = !boardShowParked;
      render();
    });
  }
  head.append(heading, showParked);
  board.appendChild(head);
  const list = document.createElement('div');
  list.className = 'board-list';
  // Park is overflow, not delete: parked posts drop out of the list but the
  // active one always stays, so the canvas never shows content with no row.
  const posts = boardShowParked ? state.posts : visiblePosts(state);
  for (const post of posts) {
    const row = document.createElement('div');
    row.className = 'board-row' + (post.id === state.activeId ? ' active' : '');
    row.dataset.id = post.id;
    if (post.parked === true) row.dataset.parked = '1';
    else delete row.dataset.parked;
    const copied = hasLastPaste(post);
    const noted = hasOutcomeNote(post);
    if (copied) row.dataset.copied = '1';
    else delete row.dataset.copied;
    if (noted) row.dataset.noted = '1';
    else delete row.dataset.noted;
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'board-pick';
    pick.textContent = post.title || 'Untitled post';
    pick.addEventListener('click', () => {
      if (state.activeId === post.id) return;
      setActive(state, post.id);
      persist();
      selectCard('stage');
      render();
    });
    row.appendChild(pick);
    if (copied) {
      const mark = document.createElement('span');
      mark.className = 'board-copied';
      mark.textContent = 'copied';
      mark.title = String(post.lastPaste.text).replace(/\s+/g, ' ').trim();
      row.appendChild(mark);
    }
    if (noted) {
      const mark = document.createElement('span');
      mark.className = 'board-noted';
      mark.textContent = 'noted';
      mark.title = String(post.outcome.note).replace(/\s+/g, ' ').trim();
      row.appendChild(mark);
    }
    if (post.source === 'banter' || post.source === 'marketing') {
      const mark = document.createElement('span');
      mark.className = 'board-src';
      mark.textContent = post.source === 'marketing' ? 'marketing' : 'shop';
      mark.title = post.source === 'marketing' ? 'From marketing' : 'From the shop inbox';
      row.appendChild(mark);
      row.dataset.source = post.source;
    }
    const park = document.createElement('button');
    park.type = 'button';
    park.className = 'board-park';
    if (post.parked === true) park.classList.add('is-parked');
    park.textContent = post.parked === true ? 'Unpark' : 'Park';
    const activeRow = post.id === state.activeId;
    park.disabled = activeRow;
    park.title = activeRow
      ? 'Cannot park the active post'
      : post.parked === true
        ? 'Return to the default board list'
        : 'Park off the default list';
    if (!activeRow) {
      park.addEventListener('click', (e) => {
        e.stopPropagation();
        setParked(state, post.id, !post.parked);
        persist();
        render();
      });
    }
    row.appendChild(park);
    const st = document.createElement('button');
    st.type = 'button';
    st.className = 'board-status';
    bindStatusToggle(st, post);
    row.appendChild(st);
    list.appendChild(row);
  }
  board.appendChild(list);
  // Parked work must stay discoverable — a count, not a silent disappearance.
  // Composer's park control hooks here: `#board-parked` is the affordance slot.
  const parked = parkedCount(state);
  if (parked) {
    const note = document.createElement('button');
    note.type = 'button';
    note.id = 'board-parked';
    note.className = 'board-parked';
    note.dataset.count = String(parked);
    note.textContent = `${parked} parked`;
    note.title = 'Parked posts are hidden from this list. Nothing was deleted.';
    note.addEventListener('click', () => {
      // Until Composer lands a real control, clicking unparks the oldest one
      // so parked work is never unreachable from the UI.
      const first = state.posts.find((p) => p.parked === true);
      if (!first) return;
      setParked(state, first.id, false);
      persist();
      render();
    });
    board.appendChild(note);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'board-new';
  add.textContent = 'New post';
  add.addEventListener('click', () => {
    addPost(state);
    persist();
    selectCard('stage');
    render();
  });
  board.appendChild(add);
}

function hintAction(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

function addBlankIdea() {
  const idea = { id: uid(), text: '', part: '' };
  if (ideaLayout() === 'free') {
    const pos = nextFreeIdeaPos();
    idea.x = pos.x;
    idea.y = pos.y;
  }
  state.ideas.push(idea);
  persist();
  selectCard(idea.id);
  render();
  const card = document.querySelector(`.card.idea[data-id="${idea.id}"]`);
  const ta = card && card.querySelector('textarea');
  if (ta) ta.focus();
}

function focusAskShop() {
  const ask = document.getElementById('agent-ask');
  if (!ask) return;
  ask.scrollIntoView({ block: 'nearest' });
  ask.focus();
}

function paintCanvasHint() {
  const post = getActive(state);
  const show = !(post.ideas && post.ideas.length) && !String(post.hook || '').trim();
  let el = canvas.querySelector('.canvas-hint');
  if (!show) {
    if (el) el.remove();
    return;
  }
  if (el) return;
  el = document.createElement('p');
  el.className = 'canvas-hint empty-board-hint';
  el.append(hintAction('Add an idea', addBlankIdea), ' or ', hintAction('Ask shop', focusAskShop));
  canvas.appendChild(el);
}

function render() {
  canvas.innerHTML = '';
  const lane = ensureIdeaLane();
  const free = ideaLayout() === 'free';
  lane.innerHTML = '';
  lane.classList.toggle('collapsed', free);
  paintIdeaLaneHead(lane);
  applyIdeaLayoutClass();
  renderPlatforms();
  for (const idea of getActive(state).ideas) {
    const card = ideaCard(idea);
    if (free) canvas.appendChild(card);
    else lane.appendChild(card);
  }
  canvas.appendChild(stageCard());
  paintCanvasHint();
  paintBoard();
  // Cards were just rebuilt from scratch. Re-assert the selection from the id
  // so a platform switch or idea edit cannot silently drop it.
  applySelection();
  renderRail();
  paintThreadChrome();
  paintCopyOut();
}

document.getElementById('btn-idea').addEventListener('click', () => addBlankIdea());

bindLiveCopy(document.getElementById('btn-export'));

await loadPlatforms();
await probeImageRoute();
await probeGuestScanRoute();
applyView();
render();
pullInbox();
setInterval(pullInbox, 10000);

/**
 * Still from an inbox post, re-checked on the way in.
 *
 * The launcher already filters, but this is a second gate on a different
 * machine boundary: the client must not paint a `blob:` from someone else's
 * page, a home path, or a video. Returns `[]` rather than throwing — a post
 * with an unusable still is still worth reading.
 */
function inboxStill(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const item = raw[0];
  if (!item || typeof item !== 'object') return [];
  const type = String(item.type || '');
  if (type && !type.startsWith('image/')) return [];

  const url = String(item.url || '').trim();
  if (url) {
    if (!/^data:image\//i.test(url)) return [];
    return [{ name: String(item.name || ''), type: type || 'image/*', url }];
  }

  const path = String(item.path || '').trim();
  if (!path || !isSafeRelPath(path)) return [];
  return [{ name: String(item.name || ''), type: type || 'image/*', path, url: mediaSrcForPath(path) }];
}

async function pullInbox() {
  try {
    const res = await fetch('/api/inbox');
    if (!res.ok) return;
    const data = await res.json();
    const incoming = Array.isArray(data.posts) ? data.posts : [];
    const have = new Set(state.posts.map((p) => p.id));
    let added = false;
    const stay = state.activeId;
    for (const item of incoming) {
      const id = inboxIdFromItem(item);
      if (!id || have.has(id)) continue;
      addPost(state, {
        id,
        title: item.title || 'Untitled post',
        hook: item.hook || '',
        body: item.body || '',
        cta: item.cta || '',
        platform: item.platform || 'x',
        audience: item.audience || '',
        audienceHow: item.audience ? 'stated' : 'unknown',
        source: item.source || 'banter',
        media: inboxStill(item.media),
        publishedUrl: id === W1_POST_ID
          ? (normalizePublishedUrl(item.publishedUrl) || W1_PUBLISHED_URL)
          : item.publishedUrl
      });
      have.add(id);
      added = true;
    }
    if (added) {
      setActive(state, stay);
      persist();
      render();
    }
  } catch {
    /* inbox is optional */
  }
}

function setPanCursor() {
  wrap.classList.toggle('pan-ready', spaceDown && !pan);
  wrap.classList.toggle('is-panning', !!pan);
}

document.addEventListener('focusin', (e) => {
  if (typingField(e.target)) keystrokeDirty = false;
});
document.addEventListener('input', (e) => {
  if (typingField(e.target)) keystrokeDirty = true;
}, true);

window.addEventListener('keydown', (e) => {
  if (lastWriteUndoKey(e)) {
    if (wantsNativeKeystrokeUndo(e.target)) return;
    if (!getActive(state).stageUndo) return;
    e.preventDefault();
    restoreLastWrite();
    return;
  }
  if (editingField(e.target)) return;
  if (e.code === 'Space') {
    if (e.repeat) return;
    e.preventDefault();
    spaceDown = true;
    setPanCursor();
    return;
  }
  if (e.key !== 'i' && e.key !== 'I') return;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  addBlankIdea();
});
window.addEventListener('focus', () => {
  const post = getActive(state);
  if (!post || !post.publishedUrl) return;
  if (guestScanRouteLive === false) return;
  const now = Date.now();
  if (now - guestScanFocusAt < 20000) return;
  guestScanFocusAt = now;
  runGuestScan(post);
});
window.addEventListener('blur', () => {
  spaceDown = false;
  pan = null;
  setPanCursor();
});

wrap.addEventListener('pointerdown', (e) => {
  if (drag) return;
  const middle = e.button === 1;
  if (!middle && !spaceDown) return;
  e.preventDefault();
  pan = { x: e.clientX - view.x, y: e.clientY - view.y };
  wrap.setPointerCapture(e.pointerId);
  setPanCursor();
});
wrap.addEventListener('pointermove', (e) => {
  if (!pan) return;
  view.x = e.clientX - pan.x;
  view.y = e.clientY - pan.y;
  applyView();
});
function endPan() {
  pan = null;
  setPanCursor();
}
wrap.addEventListener('pointerup', endPan);
wrap.addEventListener('pointercancel', endPan);
wrap.addEventListener('auxclick', (e) => {
  if (e.button === 1) e.preventDefault();
});
wrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  const next = Math.min(1.8, Math.max(0.45, view.scale * (e.deltaY < 0 ? 1.08 : 0.92)));
  if (next === view.scale) return;
  const r = wrap.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const cx = (x - view.x) / view.scale;
  const cy = (y - view.y) / view.scale;
  view.scale = next;
  view.x = x - cx * view.scale;
  view.y = y - cy * view.scale;
  applyView();
}, { passive: false });
