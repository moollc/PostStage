import { loadPlatforms, getPlatforms, getPlatform } from '/source/shared/platforms.js';
import { loadState, saveState, uid, getActive, setActive, addPost, setPublished, setOutcome, addIdea } from '/source/shared/store.js';
import { scorePostMaybeWasm } from '/source/shared/score.js';
import { structureFor, interactionsFor, monetizeFor, effectsFor, PARTS } from '/source/shared/playbook.js';
import { listAgents, sendAgent, readAgent, lastShopLine, shortCwd } from '/source/shared/agent-bridge.js';
import { formatPost } from '/source/shared/export.js';
import { formatStageBrief } from '/source/shared/brief.js';

const canvas = document.getElementById('canvas');
const wrap = canvas.parentElement;
const rail = document.getElementById('rail');
const plats = document.getElementById('plats');

let state = loadState();
if (state.ideaLayout !== 'stack' && state.ideaLayout !== 'free') state.ideaLayout = 'stack';
let selected = 'stage';
let drag = null;
let pan = null;
let spaceDown = false;
const view = { x: 0, y: 0, scale: 1 };

function persist() {
  saveState(state);
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
  return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable;
}

function fullText() {
  const p = state.post;
  return [p.hook, p.body, p.cta, (p.hashtags || []).map((t) => '#' + t).join(' ')].filter(Boolean).join('\n\n');
}

function previewText(post, platform) {
  const parts = [post.hook, post.body, post.cta];
  if (platform.id === 'instagram' || platform.id === 'facebook' || platform.id === 'tiktok') {
    const tags = (post.hashtags || []).map((t) => '#' + t).join(' ');
    if (tags) parts.push(tags);
  }
  return parts.filter(Boolean).join('\n\n');
}

function charLabel(platform, used) {
  const rem = platform.maxChars - used;
  if (rem < 0) return `${-rem} over limit`;
  return `${rem} left`;
}

