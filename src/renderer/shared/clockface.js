// Draws one clock face into a .clock element (DESIGN.md 5). Used by the desktop
// clock and by the settings preview.
import { timeInWords, timeParts, dateText, snapWeight, fontStack } from './timefmt.js';
import { hexToRgb } from './palette.js';

const SVG = 'http://www.w3.org/2000/svg';
let gradId = 0;

const srgbLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbLin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const el = (tag, cls, parent) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.append(n);
  return n;
};

function svgEl(tag, attrs, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}

export class ClockFace {
  /** onSize(w, h) is called when the natural size changes. */
  constructor(root, { onSize } = {}) {
    this.root = root;
    this.root.classList.add('clock');
    this.onSize = onSize;
    this.built = '';
    this.refs = {};
    this.timer = 0;
    this.c = null;
    this.locale = undefined;
    this.lastSize = '';
    this.id = `ut-clock-grad-${++gradId}`;
    if (onSize) {
      this.ro = new ResizeObserver(() => this.report());
      this.ro.observe(root);
      document.fonts.ready.then(() => this.report());
    }
  }

  /**
   * c: the clock settings. stops: the visualizer's current three stops (for Match visualizer).
   * size: override clock.size (the settings preview scales it down).
   */
  set(c, { stops, locale, size } = {}) {
    this.c = c;
    if (locale) this.locale = locale;
    const root = this.root;
    const mode = c.colourMode === 'visualizer' || c.colourMode === 'match' ? 'match' : c.colourMode === 'gradient' ? 'gradient' : 'solid';
    root.dataset.face = c.face;
    root.dataset.fill = mode;
    this.build(c);

    let weight = snapWeight(c.font, c.weight);
    if (c.face === 'stacked') weight = Math.max(600, weight);
    if (c.face === 'minimal') weight = Math.min(300, weight);
    const family = c.face === 'words' && c.font === 'Bahnschrift' ? 'var(--font-liner)' : fontStack(c.font);
    root.style.setProperty('--size', `${size || c.size}px`);
    root.style.setProperty('--tracking', `${c.letterSpacing / 100}em`);
    root.style.fontFamily = family;
    root.style.fontWeight = String(c.face === 'words' ? Math.max(400, Math.min(weight, 600)) : weight);
    root.style.opacity = String(Math.max(20, c.opacity) / 100);

    const [c1, c2] = mode === 'match' && stops ? [stops[1], stops[2]] : mode === 'gradient' ? [c.colourA, c.colourB] : [c.colourA, c.colourA];
    root.style.setProperty('--c1', c1);
    root.style.setProperty('--c2', c2);
    root.style.setProperty('--ca', c.colourA);
    if (this.refs.stop1) {
      this.refs.stop1.setAttribute('stop-color', c1);
      this.refs.stop2.setAttribute('stop-color', c2);
    }
    const L = (luminance(c1) + luminance(c2)) / 2;
    root.dataset.shade = !c.shadow ? 'none' : L < 0.5 ? 'light' : 'dark';
    this.schedule();
    this.report();
  }

