'use strict';
// Arrange mode (DESIGN.md section 4). Wallpaper-layer windows get no mouse
// input, so while arranging:
//   - one transparent, always-on-top overlay per display draws the scrim,
//     outlines, handles, readouts, snap guides and the arrange bar, and takes
//     all mouse and keyboard input;
//   - each widget is lifted off the wallpaper, made topmost, click-through and
//     owned by the overlay of its display, which keeps it above the scrim even
//     when the overlay is activated.
// All geometry here is in screen DIP coordinates.

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const SNAP = 8;
const MARGIN = 48;
const UNDO = 10;
const VIS_MIN = { w: 240, h: 80 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const R = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
const centreOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
const waOf = (d) => ({ x: d.workArea.x, y: d.workArea.y, w: d.workArea.width, h: d.workArea.height });
const displayAt = (p) => screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) });

const CORNERS = ['nw', 'ne', 'sw', 'se'];
function cornerPoint(r, c) {
  return { x: c[1] === 'w' ? r.x : r.x + r.w, y: c[0] === 'n' ? r.y : r.y + r.h };
}
const opposite = (c) => (c[0] === 'n' ? 's' : 'n') + (c[1] === 'w' ? 'e' : 'w');

/**
 * h (host) supplies the widgets:
 *   items(): [{ name, label, kind: 'free'|'uniform', outline(), place(rect), size(), setSize(n, corner, point), win }]
 *   lift(name, overlayWin | null), defaults(name) -> { rect } | { size, rect },
 *   hint(firstRun) -> string, webPrefs(), rendererDir, onStart(), onEnd()
 */
class Arrange {
  constructor(h) {
    this.h = h;
    this.active = false;
    this.leaving = false;
    this.overlays = new Map(); // displayId -> win
    this.owner = new Map(); // widget name -> displayId
    this.selected = 'visualizer';
    this.drag = null;
    this.guides = [];
    this.undo = [];
    this.firstRun = false;
  }

  items() {
    return this.h.items();
  }

  item(name) {
    return this.items().find((i) => i.name === name);
  }

  async start({ firstRun = false } = {}) {
    if (this.active) return;
    this.active = true;
    this.leaving = false;
    this.firstRun = firstRun;
    this.undo = [];
    this.guides = [];
    this.drag = null;
    const names = this.items().map((i) => i.name);
    if (!names.includes(this.selected)) this.selected = names[0] || 'visualizer';
    this.h.onStart();
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay().id;
    const ready = [];
    for (const d of displays) {
      const win = new BrowserWindow({
        ...d.bounds,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        show: false,
        title: 'Undertone arrange',
        webPreferences: this.h.webPrefs(),
      });
      win.setMenu(null);
      win.setAlwaysOnTop(true, 'screen-saver');
      this.overlays.set(d.id, win);
      win.webContents.on('before-input-event', (e, input) => this.onKey(e, input));
      win.webContents.on('render-process-gone', () => this.end());
      win.webContents.on('did-fail-load', () => this.end());
      win.on('closed', () => {
        if (this.overlays.get(d.id) === win) this.overlays.delete(d.id);
        if (this.active && !this.leaving) this.end();
      });
      win.loadFile(path.join(this.h.rendererDir, 'arrange', 'index.html'), {
        query: { role: 'arrange', display: String(d.id), primary: d.id === primary ? '1' : '0' },
      });
      ready.push(new Promise((res) => {
        win.once('ready-to-show', () => res(true));
        setTimeout(() => res(false), 4000);
      }));
    }
    const ok = (await Promise.all(ready)).every(Boolean);
    if (!this.active) return;
    if (!ok) {
      console.warn('[arrange] overlay did not load; leaving arrange mode');
      this.end();
      return;
    }
    for (const win of this.overlays.values()) if (!win.isDestroyed()) win.showInactive();
    for (const it of this.items()) this.reown(it);
    const main = this.overlays.get(primary) || [...this.overlays.values()][0];
    if (main && !main.isDestroyed()) main.focus();
    this.broadcast();
  }