function isImageMedia(m) {
  if (!m || !m.url) return false;
  if (m.type && m.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(m.url);
}

function isVideoMedia(m) {
  if (!m || !m.url) return false;
  if (m.type && m.type.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(m.url);
}

function mediaSlotHtml(media) {
  const m = media && media[0];
  if (!m || !m.url) {
    return '<span class="media-placeholder">Image / video slot</span>';
  }
  if (isImageMedia(m)) {
    return `<img class="media-img" src="${m.url}" alt="${escapeHtml(m.name || 'media')}">`;
  }
  if (isVideoMedia(m)) {
    return `<video class="media-vid" src="${m.url}" controls muted playsinline></video>`;
  }
  return '<span class="media-placeholder">Media attached</span>';
}

function platformName(platform) {
  return platform.name || platform.handle.replace(/^@/, '') || 'You';
}

function buildPreview(post, platform) {
  const text = previewText(post, platform);
  const media = mediaSlotHtml(post.media);
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
  if (part === 'hook') post.hook = text;
  else if (part === 'body') post.body = text;
  else if (part === 'cta') post.cta = text;
  else if (part === 'tags') {
    post.hashtags = text.split(/\s+/).filter(Boolean).map((t) => t.replace(/^#/, ''));
  } else if (part === 'media') post.genPrompt = text;
  else return false;
  return true;
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

function stageCard() {
  const post = state.post;
  const platform = getPlatform(post.platform);
  const used = fullText().length;
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

  if (post.status === 'published') {
    const how = document.createElement('input');
    how.type = 'text';
    how.className = 'outcome';
    how.placeholder = 'How it did';
    how.setAttribute('aria-label', 'How it did');
    how.value = (post.outcome && post.outcome.note) || '';
    how.addEventListener('change', () => {
      setOutcome(state, post.id, how.value);
      persist();
    });
    el.appendChild(how);
  }

  const prev = document.createElement('div');
  prev.className = 'preview platform-' + platform.id + ' ' + platform.shape;
  prev.innerHTML = buildPreview(post, platform);
  fillPreviewText(prev, platform, previewText(post, platform));
  el.appendChild(prev);

  const chars = document.createElement('div');
  chars.className = 'chars' + (used > platform.maxChars ? ' over' : '');
  chars.textContent = charLabel(platform, used);
  el.appendChild(chars);

  bindDrag(el, post);
  el.addEventListener('mousedown', () => { selectCard('stage'); });
  return el;
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

async function renderRail() {
  const post = state.post;
  const platform = getPlatform(post.platform);
  const scored = await scorePostMaybeWasm(post);
  const inter = interactionsFor(post.platform);
  const money = monetizeFor(post.platform);
  const effects = effectsFor(post.platform);

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
    <p class="hint">Exact string for ${escapeHtml(platform.label)} — same as Copy post</p>
    <pre id="paste-view" class="paste-view" tabindex="0"></pre>

    <h2>Structure · what each part does</h2>
    <p class="hint">Best form on ${platform.label}: ${platform.bestForm}</p>
    <div id="parts"></div>

    <h2>Marketability <span class="badge heuristic">heuristic</span></h2>
    <div id="score-block"></div>
    <div id="checks"></div>

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
    </div>
  `;

  const partsEl = rail.querySelector('#parts');
  paintStructure(partsEl);

  bindField('f-hook', (v) => { post.hook = v; });
  bindField('f-body', (v) => { post.body = v; });
  bindField('f-cta', (v) => { post.cta = v; });
  bindField('f-tags', (v) => { post.hashtags = v.split(/\s+/).filter(Boolean).map((t) => t.replace(/^#/, '')); });
  bindField('f-gen', (v) => { post.genPrompt = v; });
  bindField('f-audience', (v) => { post.audience = v; });
  rail.querySelector('#f-audience-how').addEventListener('change', (e) => {
    post.audienceHow = e.target.value;
    persist();
    scheduleJudgement();
  });
  paintJudgement(scored);

  rail.querySelector('#f-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    post.media = [{ name: file.name, type: file.type, url }];
    persist();
    render();
  });

  loadAgentDock();
}

function bindField(id, apply) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    apply(el.value);
    persist();
    const card = canvas.querySelector('.stage-card');
    if (card) {
      const platform = getPlatform(state.post.platform);
      const text = previewText(state.post, platform);
      fillPreviewText(card.querySelector('.preview'), platform, text);
      const used = fullText().length;
      const ch = card.querySelector('.chars');
      ch.textContent = charLabel(platform, used);
      ch.classList.toggle('over', used > platform.maxChars);
    }
    scheduleJudgement();
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
}

function paintPasteView() {
  const el = rail.querySelector('#paste-view');
  if (!el) return;
  const platform = getPlatform(state.post.platform);
  el.textContent = formatPost(state.post, platform);
}

async function loadAgentDock() {
  const box = document.getElementById('agents');
  const sendBtn = document.getElementById('agent-send');
  const askBtn = document.getElementById('agent-ask');
  const keepBtn = document.getElementById('agent-keep');
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
        if (!addIdea(state, { text: line, source: 'shop' })) {
          flashKeep('No shop line');
          return;
        }
        persist();
        render();
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
  const h2 = document.createElement('h2');
  h2.textContent = 'Ideas';
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
  head.append(h2, toggle);
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
  wrap.insertBefore(board, wrap.firstChild);
  board.addEventListener('wheel', (e) => e.stopPropagation());
  return board;
}

function paintBoard() {
  const board = ensureBoard();
  board.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'Board';
  board.appendChild(heading);
  const list = document.createElement('div');
  list.className = 'board-list';
  for (const post of state.posts) {
    const row = document.createElement('div');
    row.className = 'board-row' + (post.id === state.activeId ? ' active' : '');
    row.dataset.id = post.id;
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
    if (post.source === 'banter') {
      const mark = document.createElement('span');
      mark.className = 'board-src';
      mark.textContent = 'shop';
      mark.title = 'From the shop inbox';
      row.appendChild(mark);
    }
    const st = document.createElement('button');
    st.type = 'button';
    st.className = 'board-status';
    bindStatusToggle(st, post);
    row.appendChild(st);
    list.appendChild(row);
  }
  board.appendChild(list);
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
  paintBoard();
  // Cards were just rebuilt from scratch. Re-assert the selection from the id
  // so a platform switch or idea edit cannot silently drop it.
  applySelection();
  renderRail();
}

document.getElementById('btn-idea').addEventListener('click', () => {
  const idea = { id: uid(), text: '', part: '' };
  if (ideaLayout() === 'free') {
    const pos = nextFreeIdeaPos();
    idea.x = pos.x;
    idea.y = pos.y;
  }
  state.ideas.push(idea);
  persist();
  render();
});

let copyTimer = 0;
const copyBtn = document.getElementById('btn-export');
copyBtn.addEventListener('click', async () => {
  clearTimeout(copyTimer);
  const flash = (label, kind) => {
    copyBtn.textContent = label;
    copyBtn.classList.remove('copied', 'failed');
    copyBtn.classList.add(kind);
    copyTimer = setTimeout(() => {
      copyBtn.textContent = 'Copy post';
      copyBtn.classList.remove('copied', 'failed');
    }, 2000);
  };
  try {
    const platform = getPlatform(state.post.platform);
    await navigator.clipboard.writeText(formatPost(state.post, platform));
    const who = String(state.post.audience || '').trim();
    if (!who) flash('Copied · no who named', 'copied');
    else flash('Copied · ' + getPlatform(state.post.platform).label, 'copied');
  } catch {
    flash('Copy failed', 'failed');
  }
});

await loadPlatforms();
applyView();
render();
pullInbox();
setInterval(pullInbox, 10000);

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
      const id = String(item.id || '').trim();
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
        source: item.source || 'banter'
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

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  if (editingField(e.target)) return;
  e.preventDefault();
  spaceDown = true;
  setPanCursor();
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
