// Arrange mode overlay for one display (DESIGN.md 4). Draws what the main
// process says and forwards the pointer; geometry and snapping live in main.
const api = window.undertone;
const body = document.body;
const $ = (s) => document.querySelector(s);
const itemsEl = $('.items');
const guidesEl = $('.guides');
const bar = $('.arrange-bar');
const hintEl = $('.arrange-bar__hint');
const CORNERS = ['nw', 'ne', 'sw', 'se'];

let state = null;
let shownIn = false;
let dragging = false;
const itemEls = new Map();

const local = (r) => ({ x: r.x - state.display.x, y: r.y - state.display.y, w: r.w, h: r.h });

function itemEl(name) {
  let el = itemEls.get(name);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'item';
  for (const c of CORNERS) {
    const h = document.createElement('span');
    h.className = `handle handle--${c}`;
    el.append(h);
  }
  const ro = document.createElement('div');
  ro.className = 'readout';
  ro.innerHTML = '<b></b><span></span>';
  el.append(ro);
  itemsEl.append(el);
  itemEls.set(name, el);
  return el;
}

function renderItems() {
  const seen = new Set();
  const W = state.display.width;
  for (const it of state.items) {
    seen.add(it.name);
    const el = itemEl(it.name);
    const r = local(it.rect);
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    el.classList.toggle('is-selected', it.selected);
    const ro = el.querySelector('.readout');
    ro.querySelector('b').textContent = it.readout.name;
    ro.querySelector('span').textContent = it.readout.text;
    // Above the top-left corner; below the bottom-left one if it would leave the display.
    ro.classList.toggle('is-below', r.y - 30 < 0 && r.y + r.h + 30 <= state.display.height);
    el.hidden = r.x + r.w < 0 || r.y + r.h < 0 || r.x > W || r.y > state.display.height;
  }
  for (const [name, el] of itemEls) {
    if (!seen.has(name)) {
      el.remove();
      itemEls.delete(name);
    }
  }
}

function renderGuides() {
  const live = state.guides || [];
  if (!live.length) {
    for (const g of guidesEl.children) {
      if (g.classList.contains('is-fading')) continue;
      g.classList.add('is-fading');
      setTimeout(() => g.remove(), 140);
    }
    return;
  }
  guidesEl.replaceChildren();
  for (const g of live) {
    const el = document.createElement('div');
    el.className = 'guide';
    if (g.axis === 'x') {
      Object.assign(el.style, { left: `${g.at - state.display.x}px`, top: `${g.from - state.display.y}px`, width: '1px', height: `${g.to - g.from}px` });
    } else {
      Object.assign(el.style, { top: `${g.at - state.display.y}px`, left: `${g.from - state.display.x}px`, height: '1px', width: `${g.to - g.from}px` });
    }
    guidesEl.append(el);
  }
}

function renderBar() {
  bar.hidden = !state.primary;
  if (!state.primary) return;
  hintEl.textContent = state.hint;
  const wa = state.workArea;
  const cx = wa.x - state.display.x + wa.width / 2;
  const topY = wa.y - state.display.y + 24;
  const bw = bar.offsetWidth || 640;
  const near = { x: cx - bw / 2 - 16, y: topY - 16, w: bw + 32, h: 44 + 32 };
  const sel = state.items.find((i) => i.selected);
  let atBottom = false;
  if (sel) {
    const r = local(sel.rect);
    atBottom = r.x < near.x + near.w && r.x + r.w > near.x && r.y < near.y + near.h && r.y + r.h > near.y;
  }
  bar.style.left = `${cx}px`;
  bar.style.top = atBottom ? `${wa.y - state.display.y + wa.height - 24 - 44}px` : `${topY}px`;
}

function render(s) {
  state = s;
  renderItems();
  renderGuides();
  renderBar();
  if (s.leaving) {
    body.classList.remove('is-in');
    body.classList.add('is-out');
  } else if (!shownIn) {
    shownIn = true;
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add('is-in')));
  }
}

// ---------------------------------------------------------------- pointer

function cursorAt(x, y) {
  if (!state) return 'default';
  const sel = state.items.find((i) => i.selected);
  if (sel) {
    const r = local(sel.rect);
    const pts = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h] };
    for (const [c, [px, py]] of Object.entries(pts)) {
      if (Math.abs(x - px) <= 14 && Math.abs(y - py) <= 14) return c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize';
    }
  }
  for (const it of state.items) {
    const r = local(it.rect);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return 'move';
  }
  return 'default';
}

const send = (type, e) => api.arrange.pointer({ type, x: e.clientX, y: e.clientY, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey });

let pendingMove = null;
body.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.arrange-bar')) return;
  dragging = true;
  body.setPointerCapture(e.pointerId);
  send('down', e);
});
body.addEventListener('pointermove', (e) => {
  if (!dragging) {
    body.style.cursor = cursorAt(e.clientX, e.clientY);
    return;
  }
  if (!pendingMove) requestAnimationFrame(() => {
    if (pendingMove) send('move', pendingMove);
    pendingMove = null;
  });
  pendingMove = e;
});
const up = (e) => {
  if (!dragging) return;
  dragging = false;
  if (pendingMove) {
    send('move', pendingMove);
    pendingMove = null;
  }
  send('up', e);
};
body.addEventListener('pointerup', up);
body.addEventListener('pointercancel', up);
body.addEventListener('contextmenu', (e) => e.preventDefault());

bar.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (b) api.arrange.action(b.dataset.action);
});
// Keys are handled in the main process (before-input-event); keep buttons from taking Enter.
bar.addEventListener('keydown', (e) => e.preventDefault());

api.arrange.onState(render);
