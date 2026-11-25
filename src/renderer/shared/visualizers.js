// Visualizer styles. Each draws one frame into a cleared 2D context.
//   draw(g, f, o, st)
//   g  CanvasRenderingContext2D (device pixels)
//   f  audio frame from audio.js
//   o  { w, h, dpr, lut, density, time, compact }
//   st per-style scratch state, reset when the style changes
import { resample, BANDS } from './audio.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

function rgba(o, t, a) {
  const c = o.lut.rgb[clamp((t * 255) | 0, 0, 255)];
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function hGradient(g, o, x0, x1, alpha = 1, mirror = false) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = mirror ? 1 - Math.abs(t * 2 - 1) : t;
    gr.addColorStop(t, rgba(o, mirror ? 1 - u : u, alpha));
  }
  return gr;
}

function vGradient(g, o, y0, y1, alpha = 1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i <= 4; i++) gr.addColorStop(i / 4, rgba(o, i / 4, alpha));
  return gr;
}

/** Cache a gradient on the scratch state until size or palette changes. */
function cached(st, key, o, make) {
  const sig = `${key}|${o.w}|${o.h}|${o.lut.stops.join()}`;
  st.grads = st.grads || {};
  if (st.grads[key] && st.grads[key].sig === sig) return st.grads[key].g;
  const gr = make();
  st.grads[key] = { sig, g: gr };
  return gr;
}

// ---------------------------------------------------------------- Bars
const bars = {
  id: 'bars',
  name: 'Bars',
  draw(g, f, o, st) {
    const n = Math.round(lerp(16, 128, o.density));
    st.v = resample(f.bands, n, st.v);
    const base = o.h;
    const maxH = o.h * 0.9;
    const bw = o.w / n;
    const gap = Math.max(o.dpr, bw * 0.26);
    const r = Math.max(0, Math.min((bw - gap) / 2, 3 * o.dpr));
    const fill = cached(st, 'v', o, () => vGradient(g, o, base, base - maxH));
    g.fillStyle = fill;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2 * o.dpr, st.v[i] * maxH);
      g.roundRect(i * bw + gap / 2, base - bh, bw - gap, bh, [r, r, 0, 0]);
    }
    g.fill();
  },
};

// ---------------------------------------------------------------- Mirror
const mirror = {
  id: 'mirror',
  name: 'Mirror',
  draw(g, f, o, st) {
    const half = Math.round(lerp(12, 96, o.density));
    st.v = resample(f.bands, half, st.v);
    const n = half * 2;
    const cy = o.h / 2;
    const bw = o.w / n;
    const gap = Math.max(o.dpr, bw * 0.3);
    const r = Math.max(0, Math.min((bw - gap) / 2, 4 * o.dpr));
    g.fillStyle = cached(st, 'm', o, () => hGradient(g, o, 0, o.w, 1, true));
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const k = i < half ? half - 1 - i : i - half;
      const bh = Math.max(3 * o.dpr, st.v[k] * o.h * 0.86);
      g.roundRect(i * bw + gap / 2, cy - bh / 2, bw - gap, bh, r);
    }
    g.fill();
  },
};

// ---------------------------------------------------------------- Blocks
const blocks = {
  id: 'blocks',
  name: 'Blocks',
  draw(g, f, o, st) {
    const n = Math.round(lerp(12, 64, o.density));
    st.v = resample(f.bands, n, st.v);
    st.p = resample(f.peaks, n, st.p);
    const bw = o.w / n;
    const segH = 10 * o.dpr;
    const segs = clamp(Math.floor((o.h * 0.94) / segH), 6, 40);
    const top = o.h - segs * segH;
    const gx = Math.max(o.dpr * 1.5, bw * 0.16);
    const gy = Math.max(o.dpr * 1.5, segH * 0.28);
    // Unlit cells, one pass
    g.fillStyle = rgba(o, 0.5, 0.07);
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const lit = Math.round(st.v[i] * segs);
      for (let s = lit; s < segs; s++) g.rect(i * bw + gx / 2, top + (segs - 1 - s) * segH + gy / 2, bw - gx, segH - gy);
    }
    g.fill();
    // Lit cells, coloured bottom to top
    g.fillStyle = cached(st, 'v', o, () => vGradient(g, o, o.h, top));
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const lit = Math.round(st.v[i] * segs);
      for (let s = 0; s < lit; s++) g.rect(i * bw + gx / 2, top + (segs - 1 - s) * segH + gy / 2, bw - gx, segH - gy);
      const pk = Math.min(segs - 1, Math.round(st.p[i] * segs));
      if (pk > lit) g.rect(i * bw + gx / 2, top + (segs - 1 - pk) * segH + gy / 2, bw - gx, segH - gy);
    }
    g.fill();
  },
};

