// A Stage draws one visualizer into an element. A Loop drives it from the
// audio frames at a capped frame rate. DESIGN.md 2.1 and 2.3:
//   glow      0..100: blur glow/100 x 24 px (x height/220), alpha glow/100 x 0.8, colour = mid
//   feather   alpha mask at the edges, per style; off when a backdrop is on
//   resting   in silence every style settles over 600 ms to a 2 px line at 50 % in the mid colour
//   palette   crossfades when asked (800 ms on a cover change)
import { STYLE_MAP } from './visualizers.js';
import { buildLut, mixStops } from './palette.js';
import { createFrame } from './audio.js';

const MASK_X = 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)';
const MASK_T = 'linear-gradient(180deg, transparent, #000 20%)';

export class Stage {
  constructor(el, { style = 'bars', glow = 40, density = 50, feather = true, scale = 1, extra = {} } = {}) {
    this.el = el;
    el.classList.add('ut-stage');
    this.glowCanvas = document.createElement('canvas');
    this.glowCanvas.className = 'ut-glow';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ut-main';
    el.append(this.glowCanvas, this.canvas);
    this.g = this.canvas.getContext('2d');
    this.gg = this.glowCanvas.getContext('2d');
    this.scale = scale;
    this.extra = extra;
    this.density = density / 100;
    this.feather = feather;
    this.rest = 1;
    this.forceRest = false;
    this.fade = null;
    this.stops = ['#7a1e0a', '#eb4a22', '#ffc27a'];
    this.lut = buildLut(this.stops);
    this.setStyle(style);
    this.setGlow(glow);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.cssW = r.width;
    this.cssH = r.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.scale;
    this.dpr = dpr;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.glowCanvas.width = Math.max(1, Math.round(w / 4));
      this.glowCanvas.height = Math.max(1, Math.round(h / 4));
      this.state = {};
    }
  }

  setStyle(id) {
    const next = STYLE_MAP[id] || STYLE_MAP.bars;
    if (next === this.style) return;
    this.style = next;
    this.state = {};
    this.applyMask();
    if (this.glow !== undefined) this.setGlow(this.glow * 100);
  }

  setFeather(on) {
    this.feather = on;
    this.applyMask();
  }

  applyMask() {
    const f = this.feather ? this.style.feather : '';
    const mask = f === 'xt' ? `${MASK_X}, ${MASK_T}` : f === 'x' ? MASK_X : '';
    this.el.style.webkitMaskImage = mask;
    this.el.style.maskImage = mask;
    this.el.style.webkitMaskComposite = f === 'xt' ? 'source-in' : '';
    this.el.style.maskComposite = f === 'xt' ? 'intersect' : '';
  }

  /** Three stops. fadeMs > 0 crossfades from what is showing now. */
  setPalette(stops, fadeMs = 0) {
    const key = stops.join();
    if (key === (this.fade ? this.fade.to.join() : this.stops.join())) return;
    if (fadeMs > 0) {
      this.fade = { from: this.stops.slice(), to: stops.slice(), t0: performance.now(), ms: fadeMs };
    } else {
      this.fade = null;
      this.stops = stops.slice();
      this.lut = buildLut(this.stops);
      if (this.state) this.state.grads = {};
    }
  }

  stepPalette(now) {
    if (!this.fade) return;
    const t = Math.min(1, (now - this.fade.t0) / this.fade.ms);
    this.stops = t >= 1 ? this.fade.to : mixStops(this.fade.from, this.fade.to, t);
    this.lut = buildLut(this.stops);
    if (this.state) this.state.grads = {};
    if (t >= 1) this.fade = null;
  }

  get mid() {
    return this.stops[1];
  }

  setGlow(v) {
    this.glow = v / 100;
    const cap = this.style.glowCap;
    this.glowCanvas.style.opacity = String(Math.min(this.glow * 0.8, cap ? cap.alpha : 1));
    this.glowCanvas.style.display = this.glow > 0.005 ? '' : 'none';
  }

  setDensity(v) {
    this.density = v / 100;
  }

  /** Draw the resting line only (paused, or before any audio). */
  setResting(on) {
    this.forceRest = on;
  }

  render(f) {
    const { canvas: c, g } = this;
    if (!c.width) return;
    this.stepPalette(performance.now());
    const target = this.forceRest || f.silent ? 1 : 0;
    this.rest += (target - this.rest) * Math.min(1, (f.dt || 1 / 60) / 0.2);
    if (Math.abs(target - this.rest) < 0.01) this.rest = target;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    const o = { w: c.width, h: c.height, dpr: this.dpr, lut: this.lut, density: this.density, time: f.time, ...this.extra };
    if (this.rest < 0.99) {
      try {
        this.style.draw(g, f, o, this.state);
      } catch (e) {
        console.error(e);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      if (this.rest > 0.01) {
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = `rgba(0,0,0,${1 - this.rest})`;
        g.fillRect(0, 0, c.width, c.height);
      }
      g.globalCompositeOperation = 'source-over';
    }
    if (this.rest > 0.01) {
      const lw = 2 * this.dpr;
      const y = this.style.rest === 'middle' ? Math.round(c.height / 2 - lw / 2) : c.height - lw;
      g.globalAlpha = 0.5 * this.rest;
      g.fillStyle = this.mid;
      g.fillRect(0, y, c.width, lw);
      g.globalAlpha = 1;
    }
    if (this.glow > 0.005) {
      const gg = this.gg;
      const gw = this.glowCanvas.width, gh = this.glowCanvas.height;
      const cap = this.style.glowCap;
      let radius = this.glow * 24 * (this.cssH / 220) * (this.extra.glowScale || 1);
      if (cap) radius = Math.min(radius, cap.px);
      gg.globalCompositeOperation = 'copy';
      gg.filter = `blur(${Math.max(0.5, (radius * this.dpr) / 4)}px)`;
      gg.drawImage(c, 0, 0, gw, gh);
      gg.filter = 'none';
      gg.globalCompositeOperation = 'source-in';
      gg.fillStyle = this.mid;
      gg.fillRect(0, 0, gw, gh);
    }
  }

  destroy() {
    this.ro.disconnect();
    this.el.replaceChildren();
  }
}