  build(c) {
    const face = c.face;
    const key = `${face}|${c.date}`;
    if (key === this.built) return;
    this.built = key;
    const refs = (this.refs = {});
    this.root.replaceChildren();
    const f = el('div', `clock__face clock__face--${face}`, this.root);
    const showDate = face !== 'minimal' && c.date !== 'none';
    if (face === 'analog') {
      const svg = svgEl('svg', { class: 'clock__dial', viewBox: '-100 -100 200 200', fill: 'none', 'aria-hidden': 'true' }, f);
      const grad = svgEl('linearGradient', { id: this.id, x1: '0', y1: '-100', x2: '0', y2: '100', gradientUnits: 'userSpaceOnUse' }, svgEl('defs', {}, svg));
      refs.stop1 = svgEl('stop', { offset: '0' }, grad);
      refs.stop2 = svgEl('stop', { offset: '1' }, grad);
      const g = svgEl('g', { stroke: `url(#${this.id})` }, svg);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const major = i % 3 === 0;
        const r0 = major ? 82 : 86;
        svgEl('line', {
          x1: (Math.sin(a) * r0).toFixed(2), y1: (-Math.cos(a) * r0).toFixed(2),
          x2: (Math.sin(a) * 96).toFixed(2), y2: (-Math.cos(a) * 96).toFixed(2),
          'stroke-width': major ? 2.5 : 1, opacity: major ? 1 : 0.7,
        }, g);
      }
      refs.hour = svgEl('line', { x1: 0, y1: 0, x2: 0, y2: -52, 'stroke-width': 5 }, g);
      refs.minute = svgEl('line', { x1: 0, y1: 0, x2: 0, y2: -80, 'stroke-width': 2.5 }, g);
      refs.second = svgEl('line', { x1: 0, y1: 0, x2: 0, y2: -88, 'stroke-width': 1 }, g);
      svgEl('circle', { r: 4, fill: `url(#${this.id})`, stroke: 'none' }, svg);
      if (showDate) refs.date = el('div', 'clock__date', f);
    } else if (face === 'line') {
      const row = el('div', 'clock__row', f);
      if (showDate) refs.date = el('div', 'clock__date', row);
      refs.time = el('div', 'clock__time', row);
      const rule = el('div', 'clock__rule', f);
      for (let i = 0; i <= 4; i++) el('span', 'clock__tick', rule).style.left = `${i * 25}%`;
      refs.now = el('span', 'clock__now', rule);
      refs.face = f;
    } else {
      refs.time = el('div', 'clock__time', f);
      if (showDate) refs.date = el('div', 'clock__date', f);
    }
  }

  tick() {
    const c = this.c;
    if (!c) return;
    const { refs } = this;
    const face = c.face;
    const d = new Date();
    const seconds = c.seconds && (face === 'digital' || face === 'analog' || face === 'line');
    const t = timeParts(d, { h24: !!c.hour24, seconds });
    if (refs.date) refs.date.textContent = dateText(d, c.date, this.locale);
    switch (face) {
      case 'digital':
        refs.time.replaceChildren(`${t.hh}:${t.mm}`);
        if (seconds) el('span', 'clock__sec', refs.time).textContent = t.ss;
        break;
      case 'stacked':
        refs.time.replaceChildren();
        el('span', 'clock__hr', refs.time).textContent = t.hh;
        el('span', 'clock__min', refs.time).textContent = t.mm;
        break;
      case 'minimal':
        refs.time.textContent = `${t.hh} ${t.mm}`;
        break;
      case 'words':
        refs.time.replaceChildren();
        for (const line of timeInWords(d)) el('span', '', refs.time).textContent = line;
        break;
      case 'analog': {
        const s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
        refs.hour.setAttribute('transform', `rotate(${(h * 30).toFixed(2)})`);
        refs.minute.setAttribute('transform', `rotate(${(m * 6).toFixed(2)})`);
        refs.second.style.display = c.seconds ? '' : 'none';
        refs.second.setAttribute('transform', `rotate(${s * 6})`);
        break;
      }
      case 'line': {
        refs.time.textContent = `${t.hh}:${t.mm}${seconds ? `:${t.ss}` : ''}`;
        const frac = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
        const W = refs.face.offsetWidth;
        refs.now.style.left = `${(frac * 100).toFixed(3)}%`;
        const half = refs.time.offsetWidth / 2;
        const x = Math.min(W - half, Math.max(half, frac * W));
        refs.time.style.left = `${x}px`;
        if (refs.date) {
          // Date at the left end; the right end when the marker is in the first 30 %
          // or the time would run into it.
          refs.date.classList.toggle('is-right', frac < 0.3 || x - half < refs.date.offsetWidth + 16);
        }
        break;
      }
      default:
        break;
    }
  }

  schedule() {
    clearTimeout(this.timer);
    this.tick();
    const c = this.c;
    const perSecond = c.seconds || c.face === 'line' || c.face === 'analog';
    const now = Date.now();
    const wait = perSecond ? 1000 - (now % 1000) + 5 : 60000 - (now % 60000) + 5;
    this.timer = setTimeout(() => this.schedule(), wait);
  }

  report() {
    if (!this.onSize) return;
    const r = this.root.getBoundingClientRect();
    const w = Math.ceil(r.width), h = Math.ceil(r.height);
    const key = `${w}x${h}`;
    if (!w || !h || key === this.lastSize) return;
    this.lastSize = key;
    this.onSize(w, h);
  }

  stop() {
    clearTimeout(this.timer);
  }
}