// ---------------------------------------------------------------- Ring
const ring = {
  id: 'ring',
  name: 'Ring',
  draw(g, f, o, st) {
    const half = Math.round(lerp(32, 180, o.density) / 2);
    st.v = resample(f.bands, half, st.v);
    const m = Math.min(o.w, o.h);
    const cx = o.w / 2, cy = o.h / 2;
    const R = m * (o.ringRadius || 0.26) * (1 + f.beat * 0.05);
    const L = m * 0.2;
    const n = half * 2;
    const grad = cached(st, 'c', o, () => {
      const gr = g.createConicGradient(-Math.PI / 2, cx, cy);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        gr.addColorStop(t, rgba(o, 1 - Math.abs(t * 2 - 1), 1));
      }
      return gr;
    });
    // Ripples on kicks
    st.ripples = st.ripples || [];
    if (f.beatCount !== st.lastBeat) {
      st.lastBeat = f.beatCount;
      if (f.beat > 0.5) st.ripples.push({ r: R, a: 0.5 * f.beat });
    }
    g.lineWidth = 1.5 * o.dpr;
    for (const rp of st.ripples) {
      rp.r += f.dt * m * 0.32;
      rp.a -= f.dt * 0.7;
      if (rp.a <= 0) continue;
      g.strokeStyle = rgba(o, 0.7, rp.a);
      g.beginPath();
      g.arc(cx, cy, rp.r, 0, TAU);
      g.stroke();
    }
    st.ripples = st.ripples.filter((r) => r.a > 0);
    // Spokes
    g.strokeStyle = grad;
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.5 * o.dpr, ((TAU * R) / n) * 0.5);
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const k = i < half ? i : n - 1 - i;
      const a = -Math.PI / 2 + ((i + 0.5) / n) * TAU;
      const len = 2 * o.dpr + st.v[k] * L;
      const c = Math.cos(a), s = Math.sin(a);
      g.moveTo(cx + c * (R + 3 * o.dpr), cy + s * (R + 3 * o.dpr));
      g.lineTo(cx + c * (R + 3 * o.dpr + len), cy + s * (R + 3 * o.dpr + len));
    }
    g.stroke();
    // Inner hairline
    if (!o.hideInner) {
      g.lineWidth = 1 * o.dpr;
      g.strokeStyle = rgba(o, 0.5, 0.35);
      g.beginPath();
      g.arc(cx, cy, R - 4 * o.dpr, 0, TAU);
      g.stroke();
    }
  },
};