  /** Make a widget owned by the overlay of the display under its centre. */
  reown(it) {
    const d = displayAt(centreOf(it.outline()));
    const win = this.overlays.get(d.id);
    if (!win || win.isDestroyed()) return;
    if (this.owner.get(it.name) === d.id) return;
    this.owner.set(it.name, d.id);
    this.h.lift(it.name, win);
  }

  end() {
    if (!this.active || this.leaving) return;
    this.leaving = true;
    this.drag = null;
    this.guides = [];
    this.broadcast();
    setTimeout(() => {
      this.active = false;
      this.leaving = false;
      this.owner.clear();
      for (const it of this.items()) this.h.lift(it.name, null);
      for (const win of this.overlays.values()) if (!win.isDestroyed()) win.destroy();
      this.overlays.clear();
      this.h.onEnd(this.firstRun);
      this.firstRun = false;
    }, 210);
  }

  toggle() {
    if (this.active) this.end();
    else this.start();
  }

  // ---------------------------------------------------------------- state out

  snapshot() {
    return this.items().map((i) => ({ name: i.name, rect: { ...i.outline() }, size: i.kind === 'uniform' ? i.size() : null }));
  }

  pushUndo(snap) {
    this.undo.push(snap);
    if (this.undo.length > UNDO) this.undo.shift();
  }

  restore(snap) {
    for (const s of snap) {
      const it = this.item(s.name);
      if (!it) continue;
      if (it.kind === 'uniform' && s.size !== it.size()) it.setSize(s.size, 'nw', { x: s.rect.x, y: s.rect.y }, s.rect);
      else it.place(s.rect);
      this.reown(it);
    }
  }

  readout(it) {
    const r = it.outline();
    if (this.drag && this.drag.name === it.name && this.drag.kind === 'move') {
      const d = displayAt(centreOf(r));
      return { name: '', text: `x ${Math.round(r.x - d.bounds.x)}  y ${Math.round(r.y - d.bounds.y)}` };
    }
    if (it.kind === 'uniform') return { name: it.label, text: `${it.size()} px` };
    return { name: it.label, text: `${Math.round(r.w)} × ${Math.round(r.h)}` };
  }

  broadcast() {
    const items = this.items().map((it) => ({ name: it.name, rect: it.outline(), selected: it.name === this.selected, readout: this.readout(it), uniform: it.kind === 'uniform' }));
    const primary = screen.getPrimaryDisplay();
    for (const [id, win] of this.overlays) {
      if (win.isDestroyed()) continue;
      const d = screen.getAllDisplays().find((x) => x.id === id);
      if (!d) continue;
      win.webContents.send('arrange:state', {
        leaving: this.leaving,
        display: d.bounds,
        workArea: d.workArea,
        primary: d.id === primary.id,
        primaryWorkArea: primary.workArea,
        firstRun: this.firstRun,
        hint: this.h.hint(this.firstRun),
        dragging: !!this.drag,
        items,
        guides: this.guides,
      });
    }
  }

  // ---------------------------------------------------------------- snapping

  targets(it, d) {
    const wa = waOf(d);
    const xs = [wa.x, wa.x + MARGIN, wa.x + wa.w / 2, wa.x + wa.w - MARGIN, wa.x + wa.w];
    const ys = [wa.y, wa.y + MARGIN, wa.y + wa.h / 2, wa.y + wa.h - MARGIN, wa.y + wa.h];
    for (const o of this.items()) {
      if (o.name === it.name) continue;
      const r = o.outline();
      xs.push(r.x, r.x + r.w / 2, r.x + r.w);
      ys.push(r.y, r.y + r.h / 2, r.y + r.h);
    }
    return { xs, ys, wa };
  }

  /** Nearest target within SNAP of any of the given edges. */
  static nearest(edges, targets) {
    let best = null;
    for (const e of edges) {
      for (const t of targets) {
        const d = t - e;
        if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
      }
    }
    return best;
  }

  guide(axis, at, wa) {
    return axis === 'x' ? { axis, at, from: wa.y, to: wa.y + wa.h } : { axis, at, from: wa.x, to: wa.x + wa.w };
  }

  keepOnScreen(r) {
    const d = displayAt(centreOf(r));
    const b = { x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height };
    return R(clamp(r.x, b.x - r.w + MARGIN, b.x + b.w - MARGIN), clamp(r.y, b.y - r.h + MARGIN, b.y + b.h - MARGIN), r.w, r.h);
  }

