'use strict';
// Undertone's glyph, drawn in code so there are no binary assets to ship:
// three vertical bars of unequal height (DESIGN.md 8.1).
//   normal   three unequal bars
//   paused   three equal short bars (paused, covered or hidden)
//   problem  normal glyph plus a small filled square, top right
// The tray glyph is one flat colour: light on a dark taskbar, dark on a light one.

const { nativeImage } = require('electron');

const SS = 4;

/** Rasterise fn(u, v) -> [r, g, b] | null into a BGRA buffer, 4x4 supersampled. */
function coverage(size, fn) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = fn((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (y * size + x) * 4;
      buf[i] = a ? Math.round(b / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(r / a) : 0;
      buf[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return buf;
}

// Geometry on a 16-unit grid: bars 3 wide with 2 gaps, standing on y = 14.5.
const BARS = { normal: [8, 13, 5], paused: [4, 4, 4] };
const BASE = 14.5;

function glyph(kind, colour, accent = colour) {
  const heights = BARS[kind === 'paused' ? 'paused' : 'normal'];
  return (u, v) => {
    const x = u * 16, y = v * 16;
    if (kind === 'problem' && x >= 11 && x <= 16 && y >= 0 && y <= 5) return accent;
    for (let i = 0; i < 3; i++) {
      const x0 = 1.5 + i * 5;
      if (x >= x0 && x < x0 + 3 && y <= BASE && y >= BASE - heights[i]) return i === 1 ? accent : colour;
    }
    return null;
  };
}

const LIGHT = [0xef, 0xeb, 0xe2];
const DARK = [0x1b, 0x1a, 0x18];

const cache = new Map();
/** kind: normal | paused | problem; onLight: the taskbar is light. */
function trayImage(kind = 'normal', onLight = false) {
  const key = `${kind}|${onLight}`;
  if (cache.has(key)) return cache.get(key);
  const colour = onLight ? DARK : LIGHT;
  const img = nativeImage.createEmpty();
  for (const scale of [1, 1.25, 1.5, 2]) {
    const px = Math.round(16 * scale);
    img.addRepresentation({ scaleFactor: scale, width: px, height: px, buffer: coverage(px, glyph(kind, colour)) });
  }
  cache.set(key, img);
  return img;
}

// The app icon: paper bars on an ink tile, the middle bar vermilion.
const INK = [0x0d, 0x0d, 0x0c];
const VERMILION = [0xeb, 0x4a, 0x22];
function appMark(u, v) {
  const r = 0.16;
  const dx = Math.max(0, Math.abs(u - 0.5) - (0.5 - r));
  const dy = Math.max(0, Math.abs(v - 0.5) - (0.5 - r));
  if (Math.hypot(dx, dy) > r) return null;
  return glyph('normal', LIGHT, VERMILION)((u - 0.18) / 0.64, (v - 0.16) / 0.64) || INK;
}

function appIcon(size = 64) {
  return nativeImage.createFromBuffer(coverage(size, appMark), { width: size, height: size });
}

module.exports = { trayImage, appIcon, coverage, appMark };