export class Loop {
  constructor(audio, onFrame) {
    this.audio = audio;
    this.onFrame = onFrame;
    this.frame = createFrame();
    this.fps = 60;
    this.raf = 0;
    this.last = 0;
    this.tick = this.tick.bind(this);
  }

  /** '30' | '60' | 'display' */
  setCap(cap) {
    this.fps = cap === 'display' ? 1000 : Number(cap) || 60;
  }

  get running() {
    return !!this.raf;
  }

  start() {
    if (this.raf) return;
    this.last = 0;
    this.audio.resume();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.suspend();
  }

  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    // Nothing coming through: 20 fps is plenty for the resting line.
    const fps = this.frame.silent && this.frame.level < 0.01 ? Math.min(20, this.fps) : this.fps;
    const minGap = 1000 / fps - 1.5;
    if (this.last && now - this.last < minGap) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.audio.read(this.frame, dt);
    this.onFrame(this.frame, dt);
  }
}

/** A looped synthetic signal for previews that should move without audio (style tiles). */
export function synthFrame(f, t, dt) {
  f.dt = dt;
  f.time = t;
  const beat = (t * 2) % 1;
  f.beat = beat < 0.08 ? 1 - beat / 0.08 : Math.max(0, f.beat - dt * 4);
  if (beat < dt * 2) f.beatCount++;
  for (let i = 0; i < f.bands.length; i++) {
    const x = i / f.bands.length;
    const v = 0.55 * Math.exp(-x * 2.4) * (0.6 + 0.4 * f.beat) + 0.22 * (0.5 + 0.5 * Math.sin(t * 2.1 + x * 11)) * (1 - x * 0.5) + 0.12 * (0.5 + 0.5 * Math.sin(t * 5.3 - x * 23));
    f.bands[i] += (Math.min(1, v) - f.bands[i]) * Math.min(1, dt * 14);
    f.peaks[i] = Math.max(f.peaks[i] - dt * 0.55, f.bands[i]);
  }
  for (let i = 0; i < f.wave.length; i++) f.wave[i] = 0.5 * Math.sin(i * 0.05 + t * 3) * (0.6 + 0.4 * f.beat) + 0.15 * Math.sin(i * 0.23 - t * 7);
  f.level = 0.6;
  f.left = 0.62 + 0.15 * Math.sin(t * 3.1);
  f.right = 0.58 + 0.15 * Math.sin(t * 2.7 + 1);
  f.bass = 0.6 * (0.6 + 0.4 * f.beat);
  f.mid = 0.4;
  f.treble = 0.25;
  f.silent = false;
  return f;
}