  // ---------------------------------------------------------------- pointer

  pointer(ev, displayId) {
    if (!this.active || this.leaving) return;
    const d = screen.getAllDisplays().find((x) => x.id === Number(displayId)) || screen.getPrimaryDisplay();
    const p = { x: d.bounds.x + ev.x, y: d.bounds.y + ev.y };
    if (ev.type === 'down') this.down(p);
    else if (ev.type === 'move') this.move(p, ev);
    else if (ev.type === 'up') this.up();
  }

  hit(p) {
    const sel = this.item(this.selected);
    if (sel) {
      const r = sel.outline();
      for (const c of CORNERS) {
        const q = cornerPoint(r, c);
        if (Math.abs(p.x - q.x) <= 14 && Math.abs(p.y - q.y) <= 14) return { it: sel, kind: c };
      }
    }
    const order = this.items().sort((a, b) => (a.name === this.selected ? -1 : b.name === this.selected ? 1 : 0));
    for (const it of order) if (inside(p, it.outline())) return { it, kind: 'move' };
    return null;
  }

  down(p) {
    const hit = this.hit(p);
    if (!hit) return;
    this.selected = hit.it.name;
    this.drag = {
      name: hit.it.name,
      kind: hit.kind === 'move' ? 'move' : 'resize',
      corner: hit.kind === 'move' ? null : hit.kind,
      start: p,
      rect: { ...hit.it.outline() },
      size: hit.it.kind === 'uniform' ? hit.it.size() : null,
      before: this.snapshot(),
      moved: false,
    };
    this.broadcast();
  }

