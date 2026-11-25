/* MOCKUP ONLY. Draws static stand-ins for the visualizer and applies ?query
   parameters as data-* attributes on <body> so every state can be opened by URL.
   The real app replaces [data-viz] canvases with the engine's output. */
(function () {
  const THEMES = {
    ember:  ['#7a1e0a', '#eb4a22', '#ffc27a'],
    paper:  ['#6f6b64', '#cfcac0', '#ffffff'],
    tide:   ['#0e3b5c', '#1f9ec9', '#b8f1ff'],
    moss:   ['#1f4d2e', '#6fbf4a', '#e6f58a'],
    sodium: ['#5c3b00', '#f2a413', '#fff1b0'],
    prism:  ['#2b6bff', '#e0457b', '#ffc94a'],
    cover:  ['#0f2f3a', '#2d7d86', '#f3d9a4']
  };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function mix3(st, t) {
    t = Math.max(0, Math.min(1, t));
    const a = hex(st[t < .5 ? 0 : 1]), b = hex(st[t < .5 ? 1 : 2]), k = t < .5 ? t * 2 : (t - .5) * 2;
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',') + ')';
  }
  function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  function spec(n, seed) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let v = .62 * Math.exp(-Math.pow((t - .16) / .15, 2)) + .46 * Math.exp(-Math.pow((t - .56) / .2, 2)) + .12;
      v *= .68 + .32 * Math.sin(i * 1.71 + seed * 3.1) * Math.cos(i * .43 + seed);
      out.push(Math.max(.04, Math.min(1, v * 1.25)));
    }
    return out;
  }
  function vgrad(ctx, y0, y1, st) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, st[0]); g.addColorStop(.55, st[1]); g.addColorStop(1, st[2]);
    return g;
  }
  const D = {
    bars(c, w, h, st, big) {
      const n = big ? 56 : 14, s = spec(n, 1), bw = w / n;
      c.fillStyle = vgrad(c, h, h * .05, st);
      s.forEach((v, i) => c.fillRect(i * bw + bw * .15, h - v * h * .92, bw * .7, v * h * .92));
    },
    mirror(c, w, h, st, big) {
      const n = big ? 40 : 10, s = spec(n, 2), bw = w / (n * 2);
      for (let i = 0; i < n; i++) {
        const v = s[i] * h * .46; c.fillStyle = mix3(st, s[i]);
        [w / 2 + i * bw, w / 2 - (i + 1) * bw].forEach(x => c.fillRect(x + bw * .15, h / 2 - v, bw * .7, v * 2));
      }
    },
    blocks(c, w, h, st, big) {
      const n = big ? 32 : 9, rows = big ? 12 : 6, s = spec(n, 3), bw = w / n, bh = h / rows;
      s.forEach((v, i) => {
        for (let r = 0; r < Math.round(v * rows); r++) {
          c.fillStyle = mix3(st, r / (rows - 1));
          c.fillRect(i * bw + bw * .12, h - (r + 1) * bh + bh * .18, bw * .76, bh * .64);
        }
      });
    },
    ring(c, w, h, st, big) {
      const n = big ? 96 : 36, s = spec(n / 2, 4), R = Math.min(w, h) * .26;
      c.lineWidth = big ? 3 : 1.5; c.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const v = s[i < n / 2 ? i : n - 1 - i], a = i / n * Math.PI * 2 - Math.PI / 2, r2 = R + v * Math.min(w, h) * .2;
        c.strokeStyle = mix3(st, v); c.beginPath();
        c.moveTo(w / 2 + Math.cos(a) * R, h / 2 + Math.sin(a) * R);
        c.lineTo(w / 2 + Math.cos(a) * r2, h / 2 + Math.sin(a) * r2); c.stroke();
      }
    },
    wave(c, w, h, st, big) {
      const g = c.createLinearGradient(0, 0, w, 0); st.forEach((s, i) => g.addColorStop(i / 2, s));
      c.strokeStyle = g; c.lineWidth = big ? 2.5 : 1.5; c.lineJoin = 'round'; c.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const t = x / w, env = Math.sin(t * Math.PI);
        const y = h / 2 + env * h * .34 * (Math.sin(t * 31) * .6 + Math.sin(t * 71 + 1) * .3 + Math.sin(t * 143) * .1);
        x ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    },
    aurora(c, w, h, st) {
      st.forEach((col, k) => {
        c.fillStyle = col; c.globalAlpha = .5; c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += 4) {
          const t = x / w;
          c.lineTo(x, h * (.62 - k * .14) - Math.sin(t * (5 + k * 2) + k * 1.7) * h * .16 - Math.sin(t * 13 + k) * h * .05);
        }
        c.lineTo(w, h); c.fill();
      });
      c.globalAlpha = 1;
    },
    orb(c, w, h, st) {
      const R = Math.min(w, h) * .34, g = c.createRadialGradient(w / 2, h / 2, R * .1, w / 2, h / 2, R);
      g.addColorStop(0, st[2]); g.addColorStop(.6, st[1]); g.addColorStop(1, st[0]);
      c.fillStyle = g; c.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2, r = R * (1 + .09 * Math.sin(a * 5) + .05 * Math.sin(a * 11 + 1));
        c.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      c.fill();
    },
    waterfall(c, w, h, st, big) {
      const cols = big ? 64 : 16, rows = big ? 22 : 8, cw = w / cols, rh = h / rows;
      for (let r = 0; r < rows; r++) {
        const s = spec(cols, r * .7 + 5);
        for (let i = 0; i < cols; i++) {
          c.globalAlpha = Math.min(1, s[i] * 1.1) * (1 - r / rows * .7); c.fillStyle = mix3(st, s[i]);
          c.fillRect(i * cw, h - (r + 1) * rh, cw + .5, rh + .5);
        }
      }
      c.globalAlpha = 1;
    },
    particles(c, w, h, st, big) {
      const r = rng(7), n = big ? 220 : 40;
      for (let i = 0; i < n; i++) {
        const x = r() * w, e = Math.pow(r(), 1.6), y = h - e * h * .95, sz = (big ? 1 : .6) + r() * (big ? 3 : 1.6);
        c.globalAlpha = .35 + r() * .65; c.fillStyle = mix3(st, e);
        c.beginPath(); c.arc(x, y, sz, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    },
    terrain(c, w, h, st, big) {
      const lines = big ? 14 : 6, n = big ? 64 : 20;
      for (let l = 0; l < lines; l++) {
        const s = spec(n, l * .9 + 2), base = h * .3 + l * (h * .66 / lines), k = l / (lines - 1);
        c.beginPath();
        s.forEach((v, i) => { const x = i / (n - 1) * w, y = base - v * h * .26 * (.4 + k * .6); i ? c.lineTo(x, y) : c.moveTo(x, y); });
        c.strokeStyle = mix3(st, 1 - k); c.globalAlpha = .35 + k * .65; c.lineWidth = big ? 1.5 : 1; c.stroke();
      }
      c.globalAlpha = 1;
    },
    meters(c, w, h, st, big) {
      const bh = h * .16, x0 = w * .06, len = w * .88;
      [[.36, .74], [.64, .66]].forEach(([y, v]) => {
        const g = c.createLinearGradient(x0, 0, x0 + len, 0); st.forEach((s, i) => g.addColorStop(i / 2, s));
        c.globalAlpha = .22; c.fillStyle = st[1]; c.fillRect(x0, h * y - bh / 2, len, bh);
        c.globalAlpha = 1; c.fillStyle = g; c.fillRect(x0, h * y - bh / 2, len * v, bh);
        c.fillStyle = st[2]; c.fillRect(x0 + len * (v + .08), h * y - bh / 2, big ? 3 : 1.5, bh);
      });
    },
    rest(c, w, h, st) { c.globalAlpha = .5; c.fillStyle = st[1]; c.fillRect(0, h - 2, w, 2); c.globalAlpha = 1; }
  };
  function paint(cv) {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const st = THEMES[cv.dataset.theme || 'ember'], big = w > 200;
    if (big && cv.dataset.glow !== '0') { c.shadowColor = st[1]; c.shadowBlur = 16; }
    (D[cv.dataset.viz] || D.bars)(c, w, h, st, big);
  }
  function paintAll() { document.querySelectorAll('canvas[data-viz]').forEach(paint); }

  // ?tab=clock&status=silent  ->  <body data-tab="clock" data-status="silent">
  new URLSearchParams(location.search).forEach((v, k) => { document.body.dataset[k] = v; });

  // [data-fit="1920"]: scale a fixed-size stage down to the viewport width
  function fit() {
    document.querySelectorAll('[data-fit]').forEach(el => {
      const k = Math.min(1, window.innerWidth / +el.dataset.fit);
      el.style.transform = 'scale(' + k + ')'; el.style.transformOrigin = '0 0';
    });
  }
  window.addEventListener('resize', () => { fit(); paintAll(); });
  window.undertoneMockup = { paintAll, THEMES };
  fit(); paintAll();
})();
