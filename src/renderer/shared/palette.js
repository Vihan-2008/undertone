// Colour: preset themes, the Custom accent rule and the From cover rule
// (design/DESIGN.md section 2.2). Rules run in OKLCH; the gradient between
// the three stops is interpolated in sRGB.

export const THEMES = {
  ember: { name: 'Ember', stops: ['#7a1e0a', '#eb4a22', '#ffc27a'] },
  paper: { name: 'Paper', stops: ['#6f6b64', '#cfcac0', '#ffffff'] },
  tide: { name: 'Tide', stops: ['#0e3b5c', '#1f9ec9', '#b8f1ff'] },
  moss: { name: 'Moss', stops: ['#1f4d2e', '#6fbf4a', '#e6f58a'] },
  sodium: { name: 'Sodium', stops: ['#5c3b00', '#f2a413', '#fff1b0'] },
  prism: { name: 'Prism', stops: ['#2b6bff', '#e0457b', '#ffc94a'] },
};
export const THEME_ORDER = ['ember', 'paper', 'tide', 'moss', 'sodium', 'prism', 'custom', 'cover'];
export const THEME_NAMES = { ...Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, t.name])), custom: 'Custom', cover: 'From cover' };

// ---- conversions ----
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hue = (h) => ((h % 360) + 360) % 360;

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function rgbToOklch([r, g, b]) {
  const lr = toLin(r / 255), lg = toLin(g / 255), lb = toLin(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), hue((Math.atan2(B, A) * 180) / Math.PI)];
}

function oklchToLinear([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH -> sRGB, reducing chroma until it fits the gamut. */
export function oklchToRgb([L, C, H]) {
  L = clamp01(L);
  let c = Math.max(0, C);
  for (let i = 0; i < 40; i++) {
    const lin = oklchToLinear([L, c, H]);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return lin.map((v) => Math.round(toGam(clamp01(v)) * 255));
    c *= 0.9;
  }
  return oklchToLinear([L, 0, H]).map((v) => Math.round(toGam(clamp01(v)) * 255));
}

const hexOf = (lch) => rgbToHex(oklchToRgb(lch));

/** Custom accent rule: one colour becomes a readable low / mid / high ramp. */
export function customStops(hex) {
  const [L, C, H] = rgbToOklch(hexToRgb(hex));
  if (C < 0.03) return [hexOf([0.42, 0, 0]), hexOf([clamp(L, 0.6, 0.85), 0, 0]), hexOf([0.98, 0, 0])];
  const midC = clamp(C, 0.1, 0.22);
  return [
    hexOf([0.34, midC * 0.75, hue(H - 18)]),
    hexOf([clamp(L, 0.58, 0.76), midC, H]),
    hexOf([0.9, midC * 0.45, hue(H + 28)]),
  ];
}

/**
 * From cover rule. `img` is a loaded <img> or bitmap. Returns three stops;
 * a cover with no real colour gives Paper.
 */
export function coverStops(img) {
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, L: 0, C: 0, x: 0, y: 0 }));
  let chromaSum = 0, kept = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [L, C, H] = rgbToOklch([px[i], px[i + 1], px[i + 2]]);
    if (L < 0.15 || L > 0.95) continue;
    kept++;
    chromaSum += C;
    const b = bins[Math.floor(H / 30) % 12];
    b.w += C;
    b.L += L * C;
    b.C += C * C;
    b.x += Math.cos((H * Math.PI) / 180) * C;
    b.y += Math.sin((H * Math.PI) / 180) * C;
  }
  if (!kept || chromaSum / kept < 0.03) return THEMES.paper.stops.slice();
  const mean = (b) => [b.L / b.w, b.C / b.w, hue((Math.atan2(b.y, b.x) * 180) / Math.PI)];
  const ranked = bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const first = mean(ranked[0]);
  const stops = customStops(hexOf(first));
  const second = ranked[1];
  if (second && second.w >= ranked[0].w * 0.2) {
    const s = mean(second);
    const d = Math.abs(s[2] - first[2]);
    if (Math.min(d, 360 - d) >= 60) stops[2] = hexOf([0.88, s[1] * 0.6, s[2]]);
  }
  return stops;
}

/** 256-entry lookup across a 3-stop palette, interpolated in sRGB. */
export function buildLut(stops, n = 256) {
  const rgbStops = stops.map(hexToRgb);
  const css = new Array(n);
  const rgb = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const seg = t < 0.5 ? 0 : 1;
    const u = seg === 0 ? t * 2 : (t - 0.5) * 2;
    const a = rgbStops[seg], b = rgbStops[seg + 1];
    const c = [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * u));
    rgb[i] = c;
    css[i] = `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  return { css, rgb, stops };
}

/** Blend two stop lists (for the 800 ms crossfade on track change). */
export function mixStops(from, to, t) {
  return to.map((hex, i) => {
    const a = hexToRgb(from[i] || hex), b = hexToRgb(hex);
    return rgbToHex(a.map((v, k) => v + (b[k] - v) * t));
  });
}

/**
 * Stops for a visualizer setting. `cover` is the current cover's stops (or
 * null: keep `fallback`, the palette that was showing).
 * Accepts the old schema too (fromCover / accent) while it is migrated.
 */
export function resolvePalette(vis, cover, fallback) {
  const theme = vis.fromCover ? 'cover' : vis.theme;
  if (theme === 'cover') return cover || fallback || THEMES.ember.stops;
  if (theme === 'custom') return customStops(vis.customAccent || vis.accent || '#3b8fd9');
  return (THEMES[theme] || THEMES.ember).stops;
}

// Old names, still used by the first widget build.
export const accentPalette = customStops;
export const coverPalette = coverStops;