// ---------------------------------------------------------------- Wave
const wave = {
  id: 'wave',
  name: 'Wave',
  draw(g, f, o, st) {
    const N = Math.round(lerp(64, 512, o.density));
    const src = f.wave;
    // Trigger on a rising zero crossing for a steady trace.
    let start = 0;
    for (let i = 1; i < src.length - 720; i++) {
      if (src[i - 1] < 0 && src[i] >= 0) { start = i; break; }
    }
    let peak = 0.02;
    for (let i = 0; i < 720; i++) peak = Math.max(peak, Math.abs(src[start + i] || 0));
    st.gain = lerp(st.gain || 1, clamp(0.8 / peak, 1, 8), 0.08);
    const ys = new Float32Array(N);
    const cy = o.h / 2;
    const amp = o.h * 0.4 * st.gain;
    const lim = o.h * 0.46 - 2 * o.dpr;
    for (let i = 0; i < N; i++) ys[i] = cy - lim * Math.tanh(((src[start + Math.round((i * 720) / N)] || 0) * amp) / lim) * Math.sin((Math.PI * i) / (N - 1));
    st.trail = (st.trail || []).filter((t) => t.length === N);
    st.trail.unshift(ys);
    if (st.trail.length > 5) st.trail.length = 5;
    const stroke = cached(st, 'h', o, () => hGradient(g, o, 0, o.w));
    g.strokeStyle = stroke;
    g.lineJoin = 'round';
    for (let t = st.trail.length - 1; t >= 0; t--) {
      const line = st.trail[t];
      g.globalAlpha = t === 0 ? 1 : 0.22 / t;
      g.lineWidth = (t === 0 ? 2.5 : 1.4) * o.dpr * (1 + f.beat * 0.4 * (t === 0));
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * o.w;
        if (i === 0) g.moveTo(x, line[i]);
        else g.lineTo(x, line[i]);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  },
};

// ---------------------------------------------------------------- Aurora
const aurora = {
  id: 'aurora',
  name: 'Aurora',
  draw(g, f, o, st) {
    const P = 48;
    st.v = resample(f.bands, P, st.v);
    const t = f.time;
    g.globalCompositeOperation = 'lighter';
    const layers = Math.round(lerp(2, 5, o.density));
    for (let L = layers - 1; L >= 0; L--) {
      const ct = layers > 1 ? L / (layers - 1) : 0.5;
      const baseY = o.h * (0.7 - L * 0.07);
      const depth = o.h * (0.34 + L * 0.05);
      const pts = [];
      for (let i = 0; i <= P; i++) {
        const x = (i / P) * o.w;
        const k = Math.min(P - 1, Math.floor(((i + L * 7) % (P + 1)) * (P / (P + 1))));
        const e = st.v[k];
        const drift = Math.sin(i * 0.21 + t * (0.35 + L * 0.11) + L * 1.7) * 0.5 + Math.sin(i * 0.07 - t * 0.23 + L) * 0.5;
        const y = baseY - e * o.h * (0.42 - L * 0.04) - drift * o.h * 0.07;
        pts.push([x, y]);
      }
      const gr = g.createLinearGradient(0, baseY - depth, 0, baseY + depth * 0.6);
      gr.addColorStop(0, rgba(o, ct, 0));
      gr.addColorStop(0.35, rgba(o, ct, 0.5));
      gr.addColorStop(1, rgba(o, ct, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      g.lineTo(o.w, pts[P][1]);
      for (let i = P; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + depth * (0.8 + 0.2 * Math.sin(i * 0.3 + t)));
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },
};

// ---------------------------------------------------------------- Orb
const orb = {
  id: 'orb',
  name: 'Orb',
  draw(g, f, o, st) {
    const H = Math.round(lerp(8, 64, o.density));
    st.v = resample(f.bands, H, st.v);
    st.ph = st.ph && st.ph.length === H ? st.ph : Float32Array.from({ length: H }, (_, k) => (k * 2.399) % TAU);
    st.kick = lerp(st.kick || 0, f.beat, 0.3);
    st.t = (st.t || 0) + f.dt;
    const cx = o.w / 2, cy = o.h / 2;
    const R = Math.min(o.w, o.h) * 0.3 * (1 + st.kick * 0.08 + f.level * 0.06);
    // Sum of harmonics, normalised so the outline stays within +-34 % of R.
    let norm = 0;
    for (let k = 0; k < H; k++) norm += 1 / Math.sqrt(k + 2);
    const P = 192;
    const path = new Path2D();
    for (let i = 0; i <= P; i++) {
      const th = (i / P) * TAU;
      let d = 0;
      for (let k = 0; k < H; k++) {
        const sp = (k % 2 ? 1 : -1) * (0.25 + k * 0.015);
        d += (st.v[k] / Math.sqrt(k + 2)) * Math.sin((k + 2) * th + st.ph[k] + st.t * sp);
      }
      const r = R * (1 + (0.34 * d) / norm * 2.2);
      const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    const grad = g.createRadialGradient(cx, cy - R * 0.18, R * 0.05, cx, cy, R * 1.35);
    grad.addColorStop(0, rgba(o, 1, 1));
    grad.addColorStop(0.45, rgba(o, 0.5, 1));
    grad.addColorStop(1, rgba(o, 0, 0.9));
    g.fillStyle = grad;
    g.fill(path);
    g.lineWidth = 1.5 * o.dpr;
    g.strokeStyle = rgba(o, 0.75, 0.9);
    g.stroke(path);
  },
};

// ---------------------------------------------------------------- Waterfall
const waterfall = {
  id: 'waterfall',
  name: 'Waterfall',
  draw(g, f, o, st) {
    const cols = Math.round(lerp(24, 128, o.density));
    const rows = 140;
    if (!st.buf || st.buf.width !== cols) {
      st.buf = new OffscreenCanvas(cols, rows);
      st.bg = st.buf.getContext('2d');
      st.row = new ImageData(cols, 1);
      st.acc = 0;
    }
    st.acc += f.dt;
    const step = 1 / 45;
    while (st.acc >= step) {
      st.acc -= step;
      st.bg.globalCompositeOperation = 'copy';
      st.bg.drawImage(st.buf, 0, -1);
      st.bg.globalCompositeOperation = 'source-over';
      const d = st.row.data;
      for (let i = 0; i < cols; i++) {
        const v = f.bands[Math.floor((i / cols) * BANDS)];
        const c = o.lut.rgb[clamp((v * 255) | 0, 0, 255)];
        d[i * 4] = c[0];
        d[i * 4 + 1] = c[1];
        d[i * 4 + 2] = c[2];
        d[i * 4 + 3] = clamp(Math.pow(v, 1.3) * 290, 0, 255);
      }
      st.bg.putImageData(st.row, 0, rows - 1);
    }
    // Crisp cells: no smoothing, then cut a 1 px gap between columns.
    g.imageSmoothingEnabled = false;
    g.drawImage(st.buf, 0, 0, o.w, o.h);
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    const cw = o.w / cols;
    if (cw >= 3 * o.dpr) {
      g.beginPath();
      for (let i = 1; i < cols; i++) g.rect(Math.round(i * cw) - o.dpr / 2, 0, o.dpr, o.h);
      g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = cached(st, 'fade', o, () => {
      const gr = g.createLinearGradient(0, 0, 0, o.h);
      gr.addColorStop(0, 'rgba(0,0,0,0.3)');
      gr.addColorStop(1, 'rgba(0,0,0,1)');
      return gr;
    });
    g.fillRect(0, 0, o.w, o.h);
    g.globalCompositeOperation = 'source-over';
  },
};

// ---------------------------------------------------------------- Particles
const particles = {
  id: 'particles',
  name: 'Particles',
  draw(g, f, o, st) {
    const MAX = Math.round(lerp(60, 600, o.density));
    if (!st.p) {
      st.p = [];
      st.acc = 0;
    }
    const n = 64;
    st.v = resample(f.bands, n, st.v);
    st.acc += f.dt * (20 + f.level * 260 * (0.5 + o.density));
    let burst = 0;
    if (f.beatCount !== st.lastBeat) {
      st.lastBeat = f.beatCount;
      burst = Math.round(f.beat * 40);
    }
    while ((st.acc >= 1 || burst > 0) && st.p.length < MAX) {
      if (burst > 0) burst--;
      else st.acc -= 1;
      // Pick a band, louder bands more likely.
      let k = (Math.random() * n) | 0;
      for (let tries = 0; tries < 3 && Math.random() > st.v[k] + 0.15; tries++) k = (Math.random() * n) | 0;
      st.p.push({
        x: ((k + Math.random()) / n) * o.w,
        y: o.h + 4,
        vx: (Math.random() - 0.5) * 0.04 * o.w,
        vy: -(0.18 + st.v[k] * 0.75 + Math.random() * 0.12) * o.h,
        life: 0,
        max: 1.4 + Math.random() * 1.6,
        c: k / (n - 1),
        s: (0.8 + Math.random() * 1.8) * o.dpr,
        ph: Math.random() * TAU,
      });
    }
    if (st.acc > 1) st.acc = 1;
    const B = 6;
    const paths = Array.from({ length: B }, () => new Path2D());
    const out = [];
    for (const q of st.p) {
      q.life += f.dt;
      if (q.life > q.max) continue;
      q.vy *= 1 - f.dt * 0.4;
      q.x += (q.vx + Math.sin(q.ph + q.life * 2.2) * 0.02 * o.w) * f.dt;
      q.y += q.vy * f.dt;
      if (q.y < -10) continue;
      out.push(q);
      const fade = 1 - q.life / q.max;
      const s = q.s * (0.5 + fade);
      const b = Math.min(B - 1, Math.floor(q.c * B));
      paths[b].moveTo(q.x + s, q.y);
      paths[b].arc(q.x, q.y, s, 0, TAU);
    }
    st.p = out;
    g.globalCompositeOperation = 'lighter';
    for (let b = 0; b < B; b++) {
      g.fillStyle = rgba(o, b / (B - 1), 0.8);
      g.fill(paths[b]);
    }
    g.globalCompositeOperation = 'source-over';
  },
};

// ---------------------------------------------------------------- Terrain
const terrain = {
  id: 'terrain',
  name: 'Terrain',
  draw(g, f, o, st) {
    const P = 64;
    const L = Math.round(lerp(6, 24, o.density));
    st.hist = st.hist || [];
    st.acc = (st.acc || 0) + f.dt;
    if (st.acc > 1 / 20 || !st.hist.length) {
      st.acc = 0;
      st.hist.push(Float32Array.from(resample(f.bands, P)));
      while (st.hist.length > L) st.hist.shift();
    } else {
      // Front line follows the live signal between snapshots.
      st.hist[st.hist.length - 1] = Float32Array.from(resample(f.bands, P));
    }
    const cx = o.w / 2;
    g.lineJoin = 'round';
    for (let j = 0; j < st.hist.length; j++) {
      const depth = (j + L - st.hist.length) / (L - 1); // 0 back .. 1 front
      const y0 = o.h * (0.2 + depth * 0.68);
      const spread = 0.55 + depth * 0.45;
      const amp = o.h * (0.12 + depth * 0.2);
      const row = st.hist[j];
      const path = new Path2D();
      for (let i = 0; i < P; i++) {
        const u = i / (P - 1);
        const win = Math.sin(Math.PI * u) ** 1.6;
        const x = cx + (u - 0.5) * o.w * 0.96 * spread;
        const y = y0 - row[i] * amp * win;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      // Occlude the lines behind, then draw this one.
      const fillPath = new Path2D(path);
      fillPath.lineTo(cx + o.w * 0.48 * spread, o.h);
      fillPath.lineTo(cx - o.w * 0.48 * spread, o.h);
      fillPath.closePath();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.fill(fillPath);
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = rgba(o, depth, 0.35 + depth * 0.65);
      g.lineWidth = (0.8 + depth * 1.4) * o.dpr;
      g.stroke(path);
    }
  },
};

// ---------------------------------------------------------------- Meters
const meters = {
  id: 'meters',
  name: 'Meters',
  draw(g, f, o, st) {
    const pad = Math.max(16 * o.dpr, o.w * 0.05);
    const labels = o.h > 70 * o.dpr; // no text at thumbnail size
    const labelW = labels ? 22 * o.dpr : 0;
    const x0 = pad + labelW, x1 = o.w - pad;
    const width = x1 - x0;
    const barH = clamp(o.h * 0.12, 6 * o.dpr, 22 * o.dpr);
    const gapY = barH * 1.4;
    const yL = o.h / 2 - gapY / 2 - barH;
    const yR = o.h / 2 + gapY / 2;
    const now = f.time;
    st.pk = st.pk || [0, 0];
    st.hold = st.hold || [0, 0];
    const vals = [f.left, f.right];
    vals.forEach((v, i) => {
      if (v >= st.pk[i]) { st.pk[i] = v; st.hold[i] = now; }
      else if (now - st.hold[i] > 1.2) st.pk[i] = Math.max(v, st.pk[i] - f.dt * 0.4);
    });
    const fill = cached(st, 'h', o, () => hGradient(g, o, x0, x1));
    const font = `${Math.round(11 * o.dpr)}px Bahnschrift, "Segoe UI", sans-serif`;
    g.font = font;
    g.textBaseline = 'middle';
    [[yL, 'L', 0], [yR, 'R', 1]].forEach(([y, lab, i]) => {
      g.fillStyle = 'rgba(239,235,226,0.6)';
      if (labels) g.fillText(lab, pad, y + barH / 2);
      g.fillStyle = 'rgba(239,235,226,0.08)';
      g.fillRect(x0, y, width, barH);
      g.fillStyle = fill;
      g.fillRect(x0, y, width * vals[i], barH);
      g.fillRect(x0 + width * st.pk[i] - 2 * o.dpr, y - 2 * o.dpr, 2 * o.dpr, barH + 4 * o.dpr);
    });
    // dB scale between the two rails (meter maps -54..0 dB).
    g.fillStyle = 'rgba(239,235,226,0.45)';
    g.textAlign = 'center';
    g.font = `${Math.round(9.5 * o.dpr)}px Bahnschrift, "Segoe UI", sans-serif`;
    for (const dB of [-48, -36, -24, -12, -6, -3, 0]) {
      const x = x0 + width * ((dB + 54) / 54);
      g.fillRect(x - 0.5 * o.dpr, yL + barH + 2 * o.dpr, 1 * o.dpr, 3 * o.dpr);
      if (labels && (width > 240 * o.dpr || [-48, -24, -12, 0].includes(dB))) g.fillText(String(dB), x, o.h / 2);
    }
    g.textAlign = 'start';
  },
};

bars.feather = mirror.feather = blocks.feather = waterfall.feather = terrain.feather = meters.feather = 'x';
aurora.feather = 'xt';
mirror.rest = wave.rest = ring.rest = orb.rest = meters.rest = 'middle';
meters.noDensity = true;
// Waterfall glows as one soft pass: at most 8 px and 35 % alpha.
waterfall.glowCap = { px: 8, alpha: 0.35 };

export const STYLES = [bars, mirror, blocks, ring, wave, aurora, orb, waterfall, particles, terrain, meters];
export const STYLE_MAP = Object.fromEntries(STYLES.map((s) => [s.id, s]));
