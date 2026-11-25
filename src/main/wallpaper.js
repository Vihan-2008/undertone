'use strict';
// The user's wallpaper, read from the image Windows keeps for it (never a
// screen capture, which would contain our own widgets and other windows).
// Used for the settings preview and for choosing paper or ink text tone.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { nativeImage } = require('electron');

const DESKTOP_KEY = 'HKCU\\Control Panel\\Desktop';
const COLOURS_KEY = 'HKCU\\Control Panel\\Colors';

function regValue(key, name) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve(null);
      const line = String(out).split(/\r?\n/).find((l) => l.trim().startsWith(name));
      if (!line) return resolve(null);
      const m = line.trim().match(/^\S+\s+REG_\w+\s*(.*)$/);
      resolve(m ? m[1].trim() : '');
    });
  });
}

const srgbLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminanceOf = (r, g, b) => 0.2126 * srgbLin(r / 255) + 0.7152 * srgbLin(g / 255) + 0.0722 * srgbLin(b / 255);

class Wallpaper extends EventEmitter {
  constructor() {
    super();
    this.sig = '';
    this.img = null; // nativeImage, at most 1600 px wide
    this.sample = null; // { w, h, px } small BGRA bitmap for luminance
    this.size = null; // source pixel size
    this.style = 10;
    this.tile = false;
    this.bg = [0, 0, 0];
  }

  async refresh() {
    try {
      const themes = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
      let file = fs.existsSync(themes) && fs.statSync(themes).size > 0 ? themes : '';
      if (!file) {
        const p = await regValue(DESKTOP_KEY, 'WallPaper');
        if (p && fs.existsSync(p)) file = p;
      }
      const [style, tile, bg] = await Promise.all([
        regValue(DESKTOP_KEY, 'WallpaperStyle'),
        regValue(DESKTOP_KEY, 'TileWallpaper'),
        regValue(COLOURS_KEY, 'Background'),
      ]);
      const mtime = file ? fs.statSync(file).mtimeMs : 0;
      const sig = [file, mtime, style, tile, bg].join('|');
      if (sig === this.sig) return false;
      this.sig = sig;
      this.style = parseInt(style, 10) || 0;
      this.tile = tile === '1';
      this.bg = (bg || '0 0 0').split(/\s+/).map((v) => parseInt(v, 10) || 0).slice(0, 3);
      this.img = null;
      this.sample = null;
      if (file) {
        let img = nativeImage.createFromBuffer(fs.readFileSync(file));
        if (!img.isEmpty()) {
          this.size = img.getSize();
          if (this.size.width > 1600) img = img.resize({ width: 1600, quality: 'good' });
          this.img = img;
          const small = img.resize({ width: 192, quality: 'good' });
          const s = small.getSize();
          this.sample = { w: s.width, h: s.height, px: small.toBitmap() };
        }
      }
      this.emit('change');
      return true;
    } catch (e) {
      console.warn('[wallpaper] could not read', e.message);
      return false;
    }
  }

  /** Where the image sits on a display, in that display's DIP coordinates. */
  placement(display) {
    const dw = display.size.width, dh = display.size.height;
    if (!this.size) return null;
    const iw = this.size.width, ih = this.size.height;
    const sf = display.scaleFactor || 1;
    const centred = (w, h) => ({ x: (dw - w) / 2, y: (dh - h) / 2, w, h });
    if (this.tile) return { x: 0, y: 0, w: iw / sf, h: ih / sf, tile: true };
    switch (this.style) {
      case 2: return { x: 0, y: 0, w: dw, h: dh };
      case 6: { const s = Math.min(dw / iw, dh / ih); return centred(iw * s, ih * s); }
      case 0: return centred(iw / sf, ih / sf);
      default: { const s = Math.max(dw / iw, dh / ih); return centred(iw * s, ih * s); } // fill, span
    }
  }

  /** Everything a renderer needs to paint the desktop picture for a display. */
  picture(display) {
    const p = this.placement(display);
    return {
      display: { width: display.size.width, height: display.size.height },
      bg: `rgb(${this.bg.join(',')})`,
      image: this.img ? this.img.toDataURL() : null,
      placement: p,
    };
  }

  /** Mean relative luminance of the wallpaper inside rect (display DIP coordinates). */
  luminance(display, rect) {
    const p = this.placement(display);
    const bgL = luminanceOf(...this.bg);
    if (!p || !this.sample) return bgL;
    const { w: sw, h: sh, px } = this.sample;
    let sum = 0, n = 0;
    const NX = 16, NY = 6;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const x = rect.x + ((i + 0.5) / NX) * rect.width;
        const y = rect.y + ((j + 0.5) / NY) * rect.height;
        let u = (x - p.x) / p.w, v = (y - p.y) / p.h;
        if (p.tile) { u -= Math.floor(u); v -= Math.floor(v); }
        if (u < 0 || u >= 1 || v < 0 || v >= 1) { sum += bgL; n++; continue; }
        const k = (Math.floor(v * sh) * sw + Math.floor(u * sw)) * 4;
        sum += luminanceOf(px[k + 2], px[k + 1], px[k]);
        n++;
      }
    }
    return n ? sum / n : bgL;
  }
}

module.exports = { Wallpaper };