  move(p, ev) {
    const dr = this.drag;
    if (!dr) return;
    const it = this.item(dr.name);
    if (!it) return;
    const dx = p.x - dr.start.x, dy = p.y - dr.start.y;
    if (!dr.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    dr.moved = true;
    this.guides = [];
    if (dr.kind === 'move') {
      let r = { ...dr.rect, x: dr.rect.x + dx, y: dr.rect.y + dy };
      if (!ev.alt) {
        const { xs, ys, wa } = this.targets(it, displayAt(centreOf(r)));
        const sx = Arrange.nearest([r.x, r.x + r.w / 2, r.x + r.w], xs);
        const sy = Arrange.nearest([r.y, r.y + r.h / 2, r.y + r.h], ys);
        if (sx) { r.x += sx.delta; this.guides.push(this.guide('x', sx.at, wa)); }
        if (sy) { r.y += sy.delta; this.guides.push(this.guide('y', sy.at, wa)); }
      }
      it.place(this.keepOnScreen(r));
      this.reown(it);
    } else if (it.kind === 'uniform') {
      const fixed = cornerPoint(dr.rect, opposite(dr.corner));
      const moving = cornerPoint(dr.rect, dr.corner);
      const w1 = Math.abs(moving.x + dx - fixed.x), h1 = Math.abs(moving.y + dy - fixed.y);
      const ratio = (w1 / dr.rect.w + h1 / dr.rect.h) / 2;
      const size = clamp(Math.round((dr.size * ratio) / 2) * 2, 24, 320);
      if (size !== it.size()) it.setSize(size, opposite(dr.corner), fixed, null);
    } else {
      const c = dr.corner;
      const d = displayAt(centreOf(dr.rect));
      const wa = waOf(d);
      let x0 = dr.rect.x, y0 = dr.rect.y, x1 = dr.rect.x + dr.rect.w, y1 = dr.rect.y + dr.rect.h;
      if (c[1] === 'w') x0 += dx; else x1 += dx;
      if (c[0] === 'n') y0 += dy; else y1 += dy;
      if (!ev.alt) {
        const { xs, ys } = this.targets(it, d);
        const ex = c[1] === 'w' ? x0 : x1, ey = c[0] === 'n' ? y0 : y1;
        const sx = Arrange.nearest([ex], xs), sy = Arrange.nearest([ey], ys);
        if (sx) { if (c[1] === 'w') x0 += sx.delta; else x1 += sx.delta; this.guides.push(this.guide('x', sx.at, wa)); }
        if (sy) { if (c[0] === 'n') y0 += sy.delta; else y1 += sy.delta; this.guides.push(this.guide('y', sy.at, wa)); }
      }
      let w = clamp(x1 - x0, VIS_MIN.w, wa.w), h = clamp(y1 - y0, VIS_MIN.h, wa.h);
      if (ev.shift) {
        const aspect = dr.rect.w / dr.rect.h;
        if (w / h > aspect) h = clamp(w / aspect, VIS_MIN.h, wa.h);
        else w = clamp(h * aspect, VIS_MIN.w, wa.w);
        this.guides = [];
      }
      const x = c[1] === 'w' ? dr.rect.x + dr.rect.w - w : dr.rect.x;
      const y = c[0] === 'n' ? dr.rect.y + dr.rect.h - h : dr.rect.y;
      it.place(R(x, y, w, h));
      this.reown(it);
    }
    this.broadcast();
  }

  up() {
    const dr = this.drag;
    if (!dr) return;
    this.drag = null;
    this.guides = [];
    if (dr.moved) {
      this.pushUndo(dr.before);
      const it = this.item(dr.name);
      if (it && it.settle) it.settle();
    }
    this.broadcast();
  }

  // ---------------------------------------------------------------- keys and actions

  onKey(e, input) {
    if (input.type !== 'keyDown') return;
    const k = input.key;
    const handled = this.key({ key: k, shift: input.shift, ctrl: input.control, alt: input.alt });
    if (handled) e.preventDefault();
  }

  key({ key, shift, ctrl }) {
    if (!this.active || this.leaving) return false;
    if (key === 'Escape' || key === 'Enter') { this.end(); return true; }
    if (key === 'Tab') {
      const names = this.items().map((i) => i.name);
      if (names.length) {
        const i = names.indexOf(this.selected);
        this.selected = names[(i + (shift ? -1 : 1) + names.length) % names.length];
        this.broadcast();
      }
      return true;
    }
    if (ctrl && (key === 'z' || key === 'Z')) {
      const snap = this.undo.pop();
      if (snap) { this.restore(snap); this.broadcast(); }
      return true;
    }
    if (key === 'c' || key === 'C') { this.action('centre'); return true; }
    if (key === 'r' || key === 'R') { this.action('reset'); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!arrows[key]) return false;
    const it = this.item(this.selected);
    if (!it) return true;
    const step = shift ? 10 : 1;
    const [ax, ay] = arrows[key];
    const before = this.snapshot();
    const r = it.outline();
    if (ctrl) {
      if (it.kind === 'uniform') {
        const delta = (ax + -ay) * (shift ? 10 : 2);
        const size = clamp(it.size() + delta, 24, 320);
        it.setSize(size, 'nw', { x: r.x, y: r.y }, null);
      } else {
        const wa = waOf(displayAt(centreOf(r)));
        it.place(R(r.x, r.y, clamp(r.w + ax * step, VIS_MIN.w, wa.w), clamp(r.h + ay * step, VIS_MIN.h, wa.h)));
      }
    } else {
      it.place(this.keepOnScreen({ ...r, x: r.x + ax * step, y: r.y + ay * step }));
    }
    if (it.settle) it.settle();
    this.reown(it);
    this.pushUndo(before);
    this.broadcast();
    return true;
  }

  action(a) {
    if (!this.active || this.leaving) return;
    if (a === 'done') return this.end();
    const it = this.item(this.selected);
    if (!it) return;
    const before = this.snapshot();
    if (a === 'centre') {
      const r = it.outline();
      const wa = waOf(displayAt(centreOf(r)));
      it.place(R(wa.x + (wa.w - r.w) / 2, r.y, r.w, r.h));
    } else if (a === 'reset') {
      const def = this.h.defaults(it.name);
      if (it.kind === 'uniform') it.reset(def);
      else it.place(def.rect);
    } else return;
    if (it.settle) it.settle();
    this.reown(it);
    this.pushUndo(before);
    this.broadcast();
  }

  /** The host calls this when a widget's size changed on its own (clock re-measured). */
  refresh() {
    if (!this.active) return;
    for (const it of this.items()) this.reown(it);
    this.broadcast();
  }
}

module.exports = { Arrange };
